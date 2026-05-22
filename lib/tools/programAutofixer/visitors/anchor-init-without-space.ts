import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import type { ParsedAccountAttr } from "./_anchor-helpers.js";

const SPL_INIT_CONSTRAINTS = new Set([
  "token::mint",
  "token::authority",
  "associated_token::mint",
  "associated_token::authority",
  "mint::decimals",
  "mint::authority",
  "mint::freeze_authority",
]);

function isSplInit(attr: ParsedAccountAttr): boolean {
  for (const key of SPL_INIT_CONSTRAINTS) {
    if (attr.kvPairs.has(key)) return true;
  }
  return false;
}

export const anchorInitWithoutSpace: Visitor = {
  name: "anchor-init-without-space",
  severity: "high",
  appliesTo: ["anchor"],
  after(ctx) {
    for (const struct of ctx.anchor.structs) {
      for (const field of struct.fields) {
        const attr = field.attribute;
        if (!attr) continue;
        const isInit = attr.keywords.has("init") || attr.keywords.has("init_if_needed");
        if (!isInit) continue;
        if (attr.kvPairs.has("space")) continue;
        if (isSplInit(attr)) continue;
        // Zero-copy accounts declare space via the struct's `#[account(zero_copy)]` attribute on the data type;
        // skip flagging when the field type is wrapped in AccountLoader.
        if (field.typeIdentifier === "AccountLoader") continue;
        ctx.output.issues.push({
          severity: "high",
          rule: "anchor-init-without-space",
          title: `\`init\` on ${struct.name}.${field.name} without \`space\``,
          location: formatLocation(ctx.filename, attr.attributeNode),
          description: `Field \`${field.name}\` uses \`init\` (or \`init_if_needed\`) but the \`#[account(...)]\` attribute is missing \`space = ...\`. Without an explicit space, Anchor cannot allocate the account at the correct size.`,
          suggestion: `Add \`space = 8 + <Self::SIZE>\` (8 bytes for the discriminator) to the attribute, or switch to \`AccountLoader\` for zero-copy accounts.`,
        });
      }
    }
  },
};
