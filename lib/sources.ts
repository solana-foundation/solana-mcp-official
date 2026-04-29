import { RAW_SOURCES } from "./sources.generated.js";
import { SECTION_IDS, type RawSource, type SectionId } from "./sources.types.js";

export type { SectionId, RawSource } from "./sources.types.js";
export { SECTION_IDS, SECTION_DESCRIPTIONS } from "./sources.types.js";

const ALLOWED = new Set<string>(SECTION_IDS);

function freezeSources(raw: readonly RawSource[]): readonly RawSource[] {
  for (const s of raw) {
    for (const tag of s.sections) {
      if (!ALLOWED.has(tag)) {
        throw new Error(
          `sources.generated.ts contains unknown section "${tag}" on "${s.id}" — regenerate via pnpm gen:sources`,
        );
      }
    }
  }
  return raw;
}

export const ALL_SOURCES: readonly RawSource[] = freezeSources(RAW_SOURCES);
export const ENABLED_SOURCES: readonly RawSource[] = ALL_SOURCES.filter(s => s.enabled);

export function getSourceById(id: string): RawSource | undefined {
  return ALL_SOURCES.find(s => s.id === id);
}

export function sourcesForSection(section: SectionId): readonly RawSource[] {
  return ENABLED_SOURCES.filter(s => s.sections.includes(section));
}

export function distinctEnabledSections(): readonly SectionId[] {
  const present = new Set<SectionId>();
  for (const s of ENABLED_SOURCES) {
    for (const tag of s.sections) present.add(tag);
  }
  return SECTION_IDS.filter(id => present.has(id));
}
