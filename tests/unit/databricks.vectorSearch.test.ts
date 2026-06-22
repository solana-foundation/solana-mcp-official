import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HOST = "https://dbc-test.cloud.databricks.com";
const TOKEN = "dapi-test-token";
const INDEX = "test_catalog.test_schema.docs_chunks_idx";
const MCP_URL = `${HOST}/api/2.0/mcp/ai-search/test_catalog/test_schema/docs_chunks_idx`;
const TOOL = "test_catalog__test_schema__docs_chunks_idx";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mcpResponse(hits: unknown[], opts: { isError?: boolean } = {}): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: JSON.stringify(hits) }],
      isError: opts.isError ?? false,
    },
  });
}

interface ToolCallBody {
  method: string;
  params: {
    name: string;
    arguments: { query: string };
    _meta: Record<string, string>;
  };
}

describe("databricks vectorSearch (managed AI Search MCP)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    process.env.DATABRICKS_HOST = HOST;
    process.env.DATABRICKS_TOKEN = TOKEN;
    process.env.DATABRICKS_VS_INDEX = INDEX;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DATABRICKS_HOST;
    delete process.env.DATABRICKS_TOKEN;
    delete process.env.DATABRICKS_VS_INDEX;
    delete process.env.DATABRICKS_VS_K;
  });

  it("returns [] and warns when index env missing, without calling fetch", async () => {
    delete process.env.DATABRICKS_VS_INDEX;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");

    const result = await searchDocs("whatever");
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns [] and warns when index is not catalog.schema.index, without calling fetch", async () => {
    process.env.DATABRICKS_VS_INDEX = "only_two.parts";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");

    const result = await searchDocs("whatever");
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns [] when host/token missing, without calling fetch", async () => {
    delete process.env.DATABRICKS_TOKEN;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");

    const result = await searchDocs("whatever");
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("calls the ai-search MCP tool with query + _meta (num_results = k, no oversample)", async () => {
    fetchMock.mockResolvedValueOnce(mcpResponse([]));

    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");
    await searchDocs("how to derive a PDA", 5);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(MCP_URL);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Accept")).toContain("text/event-stream");

    const body = JSON.parse(init.body as string) as ToolCallBody;
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe(TOOL);
    expect(body.params.arguments.query).toBe("how to derive a PDA");
    expect(body.params._meta.num_results).toBe("5");
    expect(body.params._meta.columns).toBe("id,url,title,source_id,content");
    expect(body.params._meta.columns_to_rerank).toBe("content");
    expect(body.params._meta.include_score).toBe("true");
  });

  it("parses the JSON content array into DocChunk[]", async () => {
    fetchMock.mockResolvedValueOnce(
      mcpResponse([
        {
          id: "abc",
          url: "https://github.com/codama-idl/codama",
          title: "codama/README.md",
          source_id: "gh-codama",
          content: "Codama overview",
          score: 0.83,
        },
        {
          id: "def",
          url: "https://www.anchor-lang.com/docs/pda",
          title: "Anchor PDA",
          source_id: "anchor-docs",
          content: "How to derive...",
          score: 0.71,
        },
        { id: "ghi", url: null, title: null, source_id: null, content: null, score: 0.5 },
      ]),
    );

    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");
    const chunks = await searchDocs("pda");

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({
      id: "abc",
      url: "https://github.com/codama-idl/codama",
      title: "codama/README.md",
      sourceId: "gh-codama",
      content: "Codama overview",
      score: 0.83,
    });
    expect(chunks[2].sourceId).toBeNull();
    expect(chunks[2].url).toBeNull();
    expect(chunks[2].title).toBeNull();
    expect(chunks[2].content).toBeNull();
    expect(chunks[2].score).toBe(0.5);
  });

  it("dedupes chunks by URL, keeping highest-scored, then trims to k", async () => {
    fetchMock.mockResolvedValueOnce(
      mcpResponse([
        {
          id: "a",
          url: "https://solana.com/versions",
          title: "Versioned",
          source_id: "solana-docs",
          content: "best chunk",
          score: 0.9,
        },
        {
          id: "b",
          url: "https://solana.com/versions",
          title: "Versioned",
          source_id: "solana-docs",
          content: "dup chunk",
          score: 0.89,
        },
        {
          id: "c",
          url: "https://solana.com/versions",
          title: "Versioned",
          source_id: "solana-docs",
          content: "another dup",
          score: 0.88,
        },
        {
          id: "d",
          url: "https://solana.com/pda",
          title: "PDA",
          source_id: "solana-docs",
          content: "pda content",
          score: 0.7,
        },
        {
          id: "e",
          url: "https://www.anchor-lang.com/pda",
          title: "Anchor PDA",
          source_id: "anchor-docs",
          content: "anchor content",
          score: 0.65,
        },
      ]),
    );

    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");
    const chunks = await searchDocs("versioned", 3);

    expect(chunks).toHaveLength(3);
    expect(chunks[0].id).toBe("a");
    expect(chunks[1].id).toBe("d");
    expect(chunks[2].id).toBe("e");
  });

  it("falls back to id as dedupe key when url is null", async () => {
    fetchMock.mockResolvedValueOnce(
      mcpResponse([
        { id: "id-1", url: null, title: "T1", source_id: null, content: "c1", score: 0.8 },
        { id: "id-2", url: null, title: "T2", source_id: null, content: "c2", score: 0.7 },
      ]),
    );

    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");
    const chunks = await searchDocs("x", 5);
    expect(chunks.map(c => c.id)).toEqual(["id-1", "id-2"]);
  });

  it("defaults k to 20 (num_results=20) when no arg or env", async () => {
    fetchMock.mockResolvedValueOnce(mcpResponse([]));
    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");
    await searchDocs("hello");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((JSON.parse(init.body as string) as ToolCallBody).params._meta.num_results).toBe("20");
  });

  it("reads DATABRICKS_VS_K env when arg omitted", async () => {
    process.env.DATABRICKS_VS_K = "12";
    fetchMock.mockResolvedValueOnce(mcpResponse([]));
    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");
    await searchDocs("hello");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((JSON.parse(init.body as string) as ToolCallBody).params._meta.num_results).toBe("12");
  });

  it("caps k at 50 regardless of arg or env", async () => {
    fetchMock.mockResolvedValueOnce(mcpResponse([]));
    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");
    await searchDocs("hello", 9999);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((JSON.parse(init.body as string) as ToolCallBody).params._meta.num_results).toBe("50");
  });

  it("handles empty result set", async () => {
    fetchMock.mockResolvedValueOnce(mcpResponse([]));
    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");
    const chunks = await searchDocs("nothing matches");
    expect(chunks).toEqual([]);
  });

  it("returns [] when the tool returns non-JSON content", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "not json at all" }], isError: false },
      }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");
    const chunks = await searchDocs("x");
    expect(chunks).toEqual([]);
    warnSpy.mockRestore();
  });

  it("throws when the tool result is flagged isError", async () => {
    fetchMock.mockResolvedValueOnce(mcpResponse([], { isError: true }));
    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");
    await expect(searchDocs("x")).rejects.toThrow(/failed/);
  });
});
