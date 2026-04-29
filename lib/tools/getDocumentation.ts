import { getSourceById, type RawSource } from "../sources.js";
import { getChunksForSource, type SourceChunk } from "../services/databricks/docsLookup.js";

const PER_SOURCE_BYTE_CAP = 50_000;
const TOTAL_BYTE_CAP = 200_000;
const FETCH_TIMEOUT_MS = 10_000;

interface SectionResult {
  source: RawSource;
  body: string;
}

interface FetchOk {
  ok: true;
  text: string;
}

interface FetchErr {
  ok: false;
  reason: string;
}

type FetchResult = FetchOk | FetchErr;

function llmsTxtUrl(source: RawSource): string {
  return `${source.primary_url.replace(/\/$/, "")}/llms.txt`;
}

async function tryFetchLlmsTxt(source: RawSource): Promise<FetchResult> {
  const url = llmsTxtUrl(source);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const text = await res.text();
    if (!text.trim()) return { ok: false, reason: "empty body" };
    return { ok: true, text };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function chunksToMarkdown(chunks: SourceChunk[]): string {
  if (chunks.length === 0) return "";

  const parts: string[] = [];
  let lastUrl: string | null = null;

  for (const chunk of chunks) {
    if (chunk.url && chunk.url !== lastUrl) {
      parts.push(`### ${chunk.title ?? chunk.url}\n_Source: ${chunk.url}_`);
      lastUrl = chunk.url;
    }
    if (chunk.headingPath && chunk.headingPath.length > 0) {
      parts.push(chunk.headingPath.join(" > "));
    }
    if (chunk.content) parts.push(chunk.content);
  }
  return parts.join("\n\n");
}

function applyByteCap(text: string, cap: number): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false };
  return { text: text.slice(0, cap), truncated: true };
}

function pointerBody(source: RawSource, reason: string): string {
  return [
    `_${source.use_cases}_`,
    "",
    `**Primary:** ${source.primary_url}`,
    "",
    `No bundled docs available (${reason}). Use \`Solana_Documentation_Search\` for specific questions about this source.`,
  ].join("\n");
}

async function fetchOne(source: RawSource): Promise<SectionResult> {
  const llms = await tryFetchLlmsTxt(source);
  if (llms.ok) {
    const { text, truncated } = applyByteCap(llms.text, PER_SOURCE_BYTE_CAP);
    const note = truncated ? `\n\n_[truncated at ${PER_SOURCE_BYTE_CAP} chars]_` : "";
    return { source, body: text + note };
  }

  let chunks: SourceChunk[] = [];
  try {
    chunks = await getChunksForSource(source.id);
  } catch (err) {
    console.warn(`[getDocumentation] chunk lookup failed for ${source.id}:`, err);
  }

  if (chunks.length === 0) {
    return { source, body: pointerBody(source, llms.reason) };
  }

  const stitched = chunksToMarkdown([...chunks]);
  const { text, truncated } = applyByteCap(stitched, PER_SOURCE_BYTE_CAP);
  const note = truncated
    ? `\n\n_[truncated at ${PER_SOURCE_BYTE_CAP} chars; use Solana_Documentation_Search for specific topics]_`
    : "";
  return { source, body: text + note };
}

function notFoundResult(requested: string): SectionResult {
  const fakeSource: RawSource = {
    id: requested,
    name: requested,
    kind: "web",
    enabled: false,
    primary_url: "",
    sections: [],
    use_cases: "",
  };
  return {
    source: fakeSource,
    body: `Section id not found: "${requested}". Call \`list_sections\` to see available ids.`,
  };
}

export function normalizeSections(input: string | string[]): string[] {
  if (Array.isArray(input)) return input.filter(s => typeof s === "string" && s.trim()).map(s => s.trim());
  if (typeof input !== "string") return [];
  const trimmed = input.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed))
        return parsed.filter((s): s is string => typeof s === "string" && s.trim() !== "").map(s => s.trim());
    } catch {
      /* fall through to single string */
    }
  }
  return trimmed ? [trimmed] : [];
}

export async function fetchDocumentation(
  input: string | string[],
  fetchSource: (s: RawSource) => Promise<SectionResult> = fetchOne,
): Promise<string> {
  const requested = normalizeSections(input);
  if (requested.length === 0) {
    return "No sections requested. Pass `section` as a string or array of source ids (call `list_sections` to see available ids).";
  }

  const seen = new Set<string>();
  const orderedIds: string[] = [];
  const tasks: Promise<SectionResult>[] = [];

  for (const id of requested) {
    if (seen.has(id)) continue;
    seen.add(id);
    orderedIds.push(id);
    const source = getSourceById(id);
    if (!source) {
      tasks.push(Promise.resolve(notFoundResult(id)));
      continue;
    }
    tasks.push(fetchSource(source));
  }

  const settled = await Promise.allSettled(tasks);
  const results: SectionResult[] = settled.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    const id = orderedIds[i] ?? "?";
    return {
      source: { id, name: id, kind: "web", enabled: false, primary_url: "", sections: [], use_cases: "" },
      body: `Failed to fetch documentation: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
    };
  });

  let total = 0;
  const blocks: string[] = [];
  for (const { source, body } of results) {
    const heading = `## ${source.name || source.id}`;
    const block = `${heading}\n\n${body}`;
    if (total + block.length > TOTAL_BYTE_CAP) {
      blocks.push(`_[remaining sections omitted; total response cap of ${TOTAL_BYTE_CAP} chars reached]_`);
      break;
    }
    blocks.push(block);
    total += block.length;
  }

  return blocks.join("\n\n---\n\n");
}
