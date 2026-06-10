import type { Node } from "web-tree-sitter";
import type { Visitor, VisitorContext } from "../types.js";
import { formatLocation, snippet } from "../types.js";
import { getCallName, walk } from "../walk.js";
import {
  bodyContainsSignerValidationFor,
  findEnclosingFunctionBody,
  getCallArgs,
  getMacroName,
  getMethodCallName,
  inlineSignerGuardRoot,
  isNegatedRejectingGuard,
  isRejectingGuard,
  macroIdentifiers,
  rootIdentifierOf,
} from "./_helpers.js";

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
const AUTHORIZATION_MACROS = new Set(["assert_eq", "debug_assert_eq", "require_eq", "require_keys_eq"]);
const LOCAL_CONSTRUCTOR_FNS = new Set(["default", "zeroed"]);
const INIT_FN_NAME_RE = /init|create|new/i;

function verifiedSignersBefore(scope: Node, beforeIndex: number): Set<string> {
  const signers = new Set<string>();
  walk(scope, n => {
    if (n.startIndex >= beforeIndex) return "skip";
    if (n.type !== "call_expression") return;
    const fn = n.childForFieldName("function");
    const name = fn ? getCallName(fn) : null;
    if (name && VERIFY_SIGNER_FNS.has(name)) {
      const signer = getCallArgs(n)[0];
      const root = signer ? rootIdentifierOf(signer) : null;
      if (root) signers.add(root);
    }
    const inlineRoot = inlineSignerGuardRoot(n);
    if (inlineRoot) signers.add(inlineRoot);
  });
  return signers;
}

function tryFromVerifiedSigners(ctx: VisitorContext): Set<string> {
  const out = new Set<string>();
  for (const tf of ctx.tryFromBodies) {
    for (const name of tf.destructured) {
      if (bodyContainsSignerValidationFor(tf.body, name)) out.add(name);
    }
  }
  return out;
}

function mentionsName(node: Node, target: string): boolean {
  let found = false;
  walk(node, n => {
    if (found) return "skip";
    if ((n.type === "identifier" || n.type === "field_identifier") && n.text === target) {
      found = true;
      return "skip";
    }
  });
  return found;
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
    if (mentionsName(node, signer)) return true;
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
    const mentionsSignerAndAuthority =
      (mentionsAnySigner(left, signers) && containsAuthorityField(right, stateRoot, fieldName)) ||
      (mentionsAnySigner(right, signers) && containsAuthorityField(left, stateRoot, fieldName));
    if (!mentionsSignerAndAuthority) return false;
    if (op === "!=") return isRejectingGuard(node);
    return isNegatedRejectingGuard(node);
  }

  if (node.type === "macro_invocation") {
    const name = getMacroName(node);
    if (!name || !AUTHORIZATION_MACROS.has(name)) return false;
    return mentionsAnySigner(node, signers) && mentionsName(node, stateRoot) && mentionsName(node, fieldName);
  }

  if (node.type === "call_expression") {
    const methodName = getMethodCallName(node);
    if (!methodName || !AUTHORIZATION_METHODS.has(methodName)) return false;
    if (!mentionsAnySigner(node, signers) || !containsAuthorityField(node, stateRoot, fieldName)) return false;
    if (methodName === "ne" || methodName === "not_equals") return isRejectingGuard(node);
    return isNegatedRejectingGuard(node);
  }

  return false;
}

function functionAuthorizesAuthorityMutation(
  scope: Node,
  beforeIndex: number,
  stateRoot: string,
  fieldName: string,
  seedSigners: ReadonlySet<string>,
): boolean {
  const signers = verifiedSignersBefore(scope, beforeIndex);
  for (const s of seedSigners) signers.add(s);
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

function unwrapExpr(node: Node | null): Node | null {
  let cursor: Node | null = node;
  for (;;) {
    if (!cursor) return null;
    if (cursor.type === "try_expression" || cursor.type === "parenthesized_expression") {
      cursor = cursor.namedChild(0);
      continue;
    }
    if (cursor.type === "reference_expression") {
      cursor = cursor.childForFieldName("value");
      continue;
    }
    return cursor;
  }
}

function isLocallyConstructedBinding(scope: Node, root: string, beforeIndex: number): boolean {
  let found = false;
  walk(scope, n => {
    if (found) return "skip";
    if (n.startIndex >= beforeIndex) return "skip";
    if (n.type !== "let_declaration") return;
    const pattern = n.childForFieldName("pattern");
    if (pattern?.type !== "identifier" || pattern.text !== root) return;
    const value = unwrapExpr(n.childForFieldName("value"));
    if (!value) return;
    if (value.type === "struct_expression") {
      found = true;
      return;
    }
    if (value.type === "call_expression") {
      const fn = value.childForFieldName("function");
      const callName = fn ? getCallName(fn) : null;
      if (callName && LOCAL_CONSTRUCTOR_FNS.has(callName)) found = true;
    }
  });
  return found;
}

function scopeHasSignerValidation(scope: Node): boolean {
  let found = false;
  walk(scope, n => {
    if (found) return "skip";
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      if (name && VERIFY_SIGNER_FNS.has(name)) {
        found = true;
        return "skip";
      }
      if (inlineSignerGuardRoot(n)) {
        found = true;
        return "skip";
      }
    }
    if (n.type === "macro_invocation" && macroIdentifiers(n).some(id => id.includes("is_signer"))) {
      found = true;
      return "skip";
    }
  });
  return found;
}

function enclosingFunctionName(node: Node): string | null {
  let cursor: Node | null = node.parent;
  while (cursor) {
    if (cursor.type === "function_item") return cursor.childForFieldName("name")?.text ?? null;
    cursor = cursor.parent;
  }
  return null;
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
      if (isLocallyConstructedBinding(scope, stateRoot, node.startIndex)) return;
      const seedSigners = tryFromVerifiedSigners(ctx);
      const fnName = enclosingFunctionName(node);
      if (fnName && INIT_FN_NAME_RE.test(fnName) && (seedSigners.size > 0 || scopeHasSignerValidation(scope))) {
        return;
      }
      if (functionAuthorizesAuthorityMutation(scope, node.startIndex, stateRoot, field.text, seedSigners)) return;
      ctx.output.issues.push({
        severity: "high",
        rule: "authority-escalation",
        title: `Write to ${field.text} without preceding signer check`,
        location: formatLocation(ctx.filename, node),
        description: `\`${left.text} = ...\` mutates an authority/admin field but no \`verify_signer\` call appears earlier in the same function. Without checking the current authority signed off, any caller can rotate the authority.`,
        suggestion: `Before assigning a new ${field.text}, verify the current authority signed with \`verify_signer(<current_authority>)?\` (or an explicit \`.is_signer()\` check) and assert \`<current_authority>.address() == &state.${field.text}\`.`,
        code_snippet: snippet(ctx.source, node, 80),
      });
    },
  },
};
