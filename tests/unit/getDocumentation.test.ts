import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getChunksForSourceMock } = vi.hoisted(() => ({
  getChunksForSourceMock: vi.fn(),
}));

vi.mock("../../lib/services/databricks/docsLookup", () => ({
  getChunksForSource: getChunksForSourceMock,
}));

import { fetchDocumentation, normalizeSections } from "../../lib/tools/getDocumentation";

describe("normalizeSections", () => {
  it("accepts a single string", () => {
    expect(normalizeSections("anchor-docs")).toEqual(["anchor-docs"]);
  });

  it("accepts an array", () => {
    expect(normalizeSections(["a", "b"])).toEqual(["a", "b"]);
  });

  it("parses a JSON-encoded array string", () => {
    expect(normalizeSections('["a","b"]')).toEqual(["a", "b"]);
  });

  it("trims whitespace and drops empty entries", () => {
    expect(normalizeSections([" a ", "", " b"])).toEqual(["a", "b"]);
    expect(normalizeSections(" anchor-docs ")).toEqual(["anchor-docs"]);
    expect(normalizeSections("")).toEqual([]);
  });
});

describe("fetchDocumentation", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeEach(() => {
    fetchSpy.mockReset();
    getChunksForSourceMock.mockReset();
  });

  afterEach(() => {
    fetchSpy.mockReset();
    getChunksForSourceMock.mockReset();
  });

  it("returns a clear message when no sections are requested", async () => {
    const out = await fetchDocumentation([]);
    expect(out).toContain("No sections requested");
  });

  it("flags unknown ids without calling fetch or chunk lookup", async () => {
    const out = await fetchDocumentation("definitely-not-real");
    expect(out).toContain('Section or source id not found: "definitely-not-real"');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getChunksForSourceMock).not.toHaveBeenCalled();
  });

  it('expands a section taxonomy id (e.g. "oracles") into every source tagged with that section', async () => {
    fetchSpy.mockResolvedValue(new Response("oracle docs body", { status: 200 }));
    getChunksForSourceMock.mockResolvedValue([]);

    const { sourcesForSection } = await import("../../lib/sources.js");
    const expected = sourcesForSection("oracles");
    expect(expected.length).toBeGreaterThan(1);

    const out = await fetchDocumentation("oracles");
    for (const s of expected) expect(out).toContain(s.name);
    expect(fetchSpy).toHaveBeenCalledTimes(expected.length);
  });

  it("returns llms.txt content verbatim when fetch succeeds (tier 1)", async () => {
    fetchSpy.mockResolvedValue(
      new Response("# Anchor llms.txt\n\nverbatim docs body", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const out = await fetchDocumentation("anchor-docs");
    expect(fetchSpy).toHaveBeenCalledWith("https://www.anchor-lang.com/docs/llms.txt", expect.any(Object));
    expect(out).toContain("verbatim docs body");
    expect(getChunksForSourceMock).not.toHaveBeenCalled();
  });

  it("falls back to chunk concat on llms.txt 404 (tier 2)", async () => {
    fetchSpy.mockResolvedValue(new Response("not found", { status: 404 }));
    getChunksForSourceMock.mockResolvedValue([
      {
        url: "https://github.com/anza-xyz/pinocchio/blob/HEAD/README.md",
        title: "README",
        headingPath: ["Pinocchio"],
        content: "Zero-copy Solana programs.",
      },
    ]);

    const out = await fetchDocumentation("gh-pinocchio");
    expect(getChunksForSourceMock).toHaveBeenCalledWith("gh-pinocchio");
    expect(out).toContain("Zero-copy Solana programs.");
    expect(out).toContain("README");
    expect(out).not.toContain("No bundled docs available");
  });

  it("falls back to a pointer when both llms.txt and chunks are empty (tier 3)", async () => {
    fetchSpy.mockResolvedValue(new Response("not found", { status: 404 }));
    getChunksForSourceMock.mockResolvedValue([]);

    const out = await fetchDocumentation("gh-pinocchio");
    expect(out).toContain("No bundled docs available");
    expect(out).toContain("https://github.com/anza-xyz/pinocchio");
    expect(out).toContain("Solana_Documentation_Search");
  });

  it("falls back to a pointer when the chunk lookup throws", async () => {
    fetchSpy.mockResolvedValue(new Response("not found", { status: 404 }));
    getChunksForSourceMock.mockRejectedValue(new Error("warehouse unavailable"));

    const out = await fetchDocumentation("gh-pinocchio");
    expect(out).toContain("No bundled docs available");
  });

  it("joins multiple sections with --- separators and dedupes ids", async () => {
    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (u.includes("anchor-lang.com")) {
        return new Response("anchor verbatim", { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    getChunksForSourceMock.mockResolvedValue([
      { url: null, title: null, headingPath: ["Pinocchio"], content: "pinocchio body" },
    ]);

    const out = await fetchDocumentation(["anchor-docs", "anchor-docs", "gh-pinocchio"]);
    expect(out.match(/^---$/gm)?.length).toBe(1);
    expect(out).toContain("anchor verbatim");
    expect(out).toContain("pinocchio body");
  });
});
