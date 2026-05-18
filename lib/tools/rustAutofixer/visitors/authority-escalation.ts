import type Parser from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation, snippet } from "../types.js";
import { getCallName, walk } from "../walk.js";
import {
  containsIdentifier,
  findEnclosingFunctionBody,
  getCallArgs,
  getMacroName,
  getMethodCallName,
  rootIdentifierOf,
} from "./_helpers.js";

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
const AUTHORIZATION_METHODS = new Set(["eq", "ne", "equals", "not_equals"]);
const AUTHORIZATION_MACROS = new Set([
  "assert_eq",
  "assert_ne",
  "debug_assert_eq",
  "debug_assert_ne",
  "require_eq",
  "require_neq",
  "require_keys_eq",
  "require_keys_neq",
]);

function verifiedSignersBefore(scope: Node, beforeIndex: number): Set<string> {
  const signers = new Set<string>();
  walk(scope, n => {
    if (n.startIndex >= beforeIndex) return "skip";
    if (n.type !== "call_expression") return;
    const fn = n.childForFieldName("function");
    const name = fn ? getCallName(fn) : null;
    if (!name || !VERIFY_SIGNER_FNS.has(name)) return;
    const signer = getCallArgs(n)[0];
    const root = signer ? rootIdentifierOf(signer) : null;
    if (root) signers.add(root);
  });
  return signers;
}

function containsAuthorityField(node: Node, stateRoot: string, fieldName: string): boolean {
  let found = false;
  walk(node, n => {
    if (found) return "skip";
    if (n.type !== "field_expression") return;
    const field = n.childForFieldName("field");
    const value = n.childForFieldName("value");
    if (field?.text === fieldName && value && rootIdentifierOf(value) === stateRoot) {
      found = true;
      return "skip";
    }
  });
  return found;
}

function mentionsAnySigner(node: Node, signers: ReadonlySet<string>): boolean {
  for (const signer of signers) {
    if (containsIdentifier(node, signer)) return true;
  }
  return false;
}

function comparisonAuthorizesMutation(
  node: Node,
  signers: ReadonlySet<string>,
  stateRoot: string,
  fieldName: string,
): boolean {
  if (node.type === "binary_expression") {
    const op = node.childForFieldName("operator")?.text;
    if (op !== "==" && op !== "!=") return false;
    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");
    if (!left || !right) return false;
    return (
      (mentionsAnySigner(left, signers) && containsAuthorityField(right, stateRoot, fieldName)) ||
      (mentionsAnySigner(right, signers) && containsAuthorityField(left, stateRoot, fieldName))
    );
  }

  if (node.type === "macro_invocation") {
    const name = getMacroName(node);
    if (!name || !AUTHORIZATION_MACROS.has(name)) return false;
    return (
      mentionsAnySigner(node, signers) && containsIdentifier(node, stateRoot) && containsIdentifier(node, fieldName)
    );
  }

  if (node.type === "call_expression") {
    const methodName = getMethodCallName(node);
    if (!methodName || !AUTHORIZATION_METHODS.has(methodName)) return false;
    return mentionsAnySigner(node, signers) && containsAuthorityField(node, stateRoot, fieldName);
  }

  return false;
}

function functionAuthorizesAuthorityMutation(
  scope: Node,
  beforeIndex: number,
  stateRoot: string,
  fieldName: string,
): boolean {
  const signers = verifiedSignersBefore(scope, beforeIndex);
  if (signers.size === 0) return false;
  let authorized = false;
  walk(scope, n => {
    if (authorized) return "skip";
    if (n.startIndex >= beforeIndex) return "skip";
    if (comparisonAuthorizesMutation(n, signers, stateRoot, fieldName)) {
      authorized = true;
      return "skip";
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
      const state = left.childForFieldName("value");
      const stateRoot = state ? rootIdentifierOf(state) : null;
      if (!stateRoot) return;
      const scope = findEnclosingFunctionBody(node);
      if (!scope) return;
      if (functionAuthorizesAuthorityMutation(scope, node.startIndex, stateRoot, field.text)) return;
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
