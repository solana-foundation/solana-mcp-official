import { dbxFetch, isDatabricksConfigured } from "./client.js";
import { sleep } from "./utils.js";

// Schema hosting the analytics tables. Table names themselves are generic
// (`mcp_initializations`, `mcp_tool_calls`); only the catalog.schema prefix
// needs to be set per deployment.
function analyticsSchema(): string | null {
  const schema = process.env.DATABRICKS_ANALYTICS_SCHEMA;
  return schema ? schema.replace(/\.$/, "") : null;
}

type SqlParamType = "STRING" | "TIMESTAMP";

interface SqlParam {
  name: string;
  value: string | null;
  type: SqlParamType;
}

interface SqlExecuteRequest {
  warehouse_id: string;
  statement: string;
  parameters: SqlParam[];
  wait_timeout: string;
}

interface SqlExecuteResponse {
  status?: { state?: string; error?: { message?: string } };
  statement_id?: string;
}

type AnalyticsTable = "mcp_initializations" | "mcp_tool_calls";

type RowValues = Record<string, string | null>;

interface BufferedRow {
  timestamp: string;
  values: RowValues;
}

interface InsertChunk {
  rows: BufferedRow[];
  request: SqlExecuteRequest;
}

const DEFAULT_BATCH_SIZE = 1_000;
const DEFAULT_FLUSH_INTERVAL_MS = 60 * 60 * 1_000;
const DEFAULT_INSERT_CHUNK_BYTE_LIMIT = 24 * 1_024;
const DEFAULT_INSERT_CHUNK_ROW_LIMIT = 20;
const DEFAULT_MAX_BUFFERED_ROWS = 10_000;
const STATEMENT_TIMEOUT = "30s";
const POLL_MAX_ATTEMPTS = 6;
const POLL_BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 8000];

const TABLE_COLUMNS: Record<AnalyticsTable, readonly string[]> = {
  mcp_initializations: ["method", "protocol_version", "capabilities", "client_name", "client_version", "raw_body"],
  mcp_tool_calls: ["row_type", "tool_name", "request_id", "session_id", "arguments", "response_text", "raw_body"],
};

const buffers: Record<AnalyticsTable, BufferedRow[]> = {
  mcp_initializations: [],
  mcp_tool_calls: [],
};

let flushTimer: NodeJS.Timeout | null = null;
let flushInFlight: Promise<void> | null = null;
const warningKeys = new Set<string>();

function resolveWarehouse(): string | null {
  if (!isDatabricksConfigured()) return null;
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) return null;
  return warehouseId;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdent(kind: string, value: string): void {
  if (!IDENT.test(value)) {
    throw new Error(`[analytics] invalid ${kind} identifier: ${JSON.stringify(value)}`);
  }
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function batchSize(): number {
  return readPositiveInt("DATABRICKS_ANALYTICS_BATCH_SIZE", DEFAULT_BATCH_SIZE);
}

function flushIntervalMs(): number {
  return readPositiveInt("DATABRICKS_ANALYTICS_FLUSH_INTERVAL_MS", DEFAULT_FLUSH_INTERVAL_MS);
}

function insertChunkByteLimit(): number {
  return readPositiveInt("DATABRICKS_ANALYTICS_INSERT_CHUNK_BYTE_LIMIT", DEFAULT_INSERT_CHUNK_BYTE_LIMIT);
}

function insertChunkRowLimit(): number {
  return readPositiveInt("DATABRICKS_ANALYTICS_INSERT_CHUNK_ROW_LIMIT", DEFAULT_INSERT_CHUNK_ROW_LIMIT);
}

function maxBufferedRows(): number {
  return readPositiveInt("DATABRICKS_ANALYTICS_MAX_BUFFERED_ROWS", DEFAULT_MAX_BUFFERED_ROWS);
}

function warnOnce(key: string, message: string): void {
  if (warningKeys.has(key)) return;
  warningKeys.add(key);
  console.warn(message);
}

function enqueueNamedInsert(table: AnalyticsTable, values: RowValues): void {
  const schema = analyticsSchema();
  if (!schema) {
    warnOnce("missing-schema", "[analytics] DATABRICKS_ANALYTICS_SCHEMA not set — analytics disabled");
    return;
  }
  const warehouseId = resolveWarehouse();
  if (!warehouseId) {
    warnOnce("missing-databricks", "[analytics] Databricks env not set — analytics disabled");
    return;
  }

  assertIdent("table", table);
  for (const col of TABLE_COLUMNS[table]) {
    assertIdent("column", col);
  }

  buffers[table].push({ timestamp: new Date().toISOString(), values });
  trimBuffer(table);
  ensureFlushTimer();

  if (bufferedAnalyticsRowCount() >= batchSize()) {
    void flushAnalytics().catch((err: unknown) => {
      console.error("[analytics] Error flushing batch:", err);
    });
  }
}

function trimBuffer(table: AnalyticsTable): void {
  const limit = maxBufferedRows();
  const overflow = buffers[table].length - limit;
  if (overflow <= 0) return;
  buffers[table].splice(0, overflow);
  console.warn(`[analytics] dropped ${overflow} buffered ${table} rows after reaching max buffer size`);
}

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushAnalytics().catch((err: unknown) => {
      console.error("[analytics] Error flushing batch:", err);
    });
  }, flushIntervalMs());
  flushTimer.unref();
}

