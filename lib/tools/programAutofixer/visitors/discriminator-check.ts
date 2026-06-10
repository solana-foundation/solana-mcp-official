import type { Node } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { findFirst } from "../walk.js";
import { DISCRIMINATOR_CALLS, DISCRIMINATOR_MARKERS, isFromBytesCall } from "./_helpers.js";
import { fromBytesTargetValidated } from "./missing-owner.js";

// Discriminators distinguish account types within one program; foreign accounts are the
// owner check's job. A program with no discriminator scheme has nothing to validate against.
function fileHasDiscriminatorScheme(root: Node): boolean {
  return !!findFirst(root, n => {
    if (n.type !== "identifier" && n.type !== "field_identifier") return false;
    return n.text.toLowerCase().includes("discriminator");
  });
}

export const discriminatorCheck: Visitor = {
  name: "discriminator-check",
  severity: "high",
  appliesTo: ["pinocchio"],
  enter: {
    call_expression(node, ctx) {
      const info = isFromBytesCall(node);
      if (!info || !info.receiver) return;
      if (!fileHasDiscriminatorScheme(node.tree.rootNode)) return;
      if (fromBytesTargetValidated(node, ctx, DISCRIMINATOR_CALLS, DISCRIMINATOR_MARKERS)) return;
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
