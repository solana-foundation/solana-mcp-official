import type { Node, Tree } from "web-tree-sitter";
import { findAll, findFirst, getCallName, walk } from "../walk.js";

const SIGNER_NAMES = new Set(["admin", "authority", "owner", "signer", "payer", "delegate", "fee_payer"]);

const PROGRAM_ACCOUNT_NAMES = new Set([
  "system_program",
  "token_program",
  "associated_token_program",
  "ata_program",
  "spl_token_program",
]);

const VERIFY_SIGNER_CALLS = new Set(["verify_signer", "assert_signer", "check_signer"]);

const VERIFY_OWNER_CALLS = new Set([
  "verify_owned_by",
  "verify_current_program_account",
  "verify_owner",
  "assert_owned_by",
]);

const DISCRIMINATOR_CALLS = new Set(["validate_discriminator", "check_discriminator", "verify_discriminator"]);

const SYSVAR_VERIFY_CALLS = new Set(["verify_sysvar", "assert_sysvar"]);

const PROGRAM_VERIFY_CALLS = new Set([
  "verify_system_program",
  "verify_token_program",
  "verify_associated_token_program",
  "verify_token_2022_program",
  "verify_program_id",
]);

const FROM_BYTES_NAMES = new Set(["from_bytes", "from_bytes_mut", "from_bytes_unchecked", "load", "load_mut"]);

const CHECKED_ARITHMETIC_METHODS = new Set([
  "checked_add",
  "checked_sub",
  "checked_mul",
  "checked_div",
  "saturating_add",
  "saturating_sub",
  "saturating_mul",
  "wrapping_add",
  "wrapping_sub",
  "wrapping_mul",
]);

export interface TryFromBody {
  implName: string;
  body: Node;
  destructured: string[];
}

export function findTryFromBodies(tree: Tree): TryFromBody[] {
  const results: TryFromBody[] = [];
  walk(tree.rootNode, node => {
    if (node.type !== "function_item") return;
    const nameNode = node.childForFieldName("name");
    if (nameNode?.text !== "try_from") return;
    const body = node.childForFieldName("body");
    if (!body) return;
    const implName = findEnclosingImplName(node) ?? "<unknown>";
    const destructured = collectAccountBindings(body);
    results.push({ implName, body, destructured });
  });
  return results;
}

function findEnclosingImplName(node: Node): string | null {
  let cursor: Node | null = node.parent;
  while (cursor) {
    if (cursor.type === "impl_item") {
      const type = cursor.childForFieldName("type");
      return type?.text ?? null;
    }
    cursor = cursor.parent;
  }
  return null;
}

function collectAccountBindings(body: Node): string[] {
  const names: string[] = [];
  walk(body, n => {
    if (n.type !== "let_declaration") return;
    const pattern = n.childForFieldName("pattern");
    const value = n.childForFieldName("value");
    if (!pattern || !value) return;
    if (!isAccountSlicePattern(pattern)) return;
    if (rootIdentifierOf(value) !== "accounts") return;
    collectIdentifiers(pattern, names);
  });
  return names;
}

function isAccountSlicePattern(pattern: Node): boolean {
  return pattern.type === "slice_pattern" || pattern.type === "tuple_pattern";
}

function collectIdentifiers(node: Node, out: string[]): void {
  if (node.type === "identifier") {
    out.push(node.text);
    return;
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) collectIdentifiers(child, out);
  }
}

export function isSignerName(name: string): boolean {
  return SIGNER_NAMES.has(name.toLowerCase());
}

export function isProgramAccountName(name: string): boolean {
  return PROGRAM_ACCOUNT_NAMES.has(name);
}

export function getCallArgs(callNode: Node): Node[] {
  const args = callNode.childForFieldName("arguments");
  if (!args) return [];
  const out: Node[] = [];
  for (let i = 0; i < args.namedChildCount; i++) {
    const child = args.namedChild(i);
    if (child) out.push(child);
  }
  return out;
}

