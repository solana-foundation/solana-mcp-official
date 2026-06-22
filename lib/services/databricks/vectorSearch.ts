import { isDatabricksConfigured, mcpToolCall } from "./client.js";
import { asNullableString } from "./utils.js";

export interface DocChunk {
  id: string;
  url: string | null;
  title: string | null;
  sourceId: string | null;
  content: string | null;
  score: number;
}

interface RawHit {
  id?: unknown;
  url?: unknown;
  title?: unknown;
  source_id?: unknown;
  content?: unknown;
  score?: unknown;
}

const REQUESTED_COLUMNS = ["id", "url", "title", "source_id", "content"] as const;
const RERANK_COLUMN = "content";

const DEFAULT_K = 20;
const MAX_K = 50;

function resolveK(k?: number): number {
  if (typeof k === "number" && Number.isInteger(k) && k > 0) return Math.min(k, MAX_K);
  const envK = Number(process.env.DATABRICKS_VS_K);
  if (Number.isInteger(envK) && envK > 0) return Math.min(envK, MAX_K);
  return DEFAULT_K;
}

interface McpTarget {
  path: string;
  tool: string;
}

function resolveMcpTarget(): McpTarget | null {
  const index = process.env.DATABRICKS_VS_INDEX;
  if (!index) return null;
  const parts = index.split(".");
  if (parts.length !== 3 || parts.some(part => part.length === 0)) {
    console.warn(`[vectorSearch] DATABRICKS_VS_INDEX="${index}" is not catalog.schema.index — retrieval disabled`);
    return null;
  }
  const [catalog, schema, name] = parts;
  return {
    path: `/api/2.0/mcp/ai-search/${catalog}/${schema}/${name}`,
    tool: `${catalog}__${schema}__${name}`,
  };
}

export async function searchDocs(query: string, k?: number): Promise<DocChunk[]> {
  const topK = resolveK(k);
  const target = resolveMcpTarget();
  if (!isDatabricksConfigured() || !target) {
    console.warn("[vectorSearch] DATABRICKS_VS_INDEX (or host/token) not set — retrieval disabled");
    return [];
  }

  const text = await mcpToolCall(
    target.path,
    target.tool,
    { query },
    {
      num_results: String(topK),
      columns: REQUESTED_COLUMNS.join(","),
      columns_to_rerank: RERANK_COLUMN,
      include_score: "true",
    },
  );

  const hits = parseHits(text);

  // Sort score-descending before dedupe so the highest-scored chunk per URL
  // is the one kept, independent of the server's result ordering.
  hits.sort((a, b) => b.score - a.score);
  return dedupeByUrl(hits).slice(0, topK);
}

function parseHits(text: string): DocChunk[] {
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.warn("[vectorSearch] ai-search MCP returned non-JSON content — no results");
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(hit => toChunk(hit as RawHit));
}

function toChunk(hit: RawHit): DocChunk {
  return {
    id: String(hit.id ?? ""),
    url: asNullableString(hit.url),
    title: asNullableString(hit.title),
    sourceId: asNullableString(hit.source_id),
    content: asNullableString(hit.content),
    score: Number(hit.score ?? 0),
  };
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
