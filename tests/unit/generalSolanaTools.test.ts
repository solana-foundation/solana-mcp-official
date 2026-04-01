import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";

const { generateTextMock, logAnalyticsMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  logAnalyticsMock: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: generateTextMock,
}));

vi.mock("../../lib/analytics", () => ({
  logAnalytics: logAnalyticsMock,
}));

import { createSolanaTools } from "../../lib/tools/generalSolanaTools";

describe("createSolanaTools", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    logAnalyticsMock.mockReset();
    logAnalyticsMock.mockResolvedValue(undefined);
  });

  it("returns explicit tool error when no model is configured", async () => {
    const tools = createSolanaTools(null);
    expect(tools).toHaveLength(2);

    const askTool = tools.find(tool => tool.title === "Solana_Expert__Ask_For_Help");
    const searchTool = tools.find(tool => tool.title === "Solana_Documentation_Search");
    expect(askTool).toBeDefined();
    expect(searchTool).toBeDefined();
    if (!askTool || !searchTool) return;

    const askResult = await askTool.func({ question: "how do PDAs work?" });
    const searchResult = await searchTool.func({ query: "solana rpc docs" });

    expect(askResult).toEqual({
      content: [{ type: "text", text: "Error: No AI provider is configured for this tool." }],
      isError: true,
    });
    expect(searchResult).toEqual({
      content: [{ type: "text", text: "Error: No AI provider is configured for this tool." }],
      isError: true,
    });
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(logAnalyticsMock).not.toHaveBeenCalled();
  });

  it("generates model responses and logs analytics for both tools", async () => {
    const model = {} as unknown as LanguageModel;
    generateTextMock.mockResolvedValueOnce({ text: "expert-answer" }).mockResolvedValueOnce({ text: "search-answer" });

    const tools = createSolanaTools(model);
    const askTool = tools.find(tool => tool.title === "Solana_Expert__Ask_For_Help");
    const searchTool = tools.find(tool => tool.title === "Solana_Documentation_Search");
    expect(askTool).toBeDefined();
    expect(searchTool).toBeDefined();
    if (!askTool || !searchTool) return;

    const askQuestion = "how do PDAs work?";
    const searchQuery = "solana rpc docs";

    await expect(askTool.func({ question: askQuestion })).resolves.toEqual({
      content: [{ type: "text", text: "expert-answer" }],
    });
    await expect(searchTool.func({ query: searchQuery })).resolves.toEqual({
      content: [{ type: "text", text: "search-answer" }],
    });

    expect(generateTextMock).toHaveBeenNthCalledWith(1, {
      model,
      messages: [{ role: "user", content: askQuestion }],
    });
    expect(generateTextMock).toHaveBeenNthCalledWith(2, {
      model,
      messages: [{ role: "user", content: searchQuery }],
    });

    expect(logAnalyticsMock).toHaveBeenNthCalledWith(1, {
      event_type: "message_response",
      details: {
        tool: "Solana_Expert__Ask_For_Help",
        req: askQuestion,
        res: "expert-answer",
      },
    });
    expect(logAnalyticsMock).toHaveBeenNthCalledWith(2, {
      event_type: "message_response",
      details: {
        tool: "Solana_Documentation_Search",
        req: searchQuery,
        res: "search-answer",
      },
    });
  });
});
