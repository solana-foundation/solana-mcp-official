import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";

const PERMISSIVE_TYPES = new Set(["UncheckedAccount", "AccountInfo"]);

export const anchorUncheckedAccount: Visitor = {
  name: "anchor-unchecked-account",
  severity: "low",
  appliesTo: ["anchor"],
  after(ctx) {
    for (const struct of ctx.anchor.structs) {
      for (const field of struct.fields) {
        if (!field.typeIdentifier || !PERMISSIVE_TYPES.has(field.typeIdentifier)) continue;
        if (field.hasCheckComment) continue;
        const attr = field.attribute;
        if (attr && (attr.kvPairs.has("address") || attr.kvPairs.has("owner") || attr.kvPairs.has("constraint"))) {
          continue;
        }
        ctx.output.issues.push({
          severity: "low",
          rule: "anchor-unchecked-account",
          title: `${field.typeIdentifier} on ${struct.name}.${field.name} opts out of typed validation`,
          location: formatLocation(ctx.filename, field.fieldNode),
          description: `\`${field.name}: ${field.typeText}\` bypasses Anchor's ownership / discriminator checks. Anchor still validates explicit constraints (e.g. \`address = ...\`), but the type itself enforces nothing.`,
          suggestion: `Switch to a typed wrapper when possible — \`Account<'info, T>\`, \`InterfaceAccount<'info, T>\`, \`Signer<'info>\`, \`Program<'info, T>\`, or \`Sysvar<'info, T>\`. If the raw type is intentional, add a SAFETY: doc comment justifying why and ensure every required invariant is enforced via constraints.`,
        });
      }
    }
  },
};
