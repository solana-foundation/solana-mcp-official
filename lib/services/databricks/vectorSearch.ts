import * as dotenv from "dotenv";
import { dbxFetch, isDatabricksConfigured } from "./client.js";

dotenv.config();

export interface DocChunk {
  id: string;
  url: string | null;
  title: string | null;
  sourceId: string | null;
  content: string | null;
  score: number;
}

interface VsQueryResponse {
  manifest?: { columns?: { name: string }[] };
  result?: { data_array?: unknown[][] };
}

// `score` is always returned by Databricks Vector Search query responses, but
// only source-table columns belong in `columns`; the score arrives as a
// synthetic trailing field in each row. We still request the metadata columns
// we want materialized in the result.
const REQUESTED_COLUMNS = ["id", "url", "title", "source_id", "content"] as const;

const OVERSAMPLE_MULTIPLIER = 3;

export async function searchDocs(query: string, k = 8): Promise<DocChunk[]> {
  const index = process.env.DATABRICKS_VS_INDEX;
  if (!isDatabricksConfigured() || !index) {
    console.warn("[vectorSearch] DATABRICKS_VS_INDEX (or host/token) not set — retrieval disabled");
    return [];
  }

  const body = {
    query_text: query,
    columns: [...REQUESTED_COLUMNS],
    num_results: k * OVERSAMPLE_MULTIPLIER,
  };

  const res = await dbxFetch<VsQueryResponse>(`/api/2.0/vector-search/indexes/${index}/query`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  const columns = res.manifest?.columns?.map(c => c.name) ?? [];
  const rows = res.result?.data_array ?? [];
  const chunks = rows.map(row => rowToChunk(columns, row));

  // Sort score-descending before dedupe so the highest-scored chunk per URL
  // is kept, independent of any ordering guarantee from the Databricks API.
  chunks.sort((a, b) => b.score - a.score);
  return dedupeByUrl(chunks).slice(0, k);
}

function dedupeByUrl(chunks: DocChunk[]): DocChunk[] {
  const seen = new Set<string>();
  const out: DocChunk[] = [];
  for (const chunk of chunks) {
    const key = chunk.url ?? chunk.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(chunk);
  }
  return out;
}

function rowToChunk(columns: string[], row: unknown[]): DocChunk {
  const get = (name: string): unknown => {
    const idx = columns.indexOf(name);
    return idx === -1 ? null : row[idx];
  };

  return {
    id: String(get("id") ?? ""),
    url: asNullableString(get("url")),
    title: asNullableString(get("title")),
    sourceId: asNullableString(get("source_id")),
    content: asNullableString(get("content")),
    score: Number(get("score") ?? 0),
  };
}

function asNullableString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}
