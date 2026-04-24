import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HOST = "https://dbc-test.cloud.databricks.com";
const TOKEN = "dapi-test-token";
const ENDPOINT = "databricks-claude-haiku-4-5";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function chatReply(content: string): { choices: [{ message: { content: string } }] } {
  return { choices: [{ message: { content } }] };
}

describe("databricks rerank (chat-model based)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    process.env.DATABRICKS_HOST = HOST;
    process.env.DATABRICKS_TOKEN = TOKEN;
    process.env.DATABRICKS_RERANKER_ENDPOINT = ENDPOINT;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DATABRICKS_HOST;
    delete process.env.DATABRICKS_TOKEN;
    delete process.env.DATABRICKS_RERANKER_ENDPOINT;
  });

  it("returns null when endpoint env missing, no fetch", async () => {
    delete process.env.DATABRICKS_RERANKER_ENDPOINT;
    const { rerank } = await import("../../lib/services/databricks/rerank.js");
    const out = await rerank("q", ["a", "b"]);
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns [] for empty texts, no fetch", async () => {
    const { rerank } = await import("../../lib/services/databricks/rerank.js");
    const out = await rerank("q", []);
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs chat invocations with expected messages + numbered docs", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(chatReply('[{"index":0,"score":0.9},{"index":1,"score":0.2}]')));
    const { rerank } = await import("../../lib/services/databricks/rerank.js");
    await rerank("how to derive a PDA", ["anchor pda docs", "unrelated text"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${HOST}/serving-endpoints/${ENDPOINT}/invocations`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as {
      messages: Array<{ role: string; content: string }>;
      temperature: number;
    };
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content).toContain("how to derive a PDA");
    expect(body.messages[1].content).toContain("[0] anchor pda docs");
    expect(body.messages[1].content).toContain("[1] unrelated text");
    expect(body.temperature).toBe(0);
  });

  it("parses a clean JSON-array reply", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(chatReply('[{"index":0,"score":0.5},{"index":1,"score":0.9},{"index":2,"score":0.1}]')),
    );
    const { rerank } = await import("../../lib/services/databricks/rerank.js");
    const out = await rerank("x", ["a", "b", "c"]);
    expect(out).toEqual([
      { index: 0, score: 0.5 },
      { index: 1, score: 0.9 },
      { index: 2, score: 0.1 },
    ]);
  });

  it("strips markdown code fences if the model adds them", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(chatReply('```json\n[{"index":0,"score":0.7},{"index":1,"score":0.2}]\n```')),
    );
    const { rerank } = await import("../../lib/services/databricks/rerank.js");
    const out = await rerank("x", ["a", "b"]);
    expect(out).toEqual([
      { index: 0, score: 0.7 },
      { index: 1, score: 0.2 },
    ]);
  });

  it("extracts JSON when wrapped in prose", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(chatReply('Here are the scores: [{"index":0,"score":0.3},{"index":1,"score":0.6}] Done.')),
    );
    const { rerank } = await import("../../lib/services/databricks/rerank.js");
    const out = await rerank("x", ["a", "b"]);
    expect(out).toEqual([
      { index: 0, score: 0.3 },
      { index: 1, score: 0.6 },
    ]);
  });

  it("drops out-of-range indices silently", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(chatReply('[{"index":0,"score":0.8},{"index":5,"score":0.9},{"index":1,"score":0.4}]')),
    );
    const { rerank } = await import("../../lib/services/databricks/rerank.js");
    const out = await rerank("x", ["a", "b"]);
    expect(out).toEqual([
      { index: 0, score: 0.8 },
      { index: 1, score: 0.4 },
    ]);
  });

  it("returns null when model reply is not parseable JSON", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(chatReply("I couldn't determine the scores.")));
    const { rerank } = await import("../../lib/services/databricks/rerank.js");
    const out = await rerank("x", ["a", "b"]);
    expect(out).toBeNull();
  });

  it("skips rerank and warns when endpoint env contains invalid characters", async () => {
    process.env.DATABRICKS_RERANKER_ENDPOINT = "../../admin";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { rerank } = await import("../../lib/services/databricks/rerank.js");
    const out = await rerank("x", ["a"]);
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("propagates HTTP errors from the reranker endpoint", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response("server exploded", { status: 500 }));
    const { rerank } = await import("../../lib/services/databricks/rerank.js");
    const p = rerank("x", ["a", "b"]);
    p.catch(() => undefined);
    await vi.runAllTimersAsync();
    await expect(p).rejects.toThrow(/500/);
    vi.useRealTimers();
  });
});
