import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";

const TOKEN_TYPES_NEEDING_INTERFACE = new Set(["Mint", "TokenAccount"]);

export const anchorAccountNotInterface: Visitor = {
  name: "anchor-account-not-interface",
  severity: "medium",
  appliesTo: ["anchor"],
  after(ctx) {
    for (const struct of ctx.anchor.structs) {
      for (const field of struct.fields) {
        if (field.typeIdentifier !== "Account") continue;
        if (!field.innerTypeIdentifier) continue;
        if (!TOKEN_TYPES_NEEDING_INTERFACE.has(field.innerTypeIdentifier)) continue;
        ctx.output.issues.push({
          severity: "medium",
          rule: "anchor-account-not-interface",
          title: `${struct.name}.${field.name} uses Account<${field.innerTypeIdentifier}> instead of InterfaceAccount`,
          location: formatLocation(ctx.filename, field.fieldNode),
          description: `\`Account<'info, ${field.innerTypeIdentifier}>\` only accepts SPL Token program accounts. To accept Token-2022 mints / token accounts as well, use \`InterfaceAccount<'info, ${field.innerTypeIdentifier}>\`. Without this change, the program silently rejects Token-2022 callers.`,
          suggestion: `Change the type to \`InterfaceAccount<'info, ${field.innerTypeIdentifier}>\`. Also switch CPI helpers from \`anchor_spl::token::*\` to \`anchor_spl::token_interface::*\` so the right program is invoked.`,
        });
      }
    }
  },
};
