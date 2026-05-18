import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { VERIFY_OWNER_CALLS, findEnclosingFunctionBody, isFromBytesCall, precedingCallsContain } from "./_helpers.js";

export const missingOwner: Visitor = {
  name: "missing-owner",
  severity: "critical",
  appliesTo: ["pinocchio"],
  enter: {
    call_expression(node, ctx) {
      const info = isFromBytesCall(node);
      if (!info || !info.receiver) return;
      const scope = findEnclosingFunctionBody(node);
      if (!scope) return;
      if (precedingCallsContain(scope, node, VERIFY_OWNER_CALLS, info.receiver)) return;
      ctx.output.issues.push({
        severity: "critical",
        rule: "missing-owner",
        title: `Deserialization of ${info.receiver} without ownership check`,
        location: formatLocation(ctx.filename, node),
        description: `\`from_bytes\` is called on \`${info.receiver}\` without a preceding \`verify_owned_by(${info.receiver}, &crate::ID)\` (or \`verify_current_program_account\`). Type-cosplay attack: a malicious account owned by another program can be deserialized as our state.`,
        suggestion: `Insert \`verify_current_program_account(${info.receiver})?;\` (or \`verify_owned_by(${info.receiver}, &crate::ID)?;\`) before deserializing.`,
      });
    },
  },
};
