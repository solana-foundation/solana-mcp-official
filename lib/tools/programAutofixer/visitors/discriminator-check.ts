import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import {
  DISCRIMINATOR_CALLS,
  DISCRIMINATOR_MARKERS,
  bodyContainsRejectingCheckFor,
  bodyContainsVerifyFor,
  findEnclosingFunctionBody,
  isFromBytesCall,
} from "./_helpers.js";
import { accountCreatedEarlierIn, localFromBytesImplChecks } from "./missing-owner.js";

export const discriminatorCheck: Visitor = {
  name: "discriminator-check",
  severity: "high",
  appliesTo: ["pinocchio"],
  enter: {
    call_expression(node, ctx) {
      const info = isFromBytesCall(node);
      if (!info || !info.receiver) return;
      const scope = findEnclosingFunctionBody(node);
      if (!scope) return;
      const root = node.tree.rootNode;
      if (bodyContainsVerifyFor(root, DISCRIMINATOR_CALLS, info.receiver)) return;
      if (bodyContainsRejectingCheckFor(root, info.receiver, DISCRIMINATOR_MARKERS)) return;
      if (localFromBytesImplChecks(node, DISCRIMINATOR_MARKERS)) return;
      if (accountCreatedEarlierIn(scope, node, info.receiver)) return;
      ctx.output.issues.push({
        severity: "high",
        rule: "discriminator-check",
        title: `Missing discriminator validation for ${info.receiver}`,
        location: formatLocation(ctx.filename, node),
        description: `Account \`${info.receiver}\` is deserialized via \`from_bytes\` without a preceding \`validate_discriminator(...)\`. Two distinct account types with the same size become interchangeable to an attacker.`,
        suggestion: `Call \`validate_discriminator(${info.receiver}, <ExpectedType>::DISCRIMINATOR)?;\` before \`from_bytes\`.`,
      });
    },
  },
};
