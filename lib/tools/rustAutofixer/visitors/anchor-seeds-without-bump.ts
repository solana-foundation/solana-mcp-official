import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";

export const anchorSeedsWithoutBump: Visitor = {
  name: "anchor-seeds-without-bump",
  severity: "high",
  appliesTo: ["anchor"],
  after(ctx) {
    for (const struct of ctx.anchor.structs) {
      for (const field of struct.fields) {
        const attr = field.attribute;
        if (!attr) continue;
        const hasSeeds = attr.kvPairs.has("seeds") || attr.keywords.has("seeds");
        if (!hasSeeds) continue;
        const hasBump = attr.keywords.has("bump") || attr.kvPairs.has("bump");
        if (hasBump) continue;
        ctx.output.issues.push({
          severity: "high",
          rule: "anchor-seeds-without-bump",
          title: `\`seeds\` declared on ${struct.name}.${field.name} without \`bump\``,
          location: formatLocation(ctx.filename, attr.attributeNode),
          description: `Field \`${field.name}\` carries a \`seeds = [...]\` constraint but no \`bump\` (canonical bump) or \`bump = ...\` (stored bump). Without bump, Anchor falls back to runtime PDA derivation, allowing non-canonical bumps to satisfy the constraint.`,
          suggestion: `Append \`bump\` (canonical) or \`bump = state.bump\` (stored) to the \`#[account(...)]\` attribute on \`${field.name}\`.`,
        });
      }
    }
  },
};
