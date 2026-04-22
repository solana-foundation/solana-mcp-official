import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  logInitializationMock,
  logToolCallRequestMock,
  logToolCallResponseMock,
  logInkeepToolResponseMock,
  dbxLogInitializationMock,
  dbxLogToolCallRequestMock,
  dbxLogToolCallResponseMock,
} = vi.hoisted(() => ({
  logInitializationMock: vi.fn(),
  logToolCallRequestMock: vi.fn(),
  logToolCallResponseMock: vi.fn(),
  logInkeepToolResponseMock: vi.fn(),
  dbxLogInitializationMock: vi.fn(),
  dbxLogToolCallRequestMock: vi.fn(),
  dbxLogToolCallResponseMock: vi.fn(),
}));

vi.mock("../../lib/services/neon/analytics", () => ({
  logInitialization: logInitializationMock,
  logToolCallRequest: logToolCallRequestMock,
  logToolCallResponse: logToolCallResponseMock,
}));

vi.mock("../../lib/services/databricks/analytics", () => ({
  logInitialization: dbxLogInitializationMock,
  logToolCallRequest: dbxLogToolCallRequestMock,
  logToolCallResponse: dbxLogToolCallResponseMock,
}));

vi.mock("../../lib/services/inkeep/analytics", () => ({
  logInkeepToolResponse: logInkeepToolResponseMock,
}));

import { logAnalytics } from "../../lib/analytics.js";

describe("logAnalytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logInitializationMock.mockResolvedValue(undefined);
    logToolCallRequestMock.mockResolvedValue(undefined);
    logToolCallResponseMock.mockReturnValue(undefined);
    logInkeepToolResponseMock.mockResolvedValue(undefined);
    dbxLogInitializationMock.mockResolvedValue(undefined);
    dbxLogToolCallRequestMock.mockResolvedValue(undefined);
    dbxLogToolCallResponseMock.mockReturnValue(undefined);
    delete process.env.USE_DATABRICKS;
  });

  afterEach(() => {
    delete process.env.USE_DATABRICKS;
  });

  it("routes initialize to logInitialization with parsed params", async () => {
    await logAnalytics({
      event_type: "message_received",
      details: {
        body: JSON.stringify({
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: { roots: { listChanged: true } },
            clientInfo: { name: "codex", version: "1.2.3" },
          },
        }),
      },
    });

    expect(logInitializationMock).toHaveBeenCalledWith({
      protocolVersion: "2025-03-26",
      capabilities: { roots: { listChanged: true } },
      clientName: "codex",
      clientVersion: "1.2.3",
      rawBody: expect.objectContaining({ method: "initialize" }),
    });
    expect(dbxLogInitializationMock).not.toHaveBeenCalled();
  });

  it("routes tools/call to logToolCallRequest with request metadata", async () => {
    await logAnalytics({
      event_type: "message_received",
      request_id: "req-123",
      session_id: "session-456",
      details: {
        body: JSON.stringify({
          method: "tools/call",
          params: {
            name: "Solana_Documentation_Search",
            arguments: { query: "accounts" },
          },
        }),
      },
    });

    expect(logToolCallRequestMock).toHaveBeenCalledWith({
      toolName: "Solana_Documentation_Search",
      requestId: "req-123",
      sessionId: "session-456",
      toolArgs: { query: "accounts" },
      rawBody: expect.objectContaining({ method: "tools/call" }),
    });
    expect(dbxLogToolCallRequestMock).not.toHaveBeenCalled();
  });

  it("routes message_response to logToolCallResponse and logInkeepToolResponse", async () => {
    await logAnalytics({
      event_type: "message_response",
      details: {
        tool: "Solana_Documentation_Search",
        req: "find docs",
        res: '{"content":[]}',
      },
    });

    expect(logToolCallResponseMock).toHaveBeenCalledWith({
      tool: "Solana_Documentation_Search",
      req: "find docs",
      res: '{"content":[]}',
      rawBody: expect.objectContaining({ tool: "Solana_Documentation_Search" }),
    });
    expect(logInkeepToolResponseMock).toHaveBeenCalledWith({
      tool: "Solana_Documentation_Search",
      req: "find docs",
      res: '{"content":[]}',
    });
    expect(dbxLogToolCallResponseMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without calling any service", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await logAnalytics({
      event_type: "message_received",
      details: { body: "{invalid-json" },
    });

    expect(logInitializationMock).not.toHaveBeenCalled();
    expect(logToolCallRequestMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith("[logAnalytics] Could not parse JSON body:", "{invalid-json");
    errorSpy.mockRestore();
  });

  it("skips unknown methods without calling any service", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await logAnalytics({
      event_type: "message_received",
      details: { body: JSON.stringify({ method: "unknown/method" }) },
    });

    expect(logInitializationMock).not.toHaveBeenCalled();
    expect(logToolCallRequestMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[logAnalytics] Skipping method:", "unknown/method");
    warnSpy.mockRestore();
  });

  describe("USE_DATABRICKS=1", () => {
    beforeEach(() => {
      process.env.USE_DATABRICKS = "1";
    });

    it("routes initialize to databricks sink instead of neon", async () => {
      await logAnalytics({
        event_type: "message_received",
        details: {
          body: JSON.stringify({
            method: "initialize",
            params: {
              protocolVersion: "2025-03-26",
              capabilities: {},
              clientInfo: { name: "claude", version: "4.7" },
            },
          }),
        },
      });

      expect(dbxLogInitializationMock).toHaveBeenCalledTimes(1);
      expect(logInitializationMock).not.toHaveBeenCalled();
    });

    it("routes tools/call to databricks sink instead of neon", async () => {
      await logAnalytics({
        event_type: "message_received",
        request_id: "r1",
        session_id: "s1",
        details: {
          body: JSON.stringify({
            method: "tools/call",
            params: { name: "Solana_Documentation_Search", arguments: { query: "pda" } },
          }),
        },
      });

      expect(dbxLogToolCallRequestMock).toHaveBeenCalledTimes(1);
      expect(logToolCallRequestMock).not.toHaveBeenCalled();
    });

    it("sends message_response to databricks sink and skips inkeep analytics", async () => {
      await logAnalytics({
        event_type: "message_response",
        details: { tool: "Solana_Documentation_Search", req: "q", res: "chunks..." },
      });

      expect(dbxLogToolCallResponseMock).toHaveBeenCalledTimes(1);
      expect(logToolCallResponseMock).not.toHaveBeenCalled();
      expect(logInkeepToolResponseMock).not.toHaveBeenCalled();
    });
  });
});
