import { describe, expect, it } from "vitest";
import { formatListSections } from "../../lib/tools/listSections";
import type { RawSource } from "../../lib/sources";

const SAMPLE: RawSource[] = [
  {
    id: "anchor-docs",
    name: "Solana > Anchor Docs",
    kind: "web",
    enabled: true,
    primary_url: "https://www.anchor-lang.com/docs",
    sections: ["frameworks", "programs"],
    use_cases: "Anchor framework, accounts macro, IDL gen",
  },
  {
    id: "gh-pinocchio",
    name: "GitHub anza-xyz/pinocchio",
    kind: "github",
    enabled: true,
    primary_url: "https://github.com/anza-xyz/pinocchio",
    sections: ["frameworks", "programs"],
    use_cases: "Pinocchio framework, zero-copy programs",
  },
];

describe("formatListSections", () => {
  it("emits header, sections taxonomy, source list, and footer in order", () => {
    const out = formatListSections(SAMPLE);
    const headerIdx = out.indexOf("documentation sources are available");
    const sectionsIdx = out.indexOf("## Sections");
    const sourcesIdx = out.indexOf("## Sources");
    const footerIdx = out.indexOf("get_documentation(section");
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(sectionsIdx).toBeGreaterThan(headerIdx);
    expect(sourcesIdx).toBeGreaterThan(sectionsIdx);
    expect(footerIdx).toBeGreaterThan(sourcesIdx);
  });

  it("emits one source line per source with title, id, sections and use_cases", () => {
    const out = formatListSections(SAMPLE);
    expect(out).toContain(
      '- title: Solana > Anchor Docs, id: anchor-docs, sections: [frameworks, programs], use_cases: "Anchor framework, accounts macro, IDL gen"',
    );
    expect(out).toContain(
      '- title: GitHub anza-xyz/pinocchio, id: gh-pinocchio, sections: [frameworks, programs], use_cases: "Pinocchio framework, zero-copy programs"',
    );
  });

  it("with no override pulls from the live ENABLED_SOURCES catalogue", () => {
    const out = formatListSections();
    expect(out).toContain("anchor-docs");
    expect(out).toContain("get_documentation(section");
  });

  it("emits only sections actually present in the source list", () => {
    const out = formatListSections(SAMPLE);
    expect(out).toContain("- frameworks —");
    expect(out).toContain("- programs —");
    expect(out).not.toContain("- defi —");
  });
});