function buildInsertRequest(
  table: AnalyticsTable,
  rows: BufferedRow[],
  warehouseId: string,
  schema: string,
): SqlExecuteRequest {
  const columns = ["timestamp", ...TABLE_COLUMNS[table]];
  const colList = columns.join(", ");
  const rowPlaceholders = rows.map((_, rowIndex) => {
    const placeholders = columns.map(col => {
      const param = `r${rowIndex}_${col}`;
      return col === "timestamp" ? `CAST(:${param} AS TIMESTAMP)` : `:${param}`;
    });
    return `(${placeholders.join(", ")})`;
  });

  const statement = `
    INSERT INTO ${schema}.${table}
      (${colList})
    VALUES
      ${rowPlaceholders.join(",\n      ")}
  `;

  const parameters: SqlParam[] = rows.flatMap((row, rowIndex) =>
    columns.map(col => ({
      name: `r${rowIndex}_${col}`,
      value: col === "timestamp" ? row.timestamp : (row.values[col] ?? null),
      type: "STRING" as const,
    })),
  );

  return {
    warehouse_id: warehouseId,
    statement,
    parameters,
    wait_timeout: STATEMENT_TIMEOUT,
  };
}

function requestByteLength(request: SqlExecuteRequest): number {
  return Buffer.byteLength(JSON.stringify(request), "utf8");
}

function buildInsertChunks(
  table: AnalyticsTable,
  rows: BufferedRow[],
  warehouseId: string,
  schema: string,
): InsertChunk[] {
  const chunks: InsertChunk[] = [];
  const byteLimit = insertChunkByteLimit();
  const rowLimit = insertChunkRowLimit();
  let chunkRows: BufferedRow[] = [];
  let chunkRequest: SqlExecuteRequest | null = null;

  for (const row of rows) {
    const candidateRows = [...chunkRows, row];
    const candidateRequest = buildInsertRequest(table, candidateRows, warehouseId, schema);
    const candidateTooLarge = requestByteLength(candidateRequest) > byteLimit || candidateRows.length > rowLimit;

    if (chunkRows.length > 0 && candidateTooLarge) {
      chunks.push({
        rows: chunkRows,
        request: chunkRequest ?? buildInsertRequest(table, chunkRows, warehouseId, schema),
      });
      chunkRows = [row];
      chunkRequest = buildInsertRequest(table, chunkRows, warehouseId, schema);
      continue;
    }

    chunkRows = candidateRows;
    chunkRequest = candidateRequest;
  }

  if (chunkRows.length > 0) {
    chunks.push({
      rows: chunkRows,
      request: chunkRequest ?? buildInsertRequest(table, chunkRows, warehouseId, schema),
    });
  }

  return chunks;
}

