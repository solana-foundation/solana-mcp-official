import * as dotenv from "dotenv";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

type Keyword = string | string[];

interface Question {
  id: string;
  category: string;
  question: string;
  expected_keywords?: Keyword[];
}

interface CallResult {
  text: string;
  latency_ms: number;
  length: number;
  citations: string[];
  error?: string;
}

interface Endpoint {
  name: string;
  url: string;
  token: string;
}

interface QuestionResult {
  question: Question;
  responses: Record<string, CallResult>;
}

const TOOL = process.env.EVAL_TOOL ?? "Solana_Documentation_Search";

const USAGE = `Usage:
  pnpm dlx tsx eval/run.ts --endpoint <name>=<url> [--endpoint <name>=<url> ...]

Endpoints can also come from EVAL_ENDPOINTS="name=url,name=url".
Bearer tokens: EVAL_TOKEN_<NAME> (name uppercased, dashes to underscores).
See eval/README.md.`;

function parseArgs(argv: string[]): Endpoint[] {
  const endpoints: Endpoint[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--endpoint") {
      const spec = argv[++i];
      if (!spec) throw new Error(`--endpoint requires <name>=<url>\n${USAGE}`);
      endpoints.push(parseEndpointSpec(spec));
    } else {
      throw new Error(`unknown argument: ${arg}\n${USAGE}`);
    }
  }
  if (!endpoints.length && process.env.EVAL_ENDPOINTS) {
    for (const spec of process.env.EVAL_ENDPOINTS.split(",")) {
      endpoints.push(parseEndpointSpec(spec.trim()));
    }
  }
  if (!endpoints.length) throw new Error(`no endpoints configured\n${USAGE}`);
  const names = new Set(endpoints.map(e => e.name));
  if (names.size !== endpoints.length) throw new Error("duplicate endpoint names");
  return endpoints;
}

function parseEndpointSpec(spec: string): Endpoint {
  const eq = spec.indexOf("=");
  if (eq < 1) throw new Error(`bad endpoint spec "${spec}", expected <name>=<url>\n${USAGE}`);
  const name = spec.slice(0, eq);
  const url = spec.slice(eq + 1);
  if (!/^https?:\/\//.test(url)) throw new Error(`bad endpoint url "${url}"`);
  const tokenVar = `EVAL_TOKEN_${name.toUpperCase().replace(/-/g, "_")}`;
  const token = process.env[tokenVar] ?? "";
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url);
  if (token && !url.startsWith("https://") && !isLocal) {
    throw new Error(`endpoint "${name}" must use HTTPS when ${tokenVar} is set`);
  }
  return { name, url, token };
}

