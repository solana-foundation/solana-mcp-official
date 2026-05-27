import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomBytes } from "node:crypto";

type AnalyticsTable = "mcp_initializations" | "mcp_tool_calls";
type BufferTrimSide = "newest" | "oldest";
type RowValues = Record<string, string | number | null>;

interface BufferedRow {
  timestamp: string;
  values: RowValues;
}

interface S3Target {
  bucket: string;
  prefix: string;
  region: string;
}

interface FlushChunk {
  partition: {
    date: string;
    hour: string;
  };
  rows: BufferedRow[];
}

const DEFAULT_BATCH_SIZE = 1_000;
const DEFAULT_MAX_BUFFERED_ROWS = 5_000;
const DEFAULT_MAX_RECORD_AGE_MS = 15 * 60 * 1_000;
const INSTANCE_ID = randomBytes(4).toString("hex");
const SCHEMA_VERSION = 1;

const buffers: Record<AnalyticsTable, BufferedRow[]> = {
  mcp_initializations: [],
  mcp_tool_calls: [],
};

const warningKeys = new Set<string>();
const flushInFlight: Partial<Record<AnalyticsTable, Promise<void>>> = {};
let objectSequence = 0;
let s3Client: S3Client | null = null;
let s3ClientRegion: string | null = null;

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function batchSize(): number {
  return readPositiveInt("ANALYTICS_S3_BATCH_SIZE", DEFAULT_BATCH_SIZE);
}

function maxBufferedRows(): number {
  return readPositiveInt("ANALYTICS_S3_MAX_BUFFERED_ROWS", DEFAULT_MAX_BUFFERED_ROWS);
}

function maxRecordAgeMs(): number {
  return readPositiveInt("ANALYTICS_S3_MAX_RECORD_AGE_MS", DEFAULT_MAX_RECORD_AGE_MS);
}

function warnOnce(key: string, message: string): void {
  if (warningKeys.has(key)) return;
  warningKeys.add(key);
  console.warn(message);
}

function parseS3Uri(raw: string): Pick<S3Target, "bucket" | "prefix"> | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "s3:" || !url.hostname) return null;
    return {
      bucket: url.hostname,
      prefix: url.pathname.replace(/^\/+|\/+$/g, ""),
    };
  } catch {
    return null;
  }
}

function resolveS3Target(): S3Target | null {
  const rawUri = process.env.ANALYTICS_S3_URI;
  if (!rawUri) {
    warnOnce("missing-s3-uri", "[analytics] ANALYTICS_S3_URI not set - analytics disabled");
    return null;
  }

  const parsedUri = parseS3Uri(rawUri);
  if (!parsedUri) {
    warnOnce("invalid-s3-uri", `[analytics] invalid ANALYTICS_S3_URI: ${JSON.stringify(rawUri)}`);
    return null;
  }

  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (!region) {
    warnOnce("missing-aws-region", "[analytics] AWS_REGION not set - analytics disabled");
    return null;
  }

  return { ...parsedUri, region };
}

function getS3Client(region: string): S3Client {
  if (!s3Client || s3ClientRegion !== region) {
    s3Client = new S3Client({ region });
    s3ClientRegion = region;
  }
  return s3Client;
}

function trimBuffer(table: AnalyticsTable, side: BufferTrimSide): void {
  const limit = maxBufferedRows();
  const overflow = buffers[table].length - limit;
  if (overflow <= 0) return;
  if (side === "oldest") {
    buffers[table].splice(0, overflow);
  } else {
    buffers[table].splice(-overflow, overflow);
  }
  console.warn(`[analytics] dropped ${overflow} buffered ${table} rows after reaching max buffer size`);
}

function shouldFlush(table: AnalyticsTable): boolean {
  const rows = buffers[table];
  if (rows.length >= batchSize()) return true;
  const oldest = rows[0];
  if (!oldest) return false;
  const oldestMs = Date.parse(oldest.timestamp);
  return Number.isFinite(oldestMs) && Date.now() - oldestMs >= maxRecordAgeMs();
}

function enqueueRow(table: AnalyticsTable, values: RowValues): void {
  if (!resolveS3Target()) return;
  buffers[table].push({ timestamp: new Date().toISOString(), values });
  trimBuffer(table, "oldest");

  if (shouldFlush(table)) {
    void flushTableQueued(table).catch((err: unknown) => {
      console.error("[analytics] Error flushing S3 batch:", err);
    });
  }
}