export function isVerifyCallFor(node: Node, names: ReadonlySet<string>, accountName: string): boolean {
  if (node.type !== "call_expression") return false;
  const fn = node.childForFieldName("function");
  if (!fn) return false;
  const callName = getCallName(fn);
  if (!callName || !names.has(callName)) return false;
  const args = getCallArgs(node);
  return args.some(a => rootIdentifierOf(a) === accountName);
}

export function bodyContainsVerifyFor(body: Node, names: ReadonlySet<string>, accountName: string): boolean {
  return findAll(body, n => isVerifyCallFor(n, names, accountName)).length > 0;
}

function nodeContainsErrorConstructor(node: Node): boolean {
  let found = false;
  walk(node, n => {
    if (found) return "skip";
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      if (name === "Err") {
        found = true;
        return "skip";
      }
    }
    if (n.type === "macro_invocation") {
      const name = getMacroName(n);
      if (name === "err" || name === "require" || name === "require_keys_eq") {
        found = true;
        return "skip";
      }
    }
  });
  return found;
}

function branchRejects(ifNode: Node): boolean {
  const consequence = ifNode.childForFieldName("consequence");
  return !!consequence && nodeContainsErrorConstructor(consequence);
}

function nodeIsInIfCondition(node: Node, ifNode: Node): boolean {
  const condition = ifNode.childForFieldName("condition") ?? ifNode.namedChild(0);
  if (!condition) return false;
  return node.startIndex >= condition.startIndex && node.endIndex <= condition.endIndex;
}

function isUnderNegationBefore(node: Node, ancestor: Node): boolean {
  let cursor: Node | null = node.parent;
  while (cursor && cursor.startIndex >= ancestor.startIndex && cursor.endIndex <= ancestor.endIndex) {
    if (cursor.type === "unary_expression" && cursor.text.trim().startsWith("!")) return true;
    if (
      cursor.startIndex === ancestor.startIndex &&
      cursor.endIndex === ancestor.endIndex &&
      cursor.type === ancestor.type
    ) {
      break;
    }
    cursor = cursor.parent;
  }
  return false;
}

export function isRejectingGuard(node: Node): boolean {
  let cursor: Node | null = node.parent;
  while (cursor) {
    if (cursor.type === "if_expression") {
      return nodeIsInIfCondition(node, cursor) && branchRejects(cursor);
    }
    cursor = cursor.parent;
  }
  return false;
}

export function isNegatedRejectingGuard(node: Node): boolean {
  let cursor: Node | null = node.parent;
  while (cursor) {
    if (cursor.type === "if_expression") {
      return nodeIsInIfCondition(node, cursor) && branchRejects(cursor) && isUnderNegationBefore(node, cursor);
    }
    cursor = cursor.parent;
  }
  return false;
}

export function inlineSignerGuardRoot(node: Node): string | null {
  if (node.type !== "call_expression") return null;
  if (getMethodCallName(node) !== "is_signer") return null;
  if (!isNegatedRejectingGuard(node)) return null;
  return getMethodReceiverRoot(node);
}

export function bodyContainsSignerValidationFor(body: Node, accountName: string): boolean {
  if (bodyContainsVerifyFor(body, VERIFY_SIGNER_CALLS, accountName)) return true;
  return findAll(body, n => inlineSignerGuardRoot(n) === accountName).length > 0;
}

export {
  VERIFY_SIGNER_CALLS,
  VERIFY_OWNER_CALLS,
  DISCRIMINATOR_CALLS,
  SYSVAR_VERIFY_CALLS,
  PROGRAM_VERIFY_CALLS,
  FROM_BYTES_NAMES,
  CHECKED_ARITHMETIC_METHODS,
};

export function isFromBytesCall(node: Node): { receiver: string | null } | null {
  if (node.type !== "call_expression") return null;
  const fn = node.childForFieldName("function");
  if (!fn) return null;
  const name = getCallName(fn);
  if (!name || !FROM_BYTES_NAMES.has(name)) return null;
  const args = getCallArgs(node);
  if (args.length === 0) return { receiver: null };
  return { receiver: rootIdentifierOf(args[0]) };
}

