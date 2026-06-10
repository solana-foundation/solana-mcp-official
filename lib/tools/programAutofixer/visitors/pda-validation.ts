import type { Node } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { findFirst, getCallName, walk } from "../walk.js";
import {
  containsIdentifier,
  findEnclosingFunctionBody,
  getCallArgs,
  getMacroName,
  getMethodCallName,
  isRejectingGuard,
} from "./_helpers.js";

const PDA_DERIVATION_FNS = new Set(["find_program_address", "try_find_program_address", "create_program_address"]);

// Must look like a validator (assert/verify/...) AND reference address-derivation semantics,
// so check_balance(pda) / verify_owner(pda) don't waive this critical rule.
const VALIDATION_CALL_PATTERN =
  /(assert|require|check|verify|validate).*(pda|seed|address|derive|key)|(pda|seed|address|derive|key).*(assert|require|check|verify|validate)/i;

const POSITIVE_COMPARISON_METHOD_NAMES = new Set(["eq", "equals"]);
const NEGATIVE_COMPARISON_METHOD_NAMES = new Set(["ne", "not_equals"]);

const COMPARISON_MACROS = new Set([
  "assert",
  "assert_eq",
  "debug_assert_eq",
  "require",
  "require_eq",
  "require_keys_eq",
]);

const ACCOUNT_IDENTITY_METHODS = new Set(["key", "address", "pubkey"]);
const ACCOUNT_IDENTITY_FIELDS = new Set(["key", "address", "pubkey"]);

const FRESH_CONSTRUCTOR_NAMES = /^(?:default|new\w*|from_str)$/;

function pdaVarFromPattern(pattern: Node): string | null {
  if (pattern.type === "identifier") {
    return pattern.text.startsWith("_") ? null : pattern.text;
  }
  if (pattern.type === "tuple_pattern" || pattern.type === "tuple_struct_pattern" || pattern.type === "slice_pattern") {
    const typeNode = pattern.childForFieldName("type");
    for (let i = 0; i < pattern.namedChildCount; i++) {
      const child = pattern.namedChild(i);
      if (!child) continue;
      if (typeNode && child.startIndex === typeNode.startIndex && child.endIndex === typeNode.endIndex) continue;
      return pdaVarFromPattern(child);
    }
  }
  return null;
}

function pdaVarsFromLet(letNode: Node, derivationCall: Node): string[] {
  const value = letNode.childForFieldName("value");
  if (!value) return [];
  if (!nodeContainsExact(value, derivationCall)) return [];
  const pattern = letNode.childForFieldName("pattern");
  if (!pattern) return [];
  const varName = pdaVarFromPattern(pattern);
  return varName ? [varName] : [];
}

function nodeContainsExact(haystack: Node, needle: Node): boolean {
  let hit = false;
  walk(haystack, n => {
    if (hit) return "skip";
    if (n.startIndex === needle.startIndex && n.endIndex === needle.endIndex && n.type === needle.type) {
      hit = true;
      return "skip";
    }
  });
  return hit;
}

function findEnclosingLet(node: Node): Node | null {
  let cursor: Node | null = node.parent;
  while (cursor) {
    if (cursor.type === "let_declaration") return cursor;
    cursor = cursor.parent;
  }
  return null;
}

function mentionsAnyIdentifier(node: Node, targets: readonly string[]): boolean {
  return targets.some(v => containsIdentifier(node, v));
}

function containsAccountIdentityMarker(node: Node): boolean {
  let found = false;
  walk(node, n => {
    if (found) return "skip";
    if (n.type === "call_expression") {
      const methodName = getMethodCallName(n);
      if (methodName && ACCOUNT_IDENTITY_METHODS.has(methodName)) {
        found = true;
        return "skip";
      }
    }
    if ((n.type === "field_identifier" || n.type === "identifier") && ACCOUNT_IDENTITY_FIELDS.has(n.text)) {
      found = true;
      return "skip";
    }
  });
  return found;
}

function stripWrappers(node: Node): Node {
  let cursor = node;
  for (;;) {
    if (
      cursor.type === "reference_expression" ||
      cursor.type === "unary_expression" ||
      cursor.type === "parenthesized_expression" ||
      cursor.type === "try_expression"
    ) {
      const inner = cursor.childForFieldName("value") ?? cursor.namedChild(cursor.namedChildCount - 1);
      if (!inner) return cursor;
      cursor = inner;
      continue;
    }
    return cursor;
  }
}

function isUnrelatedConstant(node: Node): boolean {
  const inner = stripWrappers(node);
  if (inner.type.endsWith("_literal")) return true;
  if (inner.type === "call_expression") {
    const fn = inner.childForFieldName("function");
    const name = fn ? getCallName(fn) : null;
    return !!name && FRESH_CONSTRUCTOR_NAMES.test(name);
  }
  return false;
}

function binaryValidatesPda(node: Node, pdaVars: readonly string[]): boolean {
  const op = node.childForFieldName("operator")?.text;
  if (op !== "==" && op !== "!=") return false;
  const left = node.childForFieldName("left");
  const right = node.childForFieldName("right");
  if (!left || !right) return false;
  const leftMentionsPda = mentionsAnyIdentifier(left, pdaVars);
  const rightMentionsPda = mentionsAnyIdentifier(right, pdaVars);
  if (leftMentionsPda === rightMentionsPda) return false;
  const comparand = leftMentionsPda ? right : left;
  if (isUnrelatedConstant(comparand)) return false;
  if (isRejectingGuard(node)) return true;
  return op === "==" && containsAccountIdentityMarker(comparand);
}

