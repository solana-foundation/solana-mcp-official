import type { Visitor } from "../types.js";
import { formatLocation, snippet } from "../types.js";
import { ctxAccountsField, isInsideProgramModule } from "./_anchor-helpers.js";

export const anchorManualSignerCheck: Visitor = {
  name: "anchor-manual-signer-check",
  severity: "low",
  appliesTo: ["anchor"],
  enter: {
    field_expression(node, ctx) {
      if (!isInsideProgramModule(node, ctx.anchor.programModule)) return;
      const field = node.childForFieldName("field");
      if (field?.text !== "is_signer") return;
      const receiver = node.childForFieldName("value");
      if (!receiver) return;
      // Only ctx.accounts.<field> receivers can be expressed as Signer<'info>;
      // remaining_accounts / loop-variable checks have no declarative equivalent.
      const accountField = ctxAccountsField(receiver);
      if (!accountField) return;
      ctx.output.issues.push({
        severity: "low",
        rule: "anchor-manual-signer-check",
        title: `Manual \`is_signer\` check on ctx.accounts.${accountField}`,
        location: formatLocation(ctx.filename, node),
        description: `Accessing \`.is_signer\` on \`ctx.accounts.${accountField}\` inside a handler re-implements what Anchor's typed \`Signer<'info>\` (or a \`signer\` constraint) already enforces. Manual checks are easy to forget or invert, and bypass the framework's compile-time guarantees.`,
        suggestion: `Declare the \`${accountField}\` account as \`Signer<'info>\` in the Accounts struct (or add \`#[account(signer)]\` to a typed wrapper) and drop the manual \`.is_signer\` access.`,
        code_snippet: snippet(ctx.source, node, 80),
      });
    },
  },
};
