import { describe, expect, it } from "vitest";
import {
  ALL_SOURCES,
  ENABLED_SOURCES,
  SECTION_DESCRIPTIONS,
  SECTION_IDS,
  distinctEnabledSections,
  getSourceById,
  sourcesForSection,
} from "../../lib/sources";

describe("sources catalogue", () => {
  it("loads all sources from the generated module", () => {
    expect(ALL_SOURCES.length).toBeGreaterThan(100);
    for (const s of ALL_SOURCES) {
      expect(s.id).toMatch(/^[a-z0-9-]+$/);
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.use_cases.length).toBeGreaterThan(0);
      expect(s.sections.length).toBeGreaterThan(0);
    }
  });

  it("only exposes tags from the closed taxonomy", () => {
    const allowed = new Set(SECTION_IDS);
    for (const s of ALL_SOURCES) {
      for (const tag of s.sections) {
        expect(allowed.has(tag)).toBe(true);
      }
    }
  });

  it("filters disabled sources from ENABLED_SOURCES", () => {
    expect(ENABLED_SOURCES.every(s => s.enabled)).toBe(true);
    const disabled = ALL_SOURCES.filter(s => !s.enabled).length;
    expect(ENABLED_SOURCES.length).toBe(ALL_SOURCES.length - disabled);
  });

  it("getSourceById finds and rejects ids", () => {
    const sample = ALL_SOURCES[0];
    expect(getSourceById(sample.id)?.id).toBe(sample.id);
    expect(getSourceById("definitely-not-a-real-source")).toBeUndefined();
  });

  it("sourcesForSection returns enabled sources tagged with the section", () => {
    const programs = sourcesForSection("programs");
    expect(programs.length).toBeGreaterThan(0);
    expect(programs.every(s => s.enabled && s.sections.includes("programs"))).toBe(true);
  });

  it("distinctEnabledSections matches the union of all enabled tags, ordered by SECTION_IDS", () => {
    const expected = new Set<string>();
    for (const s of ENABLED_SOURCES) for (const tag of s.sections) expected.add(tag);
    const got = distinctEnabledSections();
    expect(new Set(got)).toEqual(expected);
    const order = SECTION_IDS.filter(id => expected.has(id));
    expect(got).toEqual(order);
  });

  it("describes every taxonomy id", () => {
    for (const id of SECTION_IDS) {
      expect(SECTION_DESCRIPTIONS[id].length).toBeGreaterThan(0);
    }
  });
});
