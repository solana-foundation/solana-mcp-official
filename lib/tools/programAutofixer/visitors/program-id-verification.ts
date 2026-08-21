import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import {
  KEY_MARKERS,
  bodyContainsRejectingCheckFor,
  fileContainsProgramVerifyFor,
  isProgramAccountName,
} from "./_helpers.js";

export const programIdVerification: Visitor = {
  name: "program-id-verification",
  severity: "low",
  appliesTo: ["pinocchio"],
  falsePositiveWhen: [
    "CPI wrapper hardcodes program id (typical pinocchio_system/pinocchio_token builders — explicit check redundant)",
    "id compared via bare == or assert_eq! without key marker",
    "verified in helper in another file",
  ],
  before(tree, ctx) {
    for (const { body, destructured, implName } of ctx.tryFromBodies) {
      for (const account of destructured) {
        if (!isProgramAccountName(account)) continue;
        if (fileContainsProgramVerifyFor(tree.rootNode, account)) continue;
        if (bodyContainsRejectingCheckFor(tree.rootNode, account, KEY_MARKERS)) continue;
        ctx.output.issues.push({
          severity: "low",
          rule: "program-id-verification",
          title: `Program account ${account} not verified by address`,
          location: formatLocation(ctx.filename, body),
          description: `\`${implName}::try_from\` accepts \`${account}\` without comparing its address to the canonical program ID.`,
          suggestion: `If instructions are built with a caller-supplied program id, compare \`${account}.key()\` against the canonical ID (e.g. \`if ${account}.key() != &pinocchio_system::ID { return Err(...); }\`). This is usually harmless with pinocchio CPI wrappers, which hardcode the program ID.`,
        });
      }
    }
  },
};
