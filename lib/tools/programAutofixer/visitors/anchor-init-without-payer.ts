import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";

export const anchorInitWithoutPayer: Visitor = {
  name: "anchor-init-without-payer",
  severity: "critical",
  appliesTo: ["anchor"],
  after(ctx) {
    for (const struct of ctx.anchor.structs) {
      for (const field of struct.fields) {
        const attr = field.attribute;
        if (!attr) continue;
        const isInit = attr.keywords.has("init") || attr.keywords.has("init_if_needed");
        if (!isInit) continue;
        if (attr.kvPairs.has("payer")) continue;
        ctx.output.issues.push({
          severity: "critical",
          rule: "anchor-init-without-payer",
          title: `\`init\` on ${struct.name}.${field.name} without \`payer\``,
          location: formatLocation(ctx.filename, attr.attributeNode),
          description: `Field \`${field.name}\` uses \`init\` (or \`init_if_needed\`) but the \`#[account(...)]\` attribute is missing \`payer = ...\`. The macro will fail to compile, or worse — a misconfigured downstream Accounts struct will silently shift the lamports cost onto an unintended account.`,
          suggestion: `Add \`payer = <signer_field>\` to the attribute, referencing the Accounts-struct field that holds the funding signer.`,
        });
      }
    }
  },
};
