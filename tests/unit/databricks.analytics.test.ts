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

    it("POSTs SQL statement with correct parameters", async () => {
      const { logInitialization } = await import("../../lib/services/databricks/analytics.js");

      await logInitialization({
        protocolVersion: "2025-03-26",
        capabilities: { roots: { listChanged: true } },
        clientName: "codex",
        clientVersion: "1.2.3",
        rawBody: { method: "initialize" },
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const req = recordedRequest(fetchMock.mock.calls[0] as [string, RequestInit]);
      expect(req.url).toBe(`${HOST}/api/2.0/sql/statements`);
      expect(req.body.warehouse_id).toBe(WAREHOUSE);
      expect(req.body.statement).toContain("mcp_initializations");

      expect(findParam(req, "method")).toBe("initialize");
      expect(findParam(req, "protocolVersion")).toBe("2025-03-26");
      expect(findParam(req, "clientName")).toBe("codex");
      expect(findParam(req, "clientVersion")).toBe("1.2.3");
      expect(findParam(req, "capabilities")).toBe(JSON.stringify({ roots: { listChanged: true } }));
      expect(findParam(req, "rawBody")).toBe(JSON.stringify({ method: "initialize" }));
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

    it("POSTs a request row with tool metadata", async () => {
      const { logToolCallRequest } = await import("../../lib/services/databricks/analytics.js");

      await logToolCallRequest({
        toolName: "Solana_Documentation_Search",
        requestId: "req-123",
        sessionId: "session-456",
        toolArgs: { query: "accounts" },
        rawBody: { method: "tools/call" },
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const req = recordedRequest(fetchMock.mock.calls[0] as [string, RequestInit]);
      expect(req.body.statement).toContain("mcp_tool_calls");
      expect(findParam(req, "rowType")).toBe("request");
      expect(findParam(req, "toolName")).toBe("Solana_Documentation_Search");
      expect(findParam(req, "requestId")).toBe("req-123");
      expect(findParam(req, "sessionId")).toBe("session-456");
      expect(findParam(req, "arguments")).toBe(JSON.stringify({ query: "accounts" }));
    });

    it("allows null requestId and sessionId", async () => {
      const { logToolCallRequest } = await import("../../lib/services/databricks/analytics.js");

      await logToolCallRequest({
        toolName: "Solana_Expert__Ask_For_Help",
        requestId: null,
        sessionId: null,
        toolArgs: {},
        rawBody: {},
      });

      const req = recordedRequest(fetchMock.mock.calls[0] as [string, RequestInit]);
      expect(findParam(req, "requestId")).toBeNull();
      expect(findParam(req, "sessionId")).toBeNull();
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

    it("fires a response-row insert without awaiting", async () => {
      const { logToolCallResponse } = await import("../../lib/services/databricks/analytics.js");

      logToolCallResponse({
        tool: "Solana_Documentation_Search",
        req: "find docs",
        res: '{"content":[]}',
        rawBody: { tool: "Solana_Documentation_Search" },
      });

      await new Promise(resolve => process.nextTick(resolve));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const req = recordedRequest(fetchMock.mock.calls[0] as [string, RequestInit]);
      expect(req.body.statement).toContain("mcp_tool_calls");
      expect(findParam(req, "rowType")).toBe("response");
      expect(findParam(req, "toolName")).toBe("Solana_Documentation_Search");
      expect(findParam(req, "responseText")).toBe('{"content":[]}');
      expect(findParam(req, "arguments")).toBe(JSON.stringify("find docs"));
    });

    it("logs an error when the insert fails", async () => {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(new Response("boom", { status: 400 }));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { logToolCallResponse } = await import("../../lib/services/databricks/analytics.js");

      logToolCallResponse({
        tool: "Solana_Documentation_Search",
        req: "find docs",
        res: '{"content":[]}',
        rawBody: {},
      });

      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));

      expect(errorSpy).toHaveBeenCalledWith("[logToolCallResponse] Error inserting tool response:", expect.any(Error));
      errorSpy.mockRestore();
    });
  });
});
