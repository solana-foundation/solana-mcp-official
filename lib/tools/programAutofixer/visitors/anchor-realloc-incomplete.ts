import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";

export const anchorReallocIncomplete: Visitor = {
  name: "anchor-realloc-incomplete",
  severity: "medium",
  appliesTo: ["anchor"],
  after(ctx) {
    for (const struct of ctx.anchor.structs) {
      for (const field of struct.fields) {
        const attr = field.attribute;
        if (!attr) continue;
        const usesRealloc = attr.kvPairs.has("realloc");
        if (!usesRealloc) continue;
        const missing: string[] = [];
        if (!attr.kvPairs.has("realloc::payer") && !attr.kvPairs.has("realloc_payer")) missing.push("realloc::payer");
        if (!attr.kvPairs.has("realloc::zero") && !attr.kvPairs.has("realloc_zero")) missing.push("realloc::zero");
        if (missing.length === 0) continue;
        ctx.output.issues.push({
          severity: "medium",
          rule: "anchor-realloc-incomplete",
          title: `\`realloc\` on ${struct.name}.${field.name} missing ${missing.join(" + ")}`,
          location: formatLocation(ctx.filename, attr.attributeNode),
          description: `Field \`${field.name}\` uses \`realloc\` but the \`#[account(...)]\` attribute is missing ${missing.map(m => `\`${m}\``).join(" and ")}. \`realloc::payer\` is required to fund the new size; \`realloc::zero\` controls whether new bytes are zeroed.`,
          suggestion: `Add \`realloc::payer = <signer_field>, realloc::zero = <bool>\` to the attribute. Set \`realloc::zero = true\` for shrink, or when the freshly-allocated bytes must not leak prior state.`,
        });
      }
    }
  },
};
