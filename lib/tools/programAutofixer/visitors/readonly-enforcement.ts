import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { walk } from "../walk.js";
import { getCallArgs } from "./_helpers.js";

const ALL_VERIFY_CALLS = new Set([
  "verify_signer",
  "verify_writable",
  "verify_readonly",
  "verify_owned_by",
  "verify_current_program_account",
  "verify_system_program",
  "verify_token_program",
  "verify_associated_token_program",
  "verify_program_id",
  "verify_sysvar",
  "assert_signer",
  "assert_owned_by",
]);

export const readonlyEnforcement: Visitor = {
  name: "readonly-enforcement",
  severity: "medium",
  appliesTo: ["pinocchio"],
  after(ctx) {
    for (const { body, destructured, implName } of ctx.tryFromBodies) {
      const verified = new Set<string>();
      walk(body, n => {
        if (n.type !== "call_expression") return;
        const fnNode = n.childForFieldName("function");
        const fnName = fnNode ? (fnNode.lastChild?.text ?? fnNode.text) : null;
        if (!fnName || !ALL_VERIFY_CALLS.has(fnName)) return;
        for (const arg of getCallArgs(n)) {
          const root = arg.text.split(".")[0];
          verified.add(root);
        }
      });
      for (const account of destructured) {
        if (verified.has(account)) continue;
        if (account.startsWith("_")) continue;
        ctx.output.issues.push({
          severity: "medium",
          rule: "readonly-enforcement",
          title: `Account ${account} has no verify_* call`,
          location: formatLocation(ctx.filename, body),
          description: `\`${implName}::try_from\` destructures \`${account}\` but never calls any \`verify_*\` on it. Every account should be checked for at least one of: signer, writable/readonly, ownership, or program ID.`,
          suggestion: `Decide the role of \`${account}\` and add the matching call (\`verify_readonly\`, \`verify_writable\`, \`verify_owned_by\`, etc.).`,
        });
      }
    }
  },
};
