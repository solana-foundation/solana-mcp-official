import type { Visitor } from "../types.js";
import { formatLocation, snippet } from "../types.js";
import { getMacroName } from "./_helpers.js";
import { isInsideProgramModule } from "./_anchor-helpers.js";

const KEY_EQ_MACROS = new Set(["require_keys_eq", "require_keys_neq"]);

export const anchorManualKeyEq: Visitor = {
  name: "anchor-manual-key-eq",
  severity: "low",
  appliesTo: ["anchor"],
  enter: {
    macro_invocation(node, ctx) {
      if (!isInsideProgramModule(node, ctx.anchor.programModule)) return;
      const name = getMacroName(node);
      if (!name || !KEY_EQ_MACROS.has(name)) return;
      ctx.output.issues.push({
        severity: "low",
        rule: "anchor-manual-key-eq",
        title: `\`${name}!\` likely duplicates a \`has_one\` constraint`,
        location: formatLocation(ctx.filename, node),
        description: `\`${name}!\` inside a handler typically duplicates a relationship Anchor can enforce declaratively via \`has_one = <field>\`. Constraints fail before the handler runs and stay in sync with account-struct changes; manual macros drift.`,
        suggestion: `Move the relationship to the Accounts struct: add \`has_one = <other_account>\` to the \`#[account(...)]\` of the account that owns the reference, and drop the \`${name}!\` call.`,
        code_snippet: snippet(ctx.source, node, 80),
      });
    },
  },
};
