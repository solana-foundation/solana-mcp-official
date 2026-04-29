import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocChunk } from "../../lib/services/databricks/vectorSearch.js";

const { logAnalyticsMock, searchDocsMock } = vi.hoisted(() => ({
  logAnalyticsMock: vi.fn(),
  searchDocsMock: vi.fn(),
}));

vi.mock("../../lib/analytics", () => ({
  logAnalytics: logAnalyticsMock,
}));

vi.mock("../../lib/services/databricks/vectorSearch.js", () => ({
  searchDocs: searchDocsMock,
}));

import { createSolanaTools } from "../../lib/tools/generalSolanaTools";

describe("createSolanaTools", () => {
  const sampleChunk: DocChunk = {
    id: "chunk-1",
    url: "https://www.solana-program.com/docs/pda",
    title: "PDA Basics",
    sourceId: "solana-program-site",
    content: "A PDA is derived from seeds and program id.",
    score: 0.812,
  };

  beforeEach(() => {
    logAnalyticsMock.mockReset();
    searchDocsMock.mockReset();
    logAnalyticsMock.mockResolvedValue(undefined);
  });

  it("registers all tools", () => {
    const tools = createSolanaTools();
    expect(tools).toHaveLength(4);
    expect(tools.find(t => t.title === "Solana_Expert__Ask_For_Help")).toBeDefined();
    expect(tools.find(t => t.title === "Solana_Documentation_Search")).toBeDefined();
    expect(tools.find(t => t.title === "list_sections")).toBeDefined();
    expect(tools.find(t => t.title === "get_documentation")).toBeDefined();
  });

  it("uses Databricks retrieval for ask tool and logs analytics", async () => {
    searchDocsMock.mockResolvedValueOnce([sampleChunk]);
    const askTool = createSolanaTools().find(t => t.title === "Solana_Expert__Ask_For_Help");
    if (!askTool) throw new Error("missing tool");

    const result = await askTool.func({ question: "what is a PDA?" });

    expect(searchDocsMock).toHaveBeenCalledWith("what is a PDA?");
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
    const searchTool = createSolanaTools().find(t => t.title === "Solana_Documentation_Search");
    if (!searchTool) throw new Error("missing tool");

    const result = await searchTool.func({ query: "pda seeds" });

    expect(searchDocsMock).toHaveBeenCalledWith("pda seeds");
    const text = (result as { content: [{ text: string }] }).content[0].text;
    expect(text).toContain("PDA Basics");
  });

  it("returns no-result message when Databricks returns empty", async () => {
    searchDocsMock.mockResolvedValueOnce([]);
    const searchTool = createSolanaTools().find(t => t.title === "Solana_Documentation_Search");
    if (!searchTool) throw new Error("missing tool");

    const result = await searchTool.func({ query: "nothing matches" });
    const text = (result as { content: [{ text: string }] }).content[0].text;
    expect(text).toContain("No relevant documentation found");
  });
});
