import type Parser from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation, snippet } from "../types.js";
import { walk } from "../walk.js";
import { getCallName } from "../walk.js";
import { findEnclosingFunctionBody } from "./_helpers.js";

type Node = Parser.SyntaxNode;

const AUTHORITY_FIELD_NAMES = new Set([
  "admin",
  "authority",
  "owner",
  "delegate",
  "manager",
  "update_authority",
  "freeze_authority",
  "mint_authority",
]);

const VERIFY_SIGNER_FNS = new Set(["verify_signer", "assert_signer", "check_signer"]);

function functionHasSignerVerification(scope: Node, beforeIndex: number): boolean {
  let found = false;
  walk(scope, n => {
    if (found) return "skip";
    if (n.startIndex >= beforeIndex) return "skip";
    if (n.type !== "call_expression") return;
    const fn = n.childForFieldName("function");
    const name = fn ? getCallName(fn) : null;
    if (name && VERIFY_SIGNER_FNS.has(name)) found = true;
  });
  return found;
}

export const authorityEscalation: Visitor = {
  name: "authority-escalation",
  severity: "high",
  appliesTo: ["pinocchio"],
  enter: {
    assignment_expression(node, ctx) {
      const left = node.childForFieldName("left");
      if (!left || left.type !== "field_expression") return;
      const field = left.childForFieldName("field");
      if (!field || !AUTHORITY_FIELD_NAMES.has(field.text)) return;
      const scope = findEnclosingFunctionBody(node);
      if (!scope) return;
      if (functionHasSignerVerification(scope, node.startIndex)) return;
      ctx.output.issues.push({
        severity: "high",
        rule: "authority-escalation",
        title: `Write to ${field.text} without preceding signer check`,
        location: formatLocation(ctx.filename, node),
        description: `\`${left.text} = ...\` mutates an authority/admin field but no \`verify_signer\` call appears earlier in the same function. Without checking the current authority signed off, any caller can rotate the authority.`,
        suggestion: `Before assigning a new ${field.text}, call \`verify_signer(<current_authority>, false)?;\` and assert \`<current_authority>.address() == &state.${field.text}\`.`,
        code_snippet: snippet(ctx.source, node, 80),
      });
    },
  },
};
