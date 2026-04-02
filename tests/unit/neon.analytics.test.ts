import { beforeEach, describe, expect, it, vi } from "vitest";

const { neonMock, sqlMock } = vi.hoisted(() => {
  const sqlMock = vi.fn().mockResolvedValue([]);
  const neonMock = vi.fn().mockReturnValue(sqlMock);
  return { neonMock, sqlMock };
});

vi.mock("@neondatabase/serverless", () => ({
  neon: neonMock,
}));

describe("neon analytics service", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sqlMock.mockResolvedValue([]);
    neonMock.mockReturnValue(sqlMock);
    delete process.env.POSTGRES_URL;
  });

  describe("logInitialization", () => {
    it("skips insert and warns when POSTGRES_URL is missing", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { logInitialization } = await import("../../lib/services/neon/analytics.js");

      await logInitialization({
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientName: "codex",
        clientVersion: "1.0.0",
        rawBody: {},
      });

      expect(neonMock).not.toHaveBeenCalled();
      expect(sqlMock).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith("[analytics] POSTGRES_URL not set — analytics disabled");
      warnSpy.mockRestore();
    });

    it("inserts into initializations with correct values", async () => {
      process.env.POSTGRES_URL = "postgres://localhost/test";
      const { logInitialization } = await import("../../lib/services/neon/analytics.js");

      await logInitialization({
        protocolVersion: "2025-03-26",
        capabilities: { roots: { listChanged: true } },
        clientName: "codex",
        clientVersion: "1.2.3",
        rawBody: { method: "initialize" },
      });

      expect(neonMock).toHaveBeenCalledWith("postgres://localhost/test");
      expect(sqlMock).toHaveBeenCalledTimes(1);
      const [strings, ...params] = sqlMock.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
      expect(strings.join("")).toContain("initializations");
      expect(params).toContain("2025-03-26");
      expect(params).toContain("codex");
      expect(params).toContain("1.2.3");
    });
  });

  describe("logToolCallRequest", () => {
    it("skips insert when POSTGRES_URL is missing", async () => {
      const { logToolCallRequest } = await import("../../lib/services/neon/analytics.js");

      await logToolCallRequest({
        toolName: "Solana_Documentation_Search",
        requestId: "req-1",
        sessionId: "sess-1",
        toolArgs: { query: "accounts" },
        rawBody: {},
      });

      expect(sqlMock).not.toHaveBeenCalled();
    });

    it("inserts into tool_calls with request metadata", async () => {
      process.env.POSTGRES_URL = "postgres://localhost/test";
      const { logToolCallRequest } = await import("../../lib/services/neon/analytics.js");

      await logToolCallRequest({
        toolName: "Solana_Documentation_Search",
        requestId: "req-123",
        sessionId: "session-456",
        toolArgs: { query: "accounts" },
        rawBody: { method: "tools/call" },
      });

      expect(sqlMock).toHaveBeenCalledTimes(1);
      const [strings, ...params] = sqlMock.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
      expect(strings.join("")).toContain("tool_calls");
      expect(params).toContain("Solana_Documentation_Search");
      expect(params).toContain("req-123");
      expect(params).toContain("session-456");
    });
  });

  describe("logToolCallResponse", () => {
    it("skips insert when POSTGRES_URL is missing", async () => {
      const { logToolCallResponse } = await import("../../lib/services/neon/analytics.js");

      logToolCallResponse({
        tool: "Solana_Documentation_Search",
        req: "find docs",
        res: '{"content":[]}',
        rawBody: {},
      });

      expect(sqlMock).not.toHaveBeenCalled();
    });

    it("fire-and-forgets an insert into tool_calls", async () => {
      process.env.POSTGRES_URL = "postgres://localhost/test";
      const { logToolCallResponse } = await import("../../lib/services/neon/analytics.js");

      logToolCallResponse({
        tool: "Solana_Documentation_Search",
        req: "find docs",
        res: '{"content":[]}',
        rawBody: { tool: "Solana_Documentation_Search" },
      });

      await new Promise(resolve => process.nextTick(resolve));

      expect(sqlMock).toHaveBeenCalledTimes(1);
      const [strings, ...params] = sqlMock.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
      expect(strings.join("")).toContain("tool_calls");
      expect(params).toContain("Solana_Documentation_Search");
      expect(params).toContain('{"content":[]}');
    });

    it("logs an error when the insert fails", async () => {
      process.env.POSTGRES_URL = "postgres://localhost/test";
      sqlMock.mockRejectedValueOnce(new Error("db error"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { logToolCallResponse } = await import("../../lib/services/neon/analytics.js");

      logToolCallResponse({
        tool: "Solana_Documentation_Search",
        req: "find docs",
        res: '{"content":[]}',
        rawBody: {},
      });

      await new Promise(resolve => process.nextTick(resolve));

      expect(errorSpy).toHaveBeenCalledWith("[logToolCallResponse] Error inserting tool response:", expect.any(Error));
      errorSpy.mockRestore();
    });
  });
});
