import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HOST = "https://example.cloud.databricks.com";
const TOKEN = "pat-token";
const WAREHOUSE = "warehouse-1";
const TABLE = "main.solana_mcp.docs_chunks";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.DATABRICKS_HOST = HOST;
  process.env.DATABRICKS_TOKEN = TOKEN;
  process.env.DATABRICKS_WAREHOUSE_ID = WAREHOUSE;
  process.env.DATABRICKS_DOCS_TABLE = TABLE;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DATABRICKS_HOST;
  delete process.env.DATABRICKS_TOKEN;
  delete process.env.DATABRICKS_WAREHOUSE_ID;
  delete process.env.DATABRICKS_DOCS_TABLE;
  delete process.env.DATABRICKS_VS_INDEX;
});

async function importFresh() {
  vi.resetModules();
  return import("../../lib/services/databricks/docsLookup.js");
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("getChunksForSource", () => {
  it("returns [] when Databricks env is not configured", async () => {
    delete process.env.DATABRICKS_HOST;
    delete process.env.DATABRICKS_TOKEN;
    const { getChunksForSource } = await importFresh();
    const chunks = await getChunksForSource("anchor-docs");
    expect(chunks).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns [] when warehouse id is missing", async () => {
    delete process.env.DATABRICKS_WAREHOUSE_ID;
    const { getChunksForSource } = await importFresh();
    const chunks = await getChunksForSource("anchor-docs");
    expect(chunks).toEqual([]);
  });

  it("derives the docs table from DATABRICKS_VS_INDEX when DATABRICKS_DOCS_TABLE is unset", async () => {
    delete process.env.DATABRICKS_DOCS_TABLE;
    process.env.DATABRICKS_VS_INDEX = "main.solana_mcp.docs_chunks_idx";
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: { state: "SUCCEEDED" },
        manifest: { schema: { columns: [] } },
        result: { data_array: [] },
      }),
    );
    const { getChunksForSource } = await importFresh();
    await getChunksForSource("anchor-docs");
    const lastCall = fetchMock.mock.calls[0];
    const body = JSON.parse(String(lastCall?.[1]?.body ?? "{}"));
    expect(body.statement).toContain("FROM main.solana_mcp.docs_chunks");
  });

  it("issues a parameterized SQL statement and decodes manifest+row data", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: { state: "SUCCEEDED" },
        manifest: {
          schema: {
            columns: [
              { name: "url", type_name: "STRING" },
              { name: "title", type_name: "STRING" },
              { name: "heading_path", type_name: "ARRAY" },
              { name: "content", type_name: "STRING" },
            ],
          },
        },
        result: {
          data_array: [
            ["https://docs.example.com/a", "Page A", '["Top","Sub"]', "Body A"],
            ["https://docs.example.com/b", "Page B", ["Top"], "Body B"],
          ],
        },
      }),
    );
    const { getChunksForSource } = await importFresh();
    const chunks = await getChunksForSource("anchor-docs");

    expect(chunks).toEqual([
      { url: "https://docs.example.com/a", title: "Page A", headingPath: ["Top", "Sub"], content: "Body A" },
      { url: "https://docs.example.com/b", title: "Page B", headingPath: ["Top"], content: "Body B" },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toBe(`${HOST}/api/2.0/sql/statements`);
    const body = JSON.parse(String(init?.body ?? "{}"));
    expect(body.warehouse_id).toBe(WAREHOUSE);
    expect(body.statement).toContain("WHERE source_id = :source_id");
    expect(body.parameters).toEqual([{ name: "source_id", value: "anchor-docs", type: "STRING" }]);
  });

  it("throws when the SQL statement does not succeed", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: { state: "FAILED", error: { message: "syntax error" } },
        statement_id: "stmt-1",
      }),
    );
    const { getChunksForSource } = await importFresh();
    await expect(getChunksForSource("anchor-docs")).rejects.toThrow(/syntax error/);
  });

  it("polls the statement endpoint while the query is PENDING/RUNNING and succeeds when ready", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: { state: "PENDING" }, statement_id: "stmt-async" }))
      .mockResolvedValueOnce(jsonResponse({ status: { state: "RUNNING" }, statement_id: "stmt-async" }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: { state: "SUCCEEDED" },
          manifest: { schema: { columns: [{ name: "url", type_name: "STRING" }] } },
          result: { data_array: [["https://docs.example.com/a"]] },
          statement_id: "stmt-async",
        }),
      );
    try {
      const { getChunksForSource } = await importFresh();
      const promise = getChunksForSource("anchor-docs");
      await vi.runAllTimersAsync();
      const chunks = await promise;
      expect(chunks).toEqual([{ url: "https://docs.example.com/a", title: null, headingPath: null, content: null }]);
      // Initial POST + 2 GET polls
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[1][0]).toContain("/api/2.0/sql/statements/stmt-async");
    } finally {
      vi.useRealTimers();
    }
  });
});
