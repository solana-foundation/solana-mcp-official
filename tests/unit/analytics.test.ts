import { beforeEach, describe, expect, it, vi } from "vitest";

const { neonMock, sqlMock, logInkeepToolResponseMock } = vi.hoisted(() => {
  const sqlMock = vi.fn().mockResolvedValue([]);
  const neonMock = vi.fn().mockReturnValue(sqlMock);
  return { neonMock, sqlMock, logInkeepToolResponseMock: vi.fn() };
});

vi.mock("@neondatabase/serverless", () => ({
  neon: neonMock,
}));

vi.mock("../../lib/services/inkeep/analytics", () => ({
  logInkeepToolResponse: logInkeepToolResponseMock,
}));

describe("logAnalytics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sqlMock.mockResolvedValue([]);
    neonMock.mockReturnValue(sqlMock);
    logInkeepToolResponseMock.mockResolvedValue(undefined);
    delete process.env.POSTGRES_URL;
  });

  it("does nothing when POSTGRES_URL is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { logAnalytics } = await import("../../lib/analytics.js");
    await logAnalytics({
      event_type: "message_received",
      details: { body: JSON.stringify({ method: "initialize", params: {} }) },
    });

    expect(neonMock).not.toHaveBeenCalled();
    expect(sqlMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[analytics] POSTGRES_URL not set — analytics disabled");
    warnSpy.mockRestore();
  });

  it("records initialize requests into the initializations table", async () => {
    process.env.POSTGRES_URL = "postgres://localhost/test";

    const { logAnalytics } = await import("../../lib/analytics.js");
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

    expect(neonMock).toHaveBeenCalledWith("postgres://localhost/test");
    expect(sqlMock).toHaveBeenCalledTimes(1);

    const [strings, ...params] = sqlMock.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("")).toContain("initializations");
    expect(params).toContain("2025-03-26");
    expect(params).toContain("codex");
    expect(params).toContain("1.2.3");
  });

  it("records tools/call requests in tool_calls with request metadata", async () => {
    process.env.POSTGRES_URL = "postgres://localhost/test";

    const { logAnalytics } = await import("../../lib/analytics.js");
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

    expect(sqlMock).toHaveBeenCalledTimes(1);

    const [strings, ...params] = sqlMock.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("")).toContain("tool_calls");
    expect(params).toContain("Solana_Documentation_Search");
    expect(params).toContain("req-123");
    expect(params).toContain("session-456");
  });

  it("records message_response payloads and forwards them to Inkeep analytics", async () => {
    process.env.POSTGRES_URL = "postgres://localhost/test";

    const { logAnalytics } = await import("../../lib/analytics.js");
    await logAnalytics({
      event_type: "message_response",
      details: {
        tool: "Solana_Documentation_Search",
        req: "find docs",
        res: '{"content":[]}',
      },
    });

    expect(sqlMock).toHaveBeenCalled();

    const [strings, ...params] = sqlMock.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("")).toContain("tool_calls");
    expect(params).toContain("Solana_Documentation_Search");
    expect(params).toContain('{"content":[]}');

    expect(logInkeepToolResponseMock).toHaveBeenCalledWith({
      tool: "Solana_Documentation_Search",
      req: "find docs",
      res: '{"content":[]}',
    });
  });

  it("rejects malformed message_received JSON payloads without writing rows", async () => {
    process.env.POSTGRES_URL = "postgres://localhost/test";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { logAnalytics } = await import("../../lib/analytics.js");
    await logAnalytics({
      event_type: "message_received",
      details: {
        body: "{invalid-json",
      },
    });

    expect(sqlMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith("[logAnalytics] Could not parse JSON body:", "{invalid-json");
    errorSpy.mockRestore();
  });
});
