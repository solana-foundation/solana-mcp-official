import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { DISCRIMINATOR_CALLS, findEnclosingFunctionBody, isFromBytesCall, precedingCallsContain } from "./_helpers.js";

export const discriminatorCheck: Visitor = {
  name: "discriminator-check",
  severity: "critical",
  appliesTo: ["pinocchio"],
  enter: {
    call_expression(node, ctx) {
      const info = isFromBytesCall(node);
      if (!info || !info.receiver) return;
      const scope = findEnclosingFunctionBody(node);
      if (!scope) return;
      if (precedingCallsContain(scope, node, DISCRIMINATOR_CALLS, info.receiver)) return;
      ctx.output.issues.push({
        severity: "critical",
        rule: "discriminator-check",
        title: `Missing discriminator validation for ${info.receiver}`,
        location: formatLocation(ctx.filename, node),
        description: `Account \`${info.receiver}\` is deserialized via \`from_bytes\` without a preceding \`validate_discriminator(...)\`. Two distinct account types with the same size become interchangeable to an attacker.`,
        suggestion: `Call \`validate_discriminator(${info.receiver}, <ExpectedType>::DISCRIMINATOR)?;\` before \`from_bytes\`.`,
      });
    },
  },
};
