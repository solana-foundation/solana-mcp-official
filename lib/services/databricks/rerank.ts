import { dbxFetch, isDatabricksConfigured } from "./client.js";

export interface RerankScore {
  index: number;
  score: number;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

const SYSTEM_PROMPT =
  "You are a relevance scoring engine. For each numbered document, rate how well it answers the user's query on a 0.0 to 1.0 scale " +
  "(1.0 = directly answers, 0.5 = related, 0.0 = irrelevant). " +
  'Return ONLY a JSON array of objects like [{"index":0,"score":0.87}, ...] covering every input document, sorted by index ascending. ' +
  "No prose, no markdown fences.";

const MAX_DOC_CHARS = 1500;

/**
 * Use a Databricks-served chat model as a cross-encoder-style reranker.
 * Returns scores aligned to the `texts` input order (by `index`). Returns
 * `null` when `DATABRICKS_RERANKER_ENDPOINT` is unset or the model reply
 * cannot be parsed as JSON (caller falls back to embedding scores).
 */
const ENDPOINT_NAME_PATTERN = /^[\w.-]+$/;

export async function rerank(query: string, texts: string[]): Promise<RerankScore[] | null> {
  const endpoint = process.env.DATABRICKS_RERANKER_ENDPOINT;
  if (!isDatabricksConfigured() || !endpoint) return null;
  if (!ENDPOINT_NAME_PATTERN.test(endpoint)) {
    console.warn("[rerank] DATABRICKS_RERANKER_ENDPOINT contains invalid characters — skipping rerank");
    return null;
  }
  if (texts.length === 0) return [];

  const docBlock = texts.map((t, i) => `[${i}] ${(t ?? "").slice(0, MAX_DOC_CHARS)}`).join("\n\n");

  const body = {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Query: ${query}\n\nDocuments:\n${docBlock}` },
    ],
    max_tokens: Math.min(64 + texts.length * 20, 2048),
    temperature: 0,
  };

  const res = await dbxFetch<ChatResponse>(`/serving-endpoints/${endpoint}/invocations`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  const content = res.choices?.[0]?.message?.content ?? "";
  return parseScores(content, texts.length);
}

function parseScores(raw: string, expected: number): RerankScore[] | null {
  const jsonText = extractJsonArray(raw);
  if (!jsonText) return null;
  try {
    const parsed: unknown = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return null;
    const scores: RerankScore[] = [];
    for (const entry of parsed) {
      if (entry && typeof entry === "object") {
        const idx = (entry as { index?: unknown }).index;
        const sc = (entry as { score?: unknown }).score;
        if (
          typeof idx === "number" &&
          Number.isInteger(idx) &&
          idx >= 0 &&
          idx < expected &&
          typeof sc === "number" &&
          Number.isFinite(sc)
        ) {
          scores.push({ index: idx, score: sc });
        }
      }
    }
    return scores.length > 0 ? scores : null;
  } catch {
    return null;
  }
}

function extractJsonArray(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) return trimmed;
  // Some models wrap output in ```json ... ``` despite the prompt.
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence) return fence[1].trim();
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return null;
}
