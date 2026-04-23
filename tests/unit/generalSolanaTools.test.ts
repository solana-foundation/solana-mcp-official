import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import type { DocChunk } from "../../lib/services/databricks/vectorSearch.js";

const { generateTextMock, logAnalyticsMock, searchDocsMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  logAnalyticsMock: vi.fn(),
  searchDocsMock: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: generateTextMock,
}));

vi.mock("../../lib/analytics", () => ({
  logAnalytics: logAnalyticsMock,
}));

vi.mock("../../lib/services/databricks/vectorSearch.js", () => ({
  searchDocs: searchDocsMock,
}));

import { createSolanaTools } from "../../lib/tools/generalSolanaTools";

describe("createSolanaTools", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    logAnalyticsMock.mockReset();
    searchDocsMock.mockReset();
    logAnalyticsMock.mockResolvedValue(undefined);
    delete process.env.USE_DATABRICKS;
  });

  afterEach(() => {
    delete process.env.USE_DATABRICKS;
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

  describe("USE_DATABRICKS=1", () => {
    beforeEach(() => {
      process.env.USE_DATABRICKS = "1";
    });

    const sampleChunk: DocChunk = {
      id: "chunk-1",
      url: "https://www.solana-program.com/docs/pda",
      title: "PDA Basics",
      sourceId: "solana-program-site",
      content: "A PDA is derived from seeds and program id.",
      score: 0.812,
    };

    it("uses Databricks retrieval for ask tool, ignores model, skips generateText", async () => {
      searchDocsMock.mockResolvedValueOnce([sampleChunk]);
      const model = {} as unknown as LanguageModel;

      const tools = createSolanaTools(model);
      const askTool = tools.find(t => t.title === "Solana_Expert__Ask_For_Help");
      if (!askTool) throw new Error("missing tool");

      const result = await askTool.func({ question: "what is a PDA?" });

      expect(searchDocsMock).toHaveBeenCalledWith("what is a PDA?");
      expect(generateTextMock).not.toHaveBeenCalled();
      const text = (result as { content: [{ text: string }] }).content[0].text;
      expect(text).toContain("PDA Basics");
      expect(text).toContain("https://www.solana-program.com/docs/pda");
      expect(text).toContain("source: solana-program-site");
      expect(logAnalyticsMock).toHaveBeenCalledWith({
        event_type: "message_response",
        details: {
          tool: "Solana_Expert__Ask_For_Help",
          req: "what is a PDA?",
          res: expect.stringContaining("PDA Basics"),
        },
      });
    });

    it("uses Databricks retrieval for search tool", async () => {
      searchDocsMock.mockResolvedValueOnce([sampleChunk]);

      const tools = createSolanaTools(null);
      const searchTool = tools.find(t => t.title === "Solana_Documentation_Search");
      if (!searchTool) throw new Error("missing tool");

      const result = await searchTool.func({ query: "pda seeds" });

      expect(searchDocsMock).toHaveBeenCalledWith("pda seeds");
      const text = (result as { content: [{ text: string }] }).content[0].text;
      expect(text).toContain("PDA Basics");
    });

    it("returns no-result message when Databricks returns empty", async () => {
      searchDocsMock.mockResolvedValueOnce([]);

      const tools = createSolanaTools(null);
      const searchTool = tools.find(t => t.title === "Solana_Documentation_Search");
      if (!searchTool) throw new Error("missing tool");

      const result = await searchTool.func({ query: "nothing matches" });

      const text = (result as { content: [{ text: string }] }).content[0].text;
      expect(text).toContain("No relevant documentation found");
    });
  });
});
