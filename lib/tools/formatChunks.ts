import type { DocChunk } from "../services/databricks/vectorSearch.js";

export function formatChunksAsMarkdown(query: string, chunks: DocChunk[]): string {
  if (chunks.length === 0) {
    return `No relevant documentation found for: "${query}".`;
  }

  const sections = chunks.map((chunk, idx) => renderChunk(idx + 1, chunk));
  return `Top ${chunks.length} matches for "${query}":\n\n${sections.join("\n\n---\n\n")}`;
}

function renderChunk(position: number, chunk: DocChunk): string {
  const heading = renderHeading(position, chunk);
  const meta = renderMeta(chunk);
  const body = (chunk.content ?? "").trim();
  return [heading, meta, body].filter(Boolean).join("\n\n");
}

function renderHeading(position: number, chunk: DocChunk): string {
  if (chunk.title && chunk.url) return `### ${position}. [${chunk.title}](${chunk.url})`;
  if (chunk.title) return `### ${position}. ${chunk.title}`;
  if (chunk.url) return `### ${position}. ${chunk.url}`;
  return `### ${position}.`;
}

function renderMeta(chunk: DocChunk): string {
  const parts: string[] = [];
  if (chunk.sourceId) parts.push(`source: ${chunk.sourceId}`);
  parts.push(`score: ${chunk.score.toFixed(3)}`);
  return `_${parts.join(" · ")}_`;
}
