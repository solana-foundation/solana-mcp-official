import { beforeEach, describe, expect, it, vi } from "vitest";

const { logConversationMock, InkeepAnalyticsMock } = vi.hoisted(() => {
  const logConversationMock = vi.fn();
  return {
    logConversationMock,
    InkeepAnalyticsMock: vi.fn(() => ({
      conversations: {
        log: logConversationMock,
      },
    })),
  };
});

vi.mock("@inkeep/inkeep-analytics", () => ({
  InkeepAnalytics: InkeepAnalyticsMock,
}));

import { logInkeepToolResponse } from "../../lib/services/inkeep/analytics";

describe("logInkeepToolResponse", () => {
  beforeEach(() => {
    logConversationMock.mockReset();
    InkeepAnalyticsMock.mockClear();
    delete process.env.INKEEP_API_KEY;
  });

  it("skips analytics for unsupported tool names", async () => {
    process.env.INKEEP_API_KEY = "inkeep-key";

    await logInkeepToolResponse({
      tool: "Some_Other_Tool",
      req: "question",
      res: JSON.stringify({ content: [{ url: "https://example.com", title: "Example" }] }),
    });

    expect(InkeepAnalyticsMock).not.toHaveBeenCalled();
    expect(logConversationMock).not.toHaveBeenCalled();
  });

  it("skips analytics when INKEEP_API_KEY is absent", async () => {
    await logInkeepToolResponse({
      tool: "Solana_Documentation_Search",
      req: "query",
      res: JSON.stringify({ content: [{ url: "https://example.com", title: "Example" }] }),
    });

    expect(InkeepAnalyticsMock).not.toHaveBeenCalled();
    expect(logConversationMock).not.toHaveBeenCalled();
  });

  it("logs a warning and skips when response JSON is invalid", async () => {
    process.env.INKEEP_API_KEY = "inkeep-key";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await logInkeepToolResponse({
      tool: "Solana_Documentation_Search",
      req: "query",
      res: "not-json",
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "[logInkeepToolResponse] Failed to parse response JSON, skipping Inkeep analytics",
      expect.any(SyntaxError),
    );
    expect(InkeepAnalyticsMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("extracts links from response content and logs a conversation", async () => {
    process.env.INKEEP_API_KEY = "inkeep-key";
    logConversationMock.mockResolvedValue(undefined);

    await logInkeepToolResponse({
      tool: "Solana_Documentation_Search",
      req: "find account docs",
      res: JSON.stringify({
        content: [
          { url: "https://solana.com/docs", title: "Solana Docs" },
          { url: "https://example.com/no-title" },
          { type: "text", text: "not-a-link" },
          { url: "", title: "empty" },
        ],
      }),
    });

    expect(InkeepAnalyticsMock).toHaveBeenCalledWith({ apiIntegrationKey: "inkeep-key" });
    expect(logConversationMock).toHaveBeenCalledTimes(1);
    expect(logConversationMock).toHaveBeenCalledWith(
      { apiIntegrationKey: "inkeep-key" },
      {
        type: "openai",
        userProperties: undefined,
        properties: { tool: "Solana_Documentation_Search" },
        messages: [
          { role: "user", content: "find account docs" },
          {
            role: "assistant",
            content:
              "- [Solana Docs](https://solana.com/docs)\n- [https://example.com/no-title](https://example.com/no-title)",
          },
        ],
      },
    );
  });
});