function splitMacroArgs(macroNode: Node): Node[][] {
  const tokenTree = findFirst(macroNode, n => n.type === "token_tree");
  if (!tokenTree) return [];
  const groups: Node[][] = [];
  let current: Node[] = [];
  for (let i = 1; i < tokenTree.childCount - 1; i++) {
    const child = tokenTree.child(i);
    if (!child) continue;
    if (child.type === ",") {
      groups.push(current);
      current = [];
      continue;
    }
    current.push(child);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function groupMentionsPda(group: Node[], pdaVars: readonly string[]): boolean {
  return group.some(tok => mentionsAnyIdentifier(tok, pdaVars));
}

function groupIsUnrelatedConstant(group: Node[]): boolean {
  const text = group
    .map(t => t.text)
    .join("")
    .replace(/\s+/g, "");
  if (/^[&*]*(?:b?"|b?'|\d)/.test(text)) return true;
  return /(?:^|::)(?:default|new\w*)\(/.test(text);
}

function macroValidatesPda(node: Node, pdaVars: readonly string[]): boolean {
  const name = getMacroName(node);
  if (!name || !COMPARISON_MACROS.has(name)) return false;
  const groups = splitMacroArgs(node);
  const pdaGroups = groups.filter(g => groupMentionsPda(g, pdaVars));
  if (pdaGroups.length === 0) return false;
  const others = groups.filter(g => !groupMentionsPda(g, pdaVars));
  if (others.length === 0) return true;
  return others.some(g => !groupIsUnrelatedConstant(g));
}

function methodReceiverValue(callNode: Node): Node | null {
  const fn = callNode.childForFieldName("function");
  if (!fn || fn.type !== "field_expression") return null;
  return fn.childForFieldName("value");
}

function methodComparisonValidates(node: Node, pdaVars: readonly string[], requireGuard: boolean): boolean {
  const receiver = methodReceiverValue(node);
  if (!receiver) return false;
  const args = getCallArgs(node);
  const receiverMentionsPda = mentionsAnyIdentifier(receiver, pdaVars);
  const argsMentionPda = args.some(a => mentionsAnyIdentifier(a, pdaVars));
  if (receiverMentionsPda === argsMentionPda) return false;
  const comparands = receiverMentionsPda ? args : [receiver];
  const related = comparands.filter(c => !isUnrelatedConstant(c));
  if (related.length === 0) return false;
  if (isRejectingGuard(node)) return true;
  return !requireGuard && related.some(c => containsAccountIdentityMarker(c));
}

function scopeValidatesPda(scope: Node, pdaVars: string[]): boolean {
  if (pdaVars.length === 0) return false;
  let validated = false;

  walk(scope, n => {
    if (validated) return "skip";

    if (n.type === "binary_expression" && binaryValidatesPda(n, pdaVars)) {
      validated = true;
      return "skip";
    }

    if (n.type === "macro_invocation" && macroValidatesPda(n, pdaVars)) {
      validated = true;
      return "skip";
    }

    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      if (name && VALIDATION_CALL_PATTERN.test(name) && getCallArgs(n).some(a => mentionsAnyIdentifier(a, pdaVars))) {
        validated = true;
        return "skip";
      }
      const methodName = getMethodCallName(n);
      if (methodName && POSITIVE_COMPARISON_METHOD_NAMES.has(methodName)) {
        if (methodComparisonValidates(n, pdaVars, false)) {
          validated = true;
          return "skip";
        }
      }
      if (methodName && NEGATIVE_COMPARISON_METHOD_NAMES.has(methodName)) {
        if (methodComparisonValidates(n, pdaVars, true)) {
          validated = true;
          return "skip";
        }
      }
    }
  });

  return validated;
}

export const pdaValidation: Visitor = {
  name: "pda-validation",
  severity: "critical",
  appliesTo: ["pinocchio"],
  enter: {
    call_expression(node, ctx) {
      const fn = node.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      if (!name || !PDA_DERIVATION_FNS.has(name)) return;

      const letNode = findEnclosingLet(node);
      if (!letNode) return;
      const pdaVars = pdaVarsFromLet(letNode, node);
      if (pdaVars.length === 0) return;
      const scope = findEnclosingFunctionBody(node);
      if (!scope) return;

      if (scopeValidatesPda(scope, pdaVars)) return;

      ctx.output.issues.push({
        severity: "critical",
        rule: "pda-validation",
        title: `PDA derived but not validated`,
        location: formatLocation(ctx.filename, node),
        description: `\`${name}\` derives a program address but the result is never compared to the account that was passed in. Without that comparison the caller can supply an arbitrary account claiming to be the PDA.`,
        suggestion: `After \`${name}\`, compare the derived key to the account address (\`validate_pda(...)\`, \`assert_eq!(derived, account.key())\`, or \`account.key().ne(&derived.to_bytes())\`) before trusting it.`,
      });
    },
  },
};