async function executeInsertRequest(request: SqlExecuteRequest): Promise<void> {
  let res = await dbxFetch<SqlExecuteResponse>("/api/2.0/sql/statements", {
    method: "POST",
    body: JSON.stringify(request),
  });

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS && isPending(res.status?.state); attempt++) {
    if (!res.statement_id) break;
    await sleep(POLL_BACKOFF_MS[attempt] ?? POLL_BACKOFF_MS[POLL_BACKOFF_MS.length - 1]);
    res = await dbxFetch<SqlExecuteResponse>(`/api/2.0/sql/statements/${encodeURIComponent(res.statement_id)}`);
  }

  const state = res.status?.state;
  if (state !== "SUCCEEDED") {
    const err = res.status?.error?.message ?? "(no error message)";
    throw new Error(`SQL statement ${res.statement_id ?? "?"} ended in state ${state ?? "?"}: ${err}`);
  }
}

function resolveFlushTarget(): { schema: string; warehouseId: string } | null {
  const schema = analyticsSchema();
  if (!schema) {
    warnOnce("missing-schema", "[analytics] DATABRICKS_ANALYTICS_SCHEMA not set — analytics disabled");
    return null;
  }
  const warehouseId = resolveWarehouse();
  if (!warehouseId) {
    warnOnce("missing-databricks", "[analytics] Databricks env not set — analytics disabled");
    return null;
  }
  return { schema, warehouseId };
}

function isPending(state: string | undefined): boolean {
  return state === "PENDING" || state === "RUNNING";
}

function requeueRows(table: AnalyticsTable, rows: BufferedRow[]): void {
  buffers[table] = [...rows, ...buffers[table]];
  trimBuffer(table);
}

async function flushTable(table: AnalyticsTable): Promise<void> {
  const rows = buffers[table].splice(0, buffers[table].length);
  if (rows.length === 0) return;
  const target = resolveFlushTarget();
  if (!target) {
    requeueRows(table, rows);
    return;
  }

  const chunks = buildInsertChunks(table, rows, target.warehouseId, target.schema);
  let rowStart = 0;
  for (const chunk of chunks) {
    try {
      await executeInsertRequest(chunk.request);
    } catch (err) {
      requeueRows(table, rows.slice(rowStart));
      throw err;
    }
    rowStart += chunk.rows.length;
  }
}

export async function flushAnalytics(): Promise<void> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = (async () => {
    try {
      await flushTable("mcp_initializations");
      await flushTable("mcp_tool_calls");
    } finally {
      flushInFlight = null;
    }
  })();
  return flushInFlight;
}

function stringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export async function logInitialization(params: {
  protocolVersion: string;
  capabilities: unknown;
  clientName: string;
  clientVersion: string;
  rawBody: unknown;
}): Promise<void> {
  enqueueNamedInsert("mcp_initializations", {
    method: "initialize",
    protocol_version: params.protocolVersion,
    capabilities: stringify(params.capabilities),
    client_name: params.clientName,
    client_version: params.clientVersion,
    raw_body: stringify(params.rawBody),
  });
}

export async function logToolCallRequest(params: {
  toolName: string;
  requestId: string | null;
  sessionId: string | null;
  toolArgs: unknown;
  rawBody: unknown;
}): Promise<void> {
  enqueueNamedInsert("mcp_tool_calls", {
    row_type: "request",
    tool_name: params.toolName,
    request_id: params.requestId,
    session_id: params.sessionId,
    arguments: stringify(params.toolArgs),
    response_text: null,
    raw_body: stringify(params.rawBody),
  });
}

export function logToolCallResponse(params: { tool: string; req: string; res: string; rawBody: unknown }): void {
  try {
    enqueueNamedInsert("mcp_tool_calls", {
      row_type: "response",
      tool_name: params.tool,
      request_id: null,
      session_id: null,
      arguments: stringify(params.req),
      response_text: params.res,
      raw_body: stringify(params.rawBody),
    });
  } catch (err) {
    console.error("[logToolCallResponse] Error buffering tool response:", err);
  }
}

export function bufferedAnalyticsRowCount(): number {
  return Object.values(buffers).reduce((total, rows) => total + rows.length, 0);
}
