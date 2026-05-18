import type Parser from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation, snippet } from "../types.js";
import { walk } from "../walk.js";
import { getCallName } from "../walk.js";
import { containsIdentifier, findEnclosingFunctionBody, getCallArgs, rootIdentifierOf } from "./_helpers.js";

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
const AUTHORITY_COMPARISON_METHODS = new Set(["eq", "ne", "equals", "not_equals"]);

function verifiedSignersBefore(scope: Node, beforeIndex: number): Set<string> {
  const signers = new Set<string>();
  walk(scope, n => {
    if (n.startIndex >= beforeIndex) return "skip";
    if (n.type !== "call_expression") return;
    const fn = n.childForFieldName("function");
    const name = fn ? getCallName(fn) : null;
    if (!name || !VERIFY_SIGNER_FNS.has(name)) return;
    const signerArg = getCallArgs(n)[0];
    const root = signerArg ? rootIdentifierOf(signerArg) : null;
    if (root) signers.add(root);
  });
  return signers;
}

function fieldNameOf(node: Node): string | null {
  if (node.type !== "field_expression") return null;
  return node.childForFieldName("field")?.text ?? null;
}

function expressionMentionsField(node: Node, fieldName: string): boolean {
  let found = false;
  walk(node, n => {
    if (found) return "skip";
    if (fieldNameOf(n) === fieldName) {
      found = true;
      return "skip";
    }
  });
  return found;
}

function expressionMentionsSigner(node: Node, signer: string): boolean {
  return containsIdentifier(node, signer);
}

function scopeAuthorizesFieldWrite(
  scope: Node,
  beforeIndex: number,
  fieldName: string,
  verifiedSigners: ReadonlySet<string>,
): boolean {
  if (verifiedSigners.size === 0) return false;
  let authorized = false;
  walk(scope, n => {
    if (authorized) return "skip";
    if (n.startIndex >= beforeIndex) return "skip";
    if (n.type === "binary_expression") {
      const op = n.childForFieldName("operator")?.text;
      if (op !== "==" && op !== "!=") return;
      const left = n.childForFieldName("left");
      const right = n.childForFieldName("right");
      if (!left || !right) return;
      const mentionsField = expressionMentionsField(left, fieldName) || expressionMentionsField(right, fieldName);
      if (!mentionsField) return;
      for (const signer of verifiedSigners) {
        if (expressionMentionsSigner(left, signer) || expressionMentionsSigner(right, signer)) {
          authorized = true;
          return "skip";
        }
      }
    }
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function");
      if (!fn || fn.type !== "field_expression") return;
      const method = fn.childForFieldName("field") ?? fn.lastChild;
      if (!method || !AUTHORITY_COMPARISON_METHODS.has(method.text)) return;
      if (!expressionMentionsField(n, fieldName)) return;
      for (const signer of verifiedSigners) {
        if (expressionMentionsSigner(n, signer)) {
          authorized = true;
          return "skip";
        }
      }
    }
  });
  return authorized;
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
      const verifiedSigners = verifiedSignersBefore(scope, node.startIndex);
      if (scopeAuthorizesFieldWrite(scope, node.startIndex, field.text, verifiedSigners)) return;
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
