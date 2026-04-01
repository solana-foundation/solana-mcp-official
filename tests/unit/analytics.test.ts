import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, logInkeepToolResponseMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  logInkeepToolResponseMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

vi.mock("../../lib/services/inkeep/analytics", () => ({
  logInkeepToolResponse: logInkeepToolResponseMock,
}));

type InsertResult = { error: unknown | null };
type DbInsert = (rows: Array<Record<string, unknown>>) => Promise<InsertResult>;

function setupDbMocks() {
  const initializationsInsert = vi.fn<DbInsert>().mockResolvedValue({ error: null });
  const toolCallsInsert = vi.fn<DbInsert>().mockResolvedValue({ error: null });
  const fromMock = vi.fn((table: string) => {
    if (table === "initializations") {
      return { insert: initializationsInsert };
    }
    if (table === "tool_calls") {
      return { insert: toolCallsInsert };
    }
    throw new Error(`unexpected table ${table}`);
  });

  createClientMock.mockReturnValue({
    from: fromMock,
  });

  return { fromMock, initializationsInsert, toolCallsInsert };
}

describe("logAnalytics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    createClientMock.mockReset();
    logInkeepToolResponseMock.mockReset();
    logInkeepToolResponseMock.mockResolvedValue(undefined);
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("does nothing when Supabase credentials are missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { logAnalytics } = await import("../../lib/analytics.js");
    await logAnalytics({
      event_type: "message_received",
      details: { body: JSON.stringify({ method: "initialize", params: {} }) },
    });

    expect(createClientMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[analytics] Supabase credentials missing — analytics disabled");
    warnSpy.mockRestore();
  });

  it("records initialize requests into the initializations table", async () => {
    process.env.SUPABASE_URL = "https://supabase.example.com";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    const { fromMock, initializationsInsert } = setupDbMocks();

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

    expect(createClientMock).toHaveBeenCalledWith("https://supabase.example.com", "service-role-key");
    expect(fromMock).toHaveBeenCalledWith("initializations");
    expect(initializationsInsert).toHaveBeenCalledTimes(1);

    const rows = initializationsInsert.mock.calls[0]?.[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      method: "initialize",
      protocol_version: "2025-03-26",
      capabilities: { roots: { listChanged: true } },
      client_name: "codex",
      client_version: "1.2.3",
      raw_body: {
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: { roots: { listChanged: true } },
          clientInfo: { name: "codex", version: "1.2.3" },
        },
      },
    });
    expect(typeof rows[0].timestamp).toBe("string");
  });

  it("records tools/call requests in tool_calls with request metadata", async () => {
    process.env.SUPABASE_URL = "https://supabase.example.com";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    const { fromMock, toolCallsInsert } = setupDbMocks();

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

    expect(fromMock).toHaveBeenCalledWith("tool_calls");
    expect(toolCallsInsert).toHaveBeenCalledTimes(1);
    expect(toolCallsInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        row_type: "request",
        tool_name: "Solana_Documentation_Search",
        request_id: "req-123",
        session_id: "session-456",
        arguments: { query: "accounts" },
      }),
    ]);
  });

  it("records message_response payloads and forwards them to Inkeep analytics", async () => {
    process.env.SUPABASE_URL = "https://supabase.example.com";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    const { fromMock, toolCallsInsert } = setupDbMocks();

    const { logAnalytics } = await import("../../lib/analytics.js");
    await logAnalytics({
      event_type: "message_response",
      details: {
        tool: "Solana_Documentation_Search",
        req: "find docs",
        res: '{"content":[]}',
      },
    });

    expect(fromMock).toHaveBeenCalledWith("tool_calls");
    expect(toolCallsInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        row_type: "response",
        tool_name: "Solana_Documentation_Search",
        arguments: "find docs",
        response_text: '{"content":[]}',
      }),
    ]);
    expect(logInkeepToolResponseMock).toHaveBeenCalledWith({
      tool: "Solana_Documentation_Search",
      req: "find docs",
      res: '{"content":[]}',
    });
  });

  it("rejects malformed message_received JSON payloads without writing rows", async () => {
    process.env.SUPABASE_URL = "https://supabase.example.com";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    const { fromMock } = setupDbMocks();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { logAnalytics } = await import("../../lib/analytics.js");
    await logAnalytics({
      event_type: "message_received",
      details: {
        body: "{invalid-json",
      },
    });

    expect(fromMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith("[logAnalytics] Could not parse JSON body:", "{invalid-json");
    errorSpy.mockRestore();
  });
});
