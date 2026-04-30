import { dbxFetch, isDatabricksConfigured } from "./client.js";
import { rerank } from "./rerank.js";
import { asNullableString, getColumn } from "./utils.js";

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
const DEFAULT_K = 20;
const MAX_K = 50;

function resolveK(k?: number): number {
  if (typeof k === "number" && Number.isInteger(k) && k > 0) return Math.min(k, MAX_K);
  const envK = Number(process.env.DATABRICKS_VS_K);
  if (Number.isInteger(envK) && envK > 0) return Math.min(envK, MAX_K);
  return DEFAULT_K;
}

export async function searchDocs(query: string, k?: number): Promise<DocChunk[]> {
  const topK = resolveK(k);
  const index = process.env.DATABRICKS_VS_INDEX;
  if (!isDatabricksConfigured() || !index) {
    console.warn("[vectorSearch] DATABRICKS_VS_INDEX (or host/token) not set — retrieval disabled");
    return [];
  }

  const body = {
    query_text: query,
    columns: [...REQUESTED_COLUMNS],
    num_results: topK * OVERSAMPLE_MULTIPLIER,
  };

  const res = await dbxFetch<VsQueryResponse>(`/api/2.0/vector-search/indexes/${index}/query`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  const columns = res.manifest?.columns?.map(c => c.name) ?? [];
  const rows = res.result?.data_array ?? [];
  const chunks = rows.map(row => rowToChunk(columns, row));

  // Optionally replace embedding-similarity scores with reranker scores
  // (cross-encoder). Skipped when DATABRICKS_RERANKER_ENDPOINT is unset.
  const reranked = await maybeRerank(query, chunks);

  // Sort score-descending before dedupe so the highest-scored chunk per URL
  // is kept, independent of any ordering guarantee from the Databricks API
  // (or the reranker).
  reranked.sort((a, b) => b.score - a.score);
  return dedupeByUrl(reranked).slice(0, topK);
}

async function maybeRerank(query: string, chunks: DocChunk[]): Promise<DocChunk[]> {
  if (chunks.length === 0) return chunks;
  try {
    const scores = await rerank(
      query,
      chunks.map(c => c.content ?? ""),
    );
    // Require full coverage: a partial response would mix cross-encoder
    // scores with embedding cosine scores (different scales), producing a
    // meaningless sort. Fall back whenever the reranker doesn't cover every
    // chunk so the ranking stays internally consistent.
    if (!scores || scores.length < chunks.length) {
      if (scores && scores.length < chunks.length) {
        console.warn(
          `[vectorSearch] rerank returned ${scores.length}/${chunks.length} scores — falling back to embedding scores`,
        );
      }
      return chunks;
    }
    const byIndex = new Map(scores.map(s => [s.index, s.score]));
    return chunks.map((c, i) => {
      const s = byIndex.get(i);
      return typeof s === "number" ? { ...c, score: s } : c;
    });
  } catch (err) {
    console.warn("[vectorSearch] rerank failed, falling back to embedding scores:", err);
    return chunks;
  }
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
  return {
    id: String(getColumn(columns, row, "id") ?? ""),
    url: asNullableString(getColumn(columns, row, "url")),
    title: asNullableString(getColumn(columns, row, "title")),
    sourceId: asNullableString(getColumn(columns, row, "source_id")),
    content: asNullableString(getColumn(columns, row, "content")),
    score: Number(getColumn(columns, row, "score") ?? 0),
  };
}
