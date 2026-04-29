import * as dotenv from "dotenv";
import { dbxFetch, isDatabricksConfigured } from "./client.js";

dotenv.config();

export interface SourceChunk {
  url: string | null;
  title: string | null;
  headingPath: string[] | null;
  content: string | null;
}

interface SqlExecuteResponse {
  status?: { state?: string; error?: { message?: string } };
  manifest?: { schema?: { columns?: { name: string; type_name: string }[] } };
  result?: { data_array?: unknown[][] };
  statement_id?: string;
}

const COLUMNS = ["url", "title", "heading_path", "content"] as const;
const STATEMENT_TIMEOUT = "30s";
const POLL_MAX_ATTEMPTS = 6;
const POLL_BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 8000];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function resolveDocsTable(): string | null {
  const explicit = process.env.DATABRICKS_DOCS_TABLE;
  if (explicit) return explicit;
  const idx = process.env.DATABRICKS_VS_INDEX;
  if (!idx) return null;
  if (idx.endsWith("_idx")) return idx.slice(0, -"_idx".length);
  console.warn(
    `[docsLookup] DATABRICKS_VS_INDEX="${idx}" does not end with "_idx" — cannot derive docs table. Set DATABRICKS_DOCS_TABLE explicitly to enable get_documentation tier-2 fallback.`,
  );
  return null;
}

function resolveWarehouse(): string | null {
  return process.env.DATABRICKS_WAREHOUSE_ID ?? null;
}

export async function getChunksForSource(sourceId: string, limit = 200): Promise<SourceChunk[]> {
  if (!isDatabricksConfigured()) return [];
  const table = resolveDocsTable();
  const warehouse = resolveWarehouse();
  if (!table || !warehouse) return [];

  const statement = `
    SELECT ${COLUMNS.join(", ")}
    FROM ${table}
    WHERE source_id = :source_id
    ORDER BY url ASC, heading_path ASC, id ASC
    LIMIT ${Number(limit)}
  `;

  let res = await dbxFetch<SqlExecuteResponse>("/api/2.0/sql/statements", {
    method: "POST",
    body: JSON.stringify({
      warehouse_id: warehouse,
      statement,
      parameters: [{ name: "source_id", value: sourceId, type: "STRING" }],
      wait_timeout: STATEMENT_TIMEOUT,
    }),
  });

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS && isPending(res.status?.state); attempt++) {
    if (!res.statement_id) break;
    await sleep(POLL_BACKOFF_MS[attempt] ?? POLL_BACKOFF_MS[POLL_BACKOFF_MS.length - 1]);
    res = await dbxFetch<SqlExecuteResponse>(`/api/2.0/sql/statements/${encodeURIComponent(res.statement_id)}`);
  }

  const state = res.status?.state;
  if (state !== "SUCCEEDED") {
    const errMsg = res.status?.error?.message ?? "(no error message)";
    throw new Error(`docs lookup for ${sourceId} ended in state ${state ?? "?"}: ${errMsg}`);
  }

  const cols = res.manifest?.schema?.columns?.map(c => c.name) ?? [];
  const rows = res.result?.data_array ?? [];
  return rows.map(row => rowToChunk(cols, row));
}

function isPending(state: string | undefined): boolean {
  return state === "PENDING" || state === "RUNNING";
}

function rowToChunk(cols: string[], row: unknown[]): SourceChunk {
  const get = (name: string): unknown => {
    const idx = cols.indexOf(name);
    return idx === -1 ? null : row[idx];
  };

  return {
    url: asNullableString(get("url")),
    title: asNullableString(get("title")),
    headingPath: parseHeadingPath(get("heading_path")),
    content: asNullableString(get("content")),
  };
}

function asNullableString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function parseHeadingPath(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return null;
    }
  }
  return null;
}
