import { describe, expect, it } from "vitest";
import type { DocChunk } from "../../lib/services/databricks/vectorSearch.js";
import { formatChunksAsMarkdown } from "../../lib/tools/formatChunks.js";

function chunk(overrides: Partial<DocChunk> = {}): DocChunk {
  return {
    id: "id-1",
    url: "https://example.com/doc",
    title: "Example Doc",
    sourceId: "example-docs",
    content: "Example content body",
    score: 0.42,
    ...overrides,
  };
}

describe("formatChunksAsMarkdown", () => {
  it("returns no-result message when chunks empty", () => {
    const out = formatChunksAsMarkdown("how do I PDA", []);
    expect(out).toContain("No relevant documentation found");
    expect(out).toContain("how do I PDA");
  });

  it("renders a linked heading when title and url present", () => {
    const out = formatChunksAsMarkdown("pda", [chunk()]);
    expect(out).toContain("### 1. [Example Doc](https://example.com/doc)");
    expect(out).toContain("score: 0.420");
    expect(out).toContain("source: example-docs");
    expect(out).toContain("Example content body");
  });

  it("falls back to title-only when url is missing", () => {
    const out = formatChunksAsMarkdown("q", [chunk({ url: null })]);
    expect(out).toContain("### 1. Example Doc");
    expect(out).not.toContain("[Example Doc](");
  });

  it("falls back to url-only when title is missing", () => {
    const out = formatChunksAsMarkdown("q", [chunk({ title: null })]);
    expect(out).toContain("### 1. https://example.com/doc");
  });

  it("omits source label when sourceId missing", () => {
    const out = formatChunksAsMarkdown("q", [chunk({ sourceId: null })]);
    expect(out).toContain("score: 0.420");
    expect(out).not.toContain("source: ");
  });

  it("numbers multiple chunks and separates them", () => {
    const out = formatChunksAsMarkdown("pda", [
      chunk({ id: "a", title: "Doc A" }),
      chunk({ id: "b", title: "Doc B" }),
      chunk({ id: "c", title: "Doc C" }),
    ]);
    expect(out).toContain('Top 3 matches for "pda"');
    expect(out).toContain("### 1. [Doc A]");
    expect(out).toContain("### 2. [Doc B]");
    expect(out).toContain("### 3. [Doc C]");
    expect(out.split("---").length).toBe(3); // 2 separators → 3 segments
  });
});
