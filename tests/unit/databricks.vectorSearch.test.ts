import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HOST = "https://dbc-test.cloud.databricks.com";
const TOKEN = "dapi-test-token";
const INDEX = "test_catalog.test_schema.docs_chunks_idx";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("databricks vectorSearch", () => {
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

  it("returns [] when host/token missing, without calling fetch", async () => {
    delete process.env.DATABRICKS_TOKEN;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");

    const result = await searchDocs("whatever");
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("POSTs to the query endpoint with oversampled num_results (k*3)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        manifest: {
          columns: [
            { name: "id" },
            { name: "url" },
            { name: "title" },
            { name: "source_id" },
            { name: "content" },
            { name: "score" },
          ],
        },
        result: { data_array: [] },
      }),
    );

    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");
    await searchDocs("how to derive a PDA", 5);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${HOST}/api/2.0/vector-search/indexes/${INDEX}/query`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as {
      query_text: string;
      columns: string[];
      num_results: number;
    };
    expect(body.query_text).toBe("how to derive a PDA");
    expect(body.num_results).toBe(15);
    expect(body.columns).toEqual(["id", "url", "title", "source_id", "content"]);
  });

  it("parses rows via manifest column order into DocChunk[]", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        manifest: {
          columns: [
            { name: "score" },
            { name: "source_id" },
            { name: "id" },
            { name: "url" },
            { name: "title" },
            { name: "content" },
          ],
        },
        result: {
          data_array: [
            [0.83, "gh-codama", "abc", "https://github.com/codama-idl/codama", "codama/README.md", "Codama overview"],
            [0.71, "anchor-docs", "def", "https://www.anchor-lang.com/docs/pda", "Anchor PDA", "How to derive..."],
            [0.5, null, "ghi", null, null, null],
          ],
        },
      }),
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
      jsonResponse({
        manifest: {
          columns: [
            { name: "id" },
            { name: "url" },
            { name: "title" },
            { name: "source_id" },
            { name: "content" },
            { name: "score" },
          ],
        },
        result: {
          data_array: [
            ["a", "https://solana.com/versions", "Versioned", "solana-docs", "best chunk", 0.9],
            ["b", "https://solana.com/versions", "Versioned", "solana-docs", "dup chunk", 0.89],
            ["c", "https://solana.com/versions", "Versioned", "solana-docs", "another dup", 0.88],
            ["d", "https://solana.com/pda", "PDA", "solana-docs", "pda content", 0.7],
            ["e", "https://www.anchor-lang.com/pda", "Anchor PDA", "anchor-docs", "anchor content", 0.65],
          ],
        },
      }),
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
      jsonResponse({
        manifest: {
          columns: [
            { name: "id" },
            { name: "url" },
            { name: "title" },
            { name: "source_id" },
            { name: "content" },
            { name: "score" },
          ],
        },
        result: {
          data_array: [
            ["id-1", null, "T1", null, "c1", 0.8],
            ["id-2", null, "T2", null, "c2", 0.7],
          ],
        },
      }),
    );

    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");
    const chunks = await searchDocs("x", 5);
    expect(chunks.map(c => c.id)).toEqual(["id-1", "id-2"]);
  });

  it("defaults k to 20 (oversampled num_results=60) when no arg or env", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        manifest: { columns: [{ name: "id" }, { name: "score" }] },
        result: { data_array: [] },
      }),
    );
    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");
    await searchDocs("hello");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).num_results).toBe(60);
  });

  it("reads DATABRICKS_VS_K env when arg omitted", async () => {
    process.env.DATABRICKS_VS_K = "12";
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        manifest: { columns: [{ name: "id" }, { name: "score" }] },
        result: { data_array: [] },
      }),
    );
    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");
    await searchDocs("hello");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).num_results).toBe(36); // 12 * 3
  });

  it("caps k at 50 regardless of arg or env", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        manifest: { columns: [{ name: "id" }, { name: "score" }] },
        result: { data_array: [] },
      }),
    );
    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");
    await searchDocs("hello", 9999);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).num_results).toBe(150); // 50 * 3
  });

  it("handles empty result set", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        manifest: { columns: [{ name: "id" }, { name: "score" }] },
        result: { data_array: [] },
      }),
    );

    const { searchDocs } = await import("../../lib/services/databricks/vectorSearch.js");
    const chunks = await searchDocs("nothing matches");
    expect(chunks).toEqual([]);
  });
});
