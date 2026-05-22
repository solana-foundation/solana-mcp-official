import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { PROGRAM_VERIFY_CALLS, bodyContainsVerifyFor, isProgramAccountName } from "./_helpers.js";

export const programIdVerification: Visitor = {
  name: "program-id-verification",
  severity: "high",
  appliesTo: ["pinocchio"],
  after(ctx) {
    for (const { body, destructured, implName } of ctx.tryFromBodies) {
      for (const account of destructured) {
        if (!isProgramAccountName(account)) continue;
        if (bodyContainsVerifyFor(body, PROGRAM_VERIFY_CALLS, account)) continue;
        ctx.output.issues.push({
          severity: "high",
          rule: "program-id-verification",
          title: `Program account ${account} not verified by address`,
          location: formatLocation(ctx.filename, body),
          description: `\`${implName}::try_from\` accepts \`${account}\` without comparing its address to the canonical program ID. An attacker can substitute a malicious program for any unverified CPI target.`,
          suggestion: `Add the matching verify call (e.g. \`verify_system_program(${account})?;\`, \`verify_token_program(${account})?;\`) inside \`try_from\`.`,
        });
      }
    }
  },
};