/**
 * Reduce an expression to its root identifier by walking AST nodes:
 *   foo                  → "foo"
 *   &foo                 → "foo"
 *   foo.data()           → "foo"
 *   foo.bar.baz          → "foo"
 *   foo.data().as_ref()  → "foo"
 *   foo?                 → "foo"
 * Returns null for shapes the walker doesn't recognise — callers must handle null.
 */
export function rootIdentifierOf(arg: Node): string | null {
  let cursor: Node | null = arg;
  while (cursor) {
    switch (cursor.type) {
      case "identifier":
        return cursor.text;
      case "reference_expression": {
        const inner = cursor.namedChild(cursor.namedChildCount - 1);
        cursor = inner;
        continue;
      }
      case "field_expression": {
        cursor = cursor.childForFieldName("value");
        continue;
      }
      case "call_expression": {
        cursor = cursor.childForFieldName("function");
        continue;
      }
      case "try_expression":
      case "parenthesized_expression": {
        cursor = cursor.namedChild(0);
        continue;
      }
      default:
        return null;
    }
  }
  return null;
}

export function precedingCallsContain(
  scope: Node,
  target: Node,
  names: ReadonlySet<string>,
  accountName: string,
): boolean {
  let found = false;
  walk(scope, n => {
    if (found) return "skip";
    if (n.startIndex >= target.startIndex) return "skip";
    if (isVerifyCallFor(n, names, accountName)) found = true;
  });
  return found;
}

export function findEnclosingFunctionBody(node: Node): Node | null {
  let cursor: Node | null = node.parent;
  while (cursor) {
    if (cursor.type === "function_item") {
      return cursor.childForFieldName("body");
    }
    cursor = cursor.parent;
  }
  return null;
}

export function findFunctionByName(tree: Tree, name: string): Node | null {
  return findFirst(tree.rootNode, n => {
    if (n.type !== "function_item") return false;
    const nameNode = n.childForFieldName("name");
    return nameNode?.text === name;
  });
}

/**
 * Walk identifiers inside a node and report whether any of them match `target`.
 * Used for "does this expression mention variable X" predicates.
 */
export function containsIdentifier(node: Node, target: string): boolean {
  let found = false;
  walk(node, n => {
    if (found) return "skip";
    if (n.type === "identifier" && n.text === target) {
      found = true;
      return "skip";
    }
  });
  return found;
}

/**
 * Yield each direct argument inside a macro_invocation's token_tree as a flat list
 * of contained identifiers. Used for assert_eq!/assert_ne! style detection.
 */
export function macroIdentifiers(macroNode: Node): string[] {
  const tokenTree = findFirst(macroNode, n => n.type === "token_tree");
  if (!tokenTree) return [];
  const out: string[] = [];
  walk(tokenTree, n => {
    if (n.type === "identifier") out.push(n.text);
  });
  return out;
}

export function getMacroName(macroNode: Node): string | null {
  if (macroNode.type !== "macro_invocation") return null;
  const first = macroNode.namedChild(0);
  if (!first) return null;
  if (first.type === "identifier") return first.text;
  if (first.type === "scoped_identifier") return first.lastChild?.text ?? null;
  return null;
}

export function getMethodCallName(callNode: Node): string | null {
  if (callNode.type !== "call_expression") return null;
  const fn = callNode.childForFieldName("function");
  if (!fn || fn.type !== "field_expression") return null;
  const field = fn.childForFieldName("field") ?? fn.lastChild;
  return field?.text ?? null;
}

export function getMethodReceiverRoot(callNode: Node): string | null {
  if (callNode.type !== "call_expression") return null;
  const fn = callNode.childForFieldName("function");
  if (!fn || fn.type !== "field_expression") return null;
  const value = fn.childForFieldName("value");
  return value ? rootIdentifierOf(value) : null;
}
