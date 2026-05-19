import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { VERIFY_SIGNER_CALLS, bodyContainsVerifyFor, isSignerName } from "./_helpers.js";

export const missingSigner: Visitor = {
  name: "missing-signer",
  severity: "critical",
  appliesTo: ["pinocchio"],
  after(ctx) {
    for (const { body, destructured, implName } of ctx.tryFromBodies) {
      for (const account of destructured) {
        if (!isSignerName(account)) continue;
        if (bodyContainsVerifyFor(body, VERIFY_SIGNER_CALLS, account)) continue;
        ctx.output.issues.push({
          severity: "critical",
          rule: "missing-signer",
          title: `Missing signer check for ${account}`,
          location: formatLocation(ctx.filename, body),
          description: `Account \`${account}\` in \`${implName}::try_from\` looks like an authority but has no \`verify_signer(${account}, ...)\` call. An unsigned account here lets anyone perform the action.`,
          suggestion: `Add \`verify_signer(${account}, false)?;\` inside \`try_from\` before constructing the struct.`,
        });
      }
    }
  },
};