function loadQuestions(): Question[] {
  const raw = readFileSync(join(__dirname, "questions.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line) as Question);
}

function parseSseOrJson(body: string): { text: string } {
  const dataLine = body
    .split("\n")
    .map(l => l.trim())
    .find(l => l.startsWith("data: "));
  const payload = dataLine ? dataLine.slice("data: ".length) : body.trim();
  try {
    const rpc = JSON.parse(payload) as {
      result?: { content?: Array<{ type: string; text?: string }> };
    };
    const parts = rpc.result?.content ?? [];
    const text = parts
      .filter(p => p.type === "text" && typeof p.text === "string")
      .map(p => p.text as string)
      .join("\n");
    return { text };
  } catch {
    return { text: body };
  }
}

function extractCitations(text: string): string[] {
  const md = Array.from(text.matchAll(/\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/g), m => m[1]);
  const bare = Array.from(text.matchAll(/\bhttps?:\/\/[^\s)]+/g), m => m[0]);
  return Array.from(new Set([...md, ...bare]));
}

function rpcHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "X-Eval": "1",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function callTool(endpoint: Endpoint, question: string, argKey: "query" | "question"): Promise<CallResult> {
  const started = Date.now();
  const body = {
    jsonrpc: "2.0",
    id: Math.floor(Math.random() * 1e9),
    method: "tools/call",
    params: { name: TOOL, arguments: { [argKey]: question } },
  };
  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: rpcHeaders(endpoint.token),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const bodyText = await res.text();
    const latency_ms = Date.now() - started;
    if (!res.ok) {
      return {
        text: bodyText.slice(0, 2000),
        latency_ms,
        length: bodyText.length,
        citations: [],
        error: `HTTP ${res.status}`,
      };
    }
    const { text } = parseSseOrJson(bodyText);
    return {
      text,
      latency_ms,
      length: text.length,
      citations: extractCitations(text),
    };
  } catch (err) {
    return {
      text: "",
      latency_ms: Date.now() - started,
      length: 0,
      citations: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function mdSafe(s: string): string {
  return s.replace(/`/g, "\\`");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function renderQuestion(outDir: string, r: QuestionResult, endpoints: Endpoint[]): string {
  const file = `${r.question.id}-${slugify(r.question.question)}.md`;
  const path = join(outDir, file);
  const lines: string[] = [];
  lines.push(`# ${r.question.id}: ${r.question.question}`);
  lines.push("");
  lines.push(`**Category:** ${r.question.category}`);
  if (r.question.expected_keywords?.length) {
    lines.push(`**Expected keywords:** ${r.question.expected_keywords.map(keywordLabel).join(", ")}`);
  }
  for (const e of endpoints) {
    lines.push("");
    lines.push(`## ${e.name}`);
    lines.push(renderSide(r.responses[e.name], r.question.expected_keywords));
  }
  writeFileSync(path, lines.join("\n"));
  return file;
}

function renderSide(c: CallResult, keywords?: Keyword[]): string {
  const hits = keywords ? keywords.filter(k => keywordHit(c.text, k)) : [];
  const meta = [
    `latency ${c.latency_ms} ms`,
    `length ${c.length} chars`,
    `citations ${c.citations.length}`,
    keywords ? `keywords ${hits.length}/${keywords.length}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const parts: string[] = [`_${meta}_`, ""];
  if (c.error) parts.push(`> error: ${mdSafe(c.error)}`, "");
  parts.push(c.text || "_(empty)_");
  return parts.join("\n");
}

function endpointStats(results: QuestionResult[], name: string) {
  const calls = results.map(r => r.responses[name]);
  const kwPairs = results.filter(r => r.question.expected_keywords?.length);
  return {
    p50LatencyMs: median(calls.map(c => c.latency_ms)),
    errors: calls.filter(c => c.error).length,
    keywordRate: avg(kwPairs.map(r => kwHits(r.responses[name], r.question.expected_keywords ?? []))),
  };
}

function aggregateLines(results: QuestionResult[], endpoints: Endpoint[]): string[] {
  const lines: string[] = [];
  lines.push(`| Metric | ${endpoints.map(e => e.name).join(" | ")} |`);
  lines.push(`| --- |${endpoints.map(() => " --- |").join("")}`);
  const stats = endpoints.map(e => endpointStats(results, e.name));
  lines.push(`| median latency (ms) | ${stats.map(s => s.p50LatencyMs).join(" | ")} |`);
  lines.push(`| errors | ${stats.map(s => s.errors).join(" | ")} |`);
  lines.push(`| avg keyword hit rate | ${stats.map(s => s.keywordRate.toFixed(2)).join(" | ")} |`);
  const categories = Array.from(new Set(results.map(r => r.question.category)));
  for (const cat of categories) {
    const subset = results.filter(r => r.question.category === cat);
    const rates = endpoints.map(e => endpointStats(subset, e.name).keywordRate.toFixed(2));
    lines.push(`| keyword rate · ${cat} (${subset.length}) | ${rates.join(" | ")} |`);
  }
  return lines;
}

function renderIndex(outDir: string, results: QuestionResult[], files: string[], endpoints: Endpoint[]): void {
  const lines: string[] = [];
  lines.push(`# Eval run ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`Tool: \`${TOOL}\`  |  Questions: ${results.length}`);
  lines.push("");
  lines.push("## Aggregate");
  lines.push("");
  lines.push(...aggregateLines(results, endpoints));
  lines.push("");
  lines.push("## Questions");
  lines.push("");
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`- [${r.question.id} · ${r.question.category} · ${r.question.question}](./${files[i]})`);
  }
  writeFileSync(join(outDir, "index.md"), lines.join("\n"));
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function avg(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function keywordHit(text: string, kw: Keyword): boolean {
  const variants = Array.isArray(kw) ? kw : [kw];
  const lower = text.toLowerCase();
  return variants.some(v => lower.includes(v.toLowerCase()));
}

function keywordLabel(kw: Keyword): string {
  return Array.isArray(kw) ? kw.join(" | ") : kw;
}

function kwHits(c: CallResult, kws: Keyword[]): number {
  if (!kws.length) return 0;
  const hits = kws.filter(k => keywordHit(c.text, k)).length;
  return hits / kws.length;
}

async function main(): Promise<void> {
  const endpoints = parseArgs(process.argv.slice(2));
  const questions = loadQuestions();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = process.env.EVAL_OUT || join(__dirname, "results", ts);
  mkdirSync(outDir, { recursive: true });
  console.warn(`[eval] ${questions.length} questions × ${endpoints.map(e => e.name).join(", ")} → ${outDir}`);

  const argKey = TOOL === "Solana_Expert__Ask_For_Help" ? "question" : "query";
  const results: QuestionResult[] = [];
  const files: string[] = [];
  for (const q of questions) {
    console.warn(`[eval] ${q.id} ${q.category} ${q.question.slice(0, 60)}`);
    const calls = await Promise.all(endpoints.map(e => callTool(e, q.question, argKey)));
    const responses: Record<string, CallResult> = {};
    endpoints.forEach((e, i) => {
      responses[e.name] = calls[i];
    });
    const result: QuestionResult = { question: q, responses };
    results.push(result);
    files.push(renderQuestion(outDir, result, endpoints));
  }

  renderIndex(outDir, results, files, endpoints);
  writeFileSync(join(outDir, "raw.jsonl"), results.map(r => JSON.stringify(r)).join("\n") + "\n");
  console.warn("");
  console.warn(aggregateLines(results, endpoints).join("\n"));
  console.warn("");
  console.warn(`[eval] done. Open ${join(outDir, "index.md")}`);
}

void main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
