import { ENABLED_SOURCES, SECTION_DESCRIPTIONS, SECTION_IDS, type RawSource, type SectionId } from "../sources.js";

const HEADER = `The following Solana ecosystem documentation sources are available. Each source lists its sections plus a use_cases keyword string describing WHEN it is relevant. Match the user's intent against use_cases, then call \`get_documentation\` with one or more source ids to fetch the full docs.`;

const FOOTER = `To fetch full documentation for one or more sources, call \`get_documentation(section: "<id>")\` or \`get_documentation(section: ["<id1>", "<id2>"])\`.`;

function distinctSections(sources: readonly RawSource[]): SectionId[] {
  const present = new Set<SectionId>();
  for (const s of sources) for (const tag of s.sections) present.add(tag);
  return SECTION_IDS.filter(id => present.has(id));
}

function formatSectionsBlock(sources: readonly RawSource[]): string {
  const lines = distinctSections(sources).map(id => `- ${id} — ${SECTION_DESCRIPTIONS[id]}`);
  return ["## Sections", ...lines].join("\n");
}

function formatSourceLine(source: RawSource): string {
  const sections = source.sections.join(", ");
  return `- title: ${source.name}, id: ${source.id}, sections: [${sections}], use_cases: "${source.use_cases}"`;
}

function formatSourcesBlock(sources: readonly RawSource[]): string {
  return ["## Sources", ...sources.map(formatSourceLine)].join("\n");
}

export function formatListSections(sources: readonly RawSource[] = ENABLED_SOURCES): string {
  return [HEADER, formatSectionsBlock(sources), formatSourcesBlock(sources), FOOTER].join("\n\n");
}