function requeueRows(table: AnalyticsTable, rows: BufferedRow[]): void {
  buffers[table] = [...rows, ...buffers[table]];
  trimBuffer(table, "newest");
}

function partitionFor(timestamp: string): { date: string; hour: string } {
  const iso = new Date(timestamp).toISOString();
  return {
    date: iso.slice(0, 10),
    hour: iso.slice(11, 13),
  };
}

function buildFlushChunks(rows: BufferedRow[]): FlushChunk[] {
  const chunks: FlushChunk[] = [];
  const limit = batchSize();
  let current: FlushChunk | null = null;

  for (const row of rows) {
    const partition = partitionFor(row.timestamp);
    const partitionChanged =
      current && (current.partition.date !== partition.date || current.partition.hour !== partition.hour);
    if (!current || current.rows.length >= limit || partitionChanged) {
      current = { partition, rows: [] };
      chunks.push(current);
    }
    current.rows.push(row);
  }

  return chunks;
}

function objectTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function nextSequence(): string {
  objectSequence += 1;
  return String(objectSequence).padStart(6, "0");
}

function objectKey(target: S3Target, table: AnalyticsTable, chunk: FlushChunk): string {
  const fileName = `${objectTimestamp()}_${INSTANCE_ID}_${nextSequence()}.jsonl`;
  const key = `${table}/dt=${chunk.partition.date}/hour=${chunk.partition.hour}/${fileName}`;
  return target.prefix ? `${target.prefix}/${key}` : key;
}

function serializeRows(table: AnalyticsTable, rows: BufferedRow[]): string {
  return `${rows
    .map(row =>
      JSON.stringify({
        schema_version: SCHEMA_VERSION,
        table,
        timestamp: row.timestamp,
        ...row.values,
      }),
    )
    .join("\n")}\n`;
}

async function uploadChunk(target: S3Target, table: AnalyticsTable, chunk: FlushChunk): Promise<void> {
  await getS3Client(target.region).send(
    new PutObjectCommand({
      Bucket: target.bucket,
      Key: objectKey(target, table, chunk),
      Body: serializeRows(table, chunk.rows),
      ContentType: "application/x-ndjson",
    }),
  );
}

async function flushTable(table: AnalyticsTable): Promise<void> {
  const rows = buffers[table].splice(0, buffers[table].length);
  if (rows.length === 0) return;

  const target = resolveS3Target();
  if (!target) {
    requeueRows(table, rows);
    return;
  }

  const chunks = buildFlushChunks(rows);
  let rowStart = 0;
  for (const chunk of chunks) {
    try {
      await uploadChunk(target, table, chunk);
    } catch (err) {
      requeueRows(table, rows.slice(rowStart));
      throw err;
    }
    rowStart += chunk.rows.length;
  }
}

async function flushTableQueued(table: AnalyticsTable): Promise<void> {
  const existingFlush = flushInFlight[table];
  if (existingFlush) return existingFlush;

  const nextFlush = (async () => {
    try {
      await flushTable(table);
    } finally {
      delete flushInFlight[table];
    }
  })();
  flushInFlight[table] = nextFlush;
  return nextFlush;
}

export async function flushAnalytics(): Promise<void> {
  await Promise.all(Object.values(flushInFlight).map(flush => flush.catch(() => undefined)));
  await flushTableQueued("mcp_initializations");
  await flushTableQueued("mcp_tool_calls");
}

function stringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function logInitialization(params: {
  protocolVersion: string;
  capabilities: unknown;
  clientName: string;
  clientVersion: string;
  rawBody: unknown;
}): void {
  enqueueRow("mcp_initializations", {
    method: "initialize",
    protocol_version: params.protocolVersion,
    capabilities: stringify(params.capabilities),
    client_name: params.clientName,
    client_version: params.clientVersion,
    raw_body: stringify(params.rawBody),
  });
}

export function logToolCallRequest(params: {
  toolName: string;
  requestId: string | null;
  sessionId: string | null;
  toolArgs: unknown;
  rawBody: unknown;
}): void {
  enqueueRow("mcp_tool_calls", {
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
  enqueueRow("mcp_tool_calls", {
    row_type: "response",
    tool_name: params.tool,
    request_id: null,
    session_id: null,
    arguments: stringify(params.req),
    response_text: params.res,
    raw_body: stringify(params.rawBody),
  });
}

export function bufferedAnalyticsRowCount(): number {
  return Object.values(buffers).reduce((total, rows) => total + rows.length, 0);
}
