import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HOST = "https://dbc-test.cloud.databricks.com";
const TOKEN = "dapi-test-token";
const WAREHOUSE = "wh-test-123";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface RecordedRequest {
  url: string;
  body: {
    warehouse_id: string;
    statement: string;
    parameters: { name: string; value: string | null; type: string }[];
    wait_timeout: string;
  };
}

function recordedRequest(call: [string, RequestInit]): RecordedRequest {
  const [url, init] = call;
  return { url, body: JSON.parse(init.body as string) };
}

function findParam(req: RecordedRequest, name: string): string | null | undefined {
  return req.body.parameters.find(p => p.name === name)?.value;
}

describe("databricks analytics service", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(jsonResponse({ status: { state: "SUCCEEDED" } }));
    process.env.DATABRICKS_HOST = HOST;
    process.env.DATABRICKS_TOKEN = TOKEN;
    process.env.DATABRICKS_WAREHOUSE_ID = WAREHOUSE;
    process.env.DATABRICKS_ANALYTICS_SCHEMA = "test_catalog.test_schema";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DATABRICKS_HOST;
    delete process.env.DATABRICKS_TOKEN;
    delete process.env.DATABRICKS_WAREHOUSE_ID;
    delete process.env.DATABRICKS_ANALYTICS_SCHEMA;
    delete process.env.DATABRICKS_ANALYTICS_BATCH_SIZE;
    delete process.env.DATABRICKS_ANALYTICS_FLUSH_INTERVAL_MS;
    delete process.env.DATABRICKS_ANALYTICS_MAX_BUFFERED_ROWS;
  });

  describe("logInitialization", () => {
    it("skips and warns when warehouse id missing", async () => {
      delete process.env.DATABRICKS_WAREHOUSE_ID;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { logInitialization } = await import("../../lib/services/databricks/analytics.js");

      await logInitialization({
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientName: "codex",
        clientVersion: "1.0.0",
        rawBody: {},
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith("[analytics] Databricks env not set — analytics disabled");
      warnSpy.mockRestore();
    });

    it("skips and warns when host/token missing", async () => {
      delete process.env.DATABRICKS_TOKEN;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { logInitialization } = await import("../../lib/services/databricks/analytics.js");

      await logInitialization({
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientName: "codex",
        clientVersion: "1.0.0",
        rawBody: {},
      });

      expect(fetchMock).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("buffers initialization rows until flush", async () => {
      const { bufferedAnalyticsRowCount, flushAnalytics, logInitialization } =
        await import("../../lib/services/databricks/analytics.js");

      await logInitialization({
        protocolVersion: "2025-03-26",
        capabilities: { roots: { listChanged: true } },
        clientName: "codex",
        clientVersion: "1.2.3",
        rawBody: { method: "initialize" },
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(bufferedAnalyticsRowCount()).toBe(1);

      await flushAnalytics();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const req = recordedRequest(fetchMock.mock.calls[0] as [string, RequestInit]);
      expect(req.url).toBe(`${HOST}/api/2.0/sql/statements`);
      expect(req.body.warehouse_id).toBe(WAREHOUSE);
      expect(req.body.statement).toContain("mcp_initializations");

      expect(findParam(req, "r0_method")).toBe("initialize");
      expect(findParam(req, "r0_protocol_version")).toBe("2025-03-26");
      expect(findParam(req, "r0_client_name")).toBe("codex");
      expect(findParam(req, "r0_client_version")).toBe("1.2.3");
      expect(findParam(req, "r0_capabilities")).toBe(JSON.stringify({ roots: { listChanged: true } }));
      expect(findParam(req, "r0_raw_body")).toBe(JSON.stringify({ method: "initialize" }));
      expect(bufferedAnalyticsRowCount()).toBe(0);
    });

    it("flushes automatically when the batch size is reached", async () => {
      process.env.DATABRICKS_ANALYTICS_BATCH_SIZE = "2";
      const { logInitialization } = await import("../../lib/services/databricks/analytics.js");

      await logInitialization({
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientName: "codex",
        clientVersion: "1.0.0",
        rawBody: { id: 1 },
      });
      expect(fetchMock).not.toHaveBeenCalled();

      await logInitialization({
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientName: "cursor",
        clientVersion: "2.0.0",
        rawBody: { id: 2 },
      });

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const req = recordedRequest(fetchMock.mock.calls[0] as [string, RequestInit]);
      expect(req.body.parameters).toHaveLength(14);
      expect(findParam(req, "r0_client_name")).toBe("codex");
      expect(findParam(req, "r1_client_name")).toBe("cursor");
    });
  });

  describe("logToolCallRequest", () => {
    it("skips when env missing", async () => {
      delete process.env.DATABRICKS_WAREHOUSE_ID;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { logToolCallRequest } = await import("../../lib/services/databricks/analytics.js");

      await logToolCallRequest({
        toolName: "Solana_Documentation_Search",
        requestId: "req-1",
        sessionId: "sess-1",
        toolArgs: { query: "accounts" },
        rawBody: {},
      });

      expect(fetchMock).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("buffers and flushes a request row with tool metadata", async () => {
      const { flushAnalytics, logToolCallRequest } = await import("../../lib/services/databricks/analytics.js");

      await logToolCallRequest({
        toolName: "Solana_Documentation_Search",
        requestId: "req-123",
        sessionId: "session-456",
        toolArgs: { query: "accounts" },
        rawBody: { method: "tools/call" },
      });

      expect(fetchMock).not.toHaveBeenCalled();

      await flushAnalytics();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const req = recordedRequest(fetchMock.mock.calls[0] as [string, RequestInit]);
      expect(req.body.statement).toContain("mcp_tool_calls");
      expect(findParam(req, "r0_row_type")).toBe("request");
      expect(findParam(req, "r0_tool_name")).toBe("Solana_Documentation_Search");
      expect(findParam(req, "r0_request_id")).toBe("req-123");
      expect(findParam(req, "r0_session_id")).toBe("session-456");
      expect(findParam(req, "r0_arguments")).toBe(JSON.stringify({ query: "accounts" }));
      expect(findParam(req, "r0_response_text")).toBeNull();
    });

    it("allows null requestId and sessionId", async () => {
      const { flushAnalytics, logToolCallRequest } = await import("../../lib/services/databricks/analytics.js");

      await logToolCallRequest({
        toolName: "Solana_Expert__Ask_For_Help",
        requestId: null,
        sessionId: null,
        toolArgs: {},
        rawBody: {},
      });

      await flushAnalytics();

      const req = recordedRequest(fetchMock.mock.calls[0] as [string, RequestInit]);
      expect(findParam(req, "r0_request_id")).toBeNull();
      expect(findParam(req, "r0_session_id")).toBeNull();
    });
  });

  describe("logToolCallResponse", () => {
    it("skips fire-and-forget when env missing", async () => {
      delete process.env.DATABRICKS_WAREHOUSE_ID;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { logToolCallResponse } = await import("../../lib/services/databricks/analytics.js");

      logToolCallResponse({
        tool: "Solana_Documentation_Search",
        req: "find docs",
        res: '{"content":[]}',
        rawBody: {},
      });

      await new Promise(resolve => process.nextTick(resolve));
      expect(fetchMock).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("buffers a response row without awaiting Databricks", async () => {
      const { flushAnalytics, logToolCallResponse } = await import("../../lib/services/databricks/analytics.js");

      logToolCallResponse({
        tool: "Solana_Documentation_Search",
        req: "find docs",
        res: '{"content":[]}',
        rawBody: { tool: "Solana_Documentation_Search" },
      });

      expect(fetchMock).not.toHaveBeenCalled();

      await flushAnalytics();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const req = recordedRequest(fetchMock.mock.calls[0] as [string, RequestInit]);
      expect(req.body.statement).toContain("mcp_tool_calls");
      expect(findParam(req, "r0_row_type")).toBe("response");
      expect(findParam(req, "r0_tool_name")).toBe("Solana_Documentation_Search");
      expect(findParam(req, "r0_response_text")).toBe('{"content":[]}');
      expect(findParam(req, "r0_arguments")).toBe(JSON.stringify("find docs"));
      expect(findParam(req, "r0_request_id")).toBeNull();
      expect(findParam(req, "r0_session_id")).toBeNull();
    });

    it("requeues rows when a flush fails", async () => {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(new Response("boom", { status: 400 }));
      const { bufferedAnalyticsRowCount, flushAnalytics, logToolCallResponse } =
        await import("../../lib/services/databricks/analytics.js");

      logToolCallResponse({
        tool: "Solana_Documentation_Search",
        req: "find docs",
        res: '{"content":[]}',
        rawBody: {},
      });

      await expect(flushAnalytics()).rejects.toBeInstanceOf(Error);
      expect(bufferedAnalyticsRowCount()).toBe(1);
    });
  });
});
