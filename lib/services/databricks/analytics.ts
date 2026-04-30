import { dbxFetch, isDatabricksConfigured } from "./client.js";

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

interface InsertColumn {
  col: string;
  param: string;
  value: string | null;
}

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

async function executeNamedInsert(table: string, columns: InsertColumn[]): Promise<void> {
  const schema = analyticsSchema();
  if (!schema) {
    console.warn("[analytics] DATABRICKS_ANALYTICS_SCHEMA not set — analytics disabled");
    return;
  }
  const warehouseId = resolveWarehouse();
  if (!warehouseId) {
    console.warn("[analytics] Databricks env not set — analytics disabled");
    return;
  }

  assertIdent("table", table);
  for (const c of columns) {
    assertIdent("column", c.col);
    assertIdent("param", c.param);
  }

  const colList = ["timestamp", ...columns.map(c => c.col)].join(", ");
  const placeholders = ["CAST(:timestamp AS TIMESTAMP)", ...columns.map(c => `:${c.param}`)].join(", ");
  const statement = `
    INSERT INTO ${schema}.${table}
      (${colList})
    VALUES
      (${placeholders})
  `;

  const parameters: SqlParam[] = [
    { name: "timestamp", value: new Date().toISOString(), type: "STRING" },
    ...columns.map(c => ({ name: c.param, value: c.value, type: "STRING" as const })),
  ];

  const body: SqlExecuteRequest = {
    warehouse_id: warehouseId,
    statement,
    parameters,
    wait_timeout: "30s",
  };

  const res = await dbxFetch<{
    status?: { state?: string; error?: { message?: string } };
    statement_id?: string;
  }>("/api/2.0/sql/statements", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const state = res.status?.state;
  if (state !== "SUCCEEDED") {
    const err = res.status?.error?.message ?? "(no error message)";
    throw new Error(`SQL statement ${res.statement_id ?? "?"} ended in state ${state ?? "?"}: ${err}`);
  }
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
  await executeNamedInsert("mcp_initializations", [
    { col: "method", param: "method", value: "initialize" },
    { col: "protocol_version", param: "protocolVersion", value: params.protocolVersion },
    { col: "capabilities", param: "capabilities", value: stringify(params.capabilities) },
    { col: "client_name", param: "clientName", value: params.clientName },
    { col: "client_version", param: "clientVersion", value: params.clientVersion },
    { col: "raw_body", param: "rawBody", value: stringify(params.rawBody) },
  ]);
}

export async function logToolCallRequest(params: {
  toolName: string;
  requestId: string | null;
  sessionId: string | null;
  toolArgs: unknown;
  rawBody: unknown;
}): Promise<void> {
  await executeNamedInsert("mcp_tool_calls", [
    { col: "row_type", param: "rowType", value: "request" },
    { col: "tool_name", param: "toolName", value: params.toolName },
    { col: "request_id", param: "requestId", value: params.requestId },
    { col: "session_id", param: "sessionId", value: params.sessionId },
    { col: "arguments", param: "arguments", value: stringify(params.toolArgs) },
    { col: "raw_body", param: "rawBody", value: stringify(params.rawBody) },
  ]);
}

export function logToolCallResponse(params: { tool: string; req: string; res: string; rawBody: unknown }): void {
  executeNamedInsert("mcp_tool_calls", [
    { col: "row_type", param: "rowType", value: "response" },
    { col: "tool_name", param: "toolName", value: params.tool },
    { col: "arguments", param: "arguments", value: stringify(params.req) },
    { col: "response_text", param: "responseText", value: params.res },
    { col: "raw_body", param: "rawBody", value: stringify(params.rawBody) },
  ]).catch((err: unknown) => {
    console.error("[logToolCallResponse] Error inserting tool response:", err);
  });
}
