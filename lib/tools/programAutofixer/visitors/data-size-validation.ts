import type { Node } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { walk } from "../walk.js";
import { getCallName } from "../walk.js";
import {
  LEN_MARKERS,
  bodyContainsRejectingCheckFor,
  findEnclosingFunctionBody,
  getCallArgs,
  getMacroName,
  getMethodCallName,
  getMethodReceiverRoot,
  isRejectingGuard,
  macroIdentifiers,
  rootIdentifierOf,
} from "./_helpers.js";

const UNCHECKED_CALLS = new Set(["from_bytes_unchecked", "load_unchecked"]);
const LENGTH_CHECK_MACROS = new Set(["require_len", "require_size", "require_eq_len"]);
const LENGTH_CHECK_FNS = new Set(["require_len", "check_len", "verify_len"]);
const BOUNDS_METHODS = new Set(["get", "split_at_checked", "split_first", "try_into"]);
const CHECK_MACRO_PATTERN = /assert|require/;
const LEN_TOKEN_PATTERN = /len|size/;

function castTargetRoot(node: Node): string | null {
  const args = getCallArgs(node);
  if (args.length > 0) return rootIdentifierOf(args[0]);
  return getMethodReceiverRoot(node);
}

function rootsCompatible(targetRoot: string | null, otherRoot: string | null): boolean {
  return !targetRoot || !otherRoot || targetRoot === otherRoot;
}

function lenComparisonMatches(binary: Node, targetRoot: string | null): boolean {
  let matched = false;
  walk(binary, n => {
    if (matched) return "skip";
    if (n.type !== "field_expression") return;
    const field = n.childForFieldName("field");
    if (!field || !LEN_MARKERS.some(m => field.text.toLowerCase().includes(m))) return;
    const value = n.childForFieldName("value");
    const receiverRoot = value ? rootIdentifierOf(value) : null;
    if (rootsCompatible(targetRoot, receiverRoot)) matched = true;
  });
  return matched;
}

function scopeHasLengthCheck(scope: Node, callNode: Node, targetRoot: string | null): boolean {
  if (targetRoot && bodyContainsRejectingCheckFor(scope, targetRoot, LEN_MARKERS, callNode.startIndex)) return true;
  let found = false;
  walk(scope, n => {
    if (found) return "skip";
    if (n.startIndex >= callNode.startIndex) return "skip";
    if (n.type === "macro_invocation") {
      const m = getMacroName(n);
      if (!m) return;
      if (LENGTH_CHECK_MACROS.has(m)) {
        found = true;
        return;
      }
      if (CHECK_MACRO_PATTERN.test(m) && macroIdentifiers(n).some(id => LEN_TOKEN_PATTERN.test(id.toLowerCase()))) {
        found = true;
      }
      return;
    }
    if (n.type === "binary_expression") {
      if (lenComparisonMatches(n, targetRoot) && isRejectingGuard(n)) found = true;
      return;
    }
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      if (name && LENGTH_CHECK_FNS.has(name)) {
        found = true;
        return;
      }
      const methodName = getMethodCallName(n);
      if (methodName && BOUNDS_METHODS.has(methodName)) {
        if (rootsCompatible(targetRoot, getMethodReceiverRoot(n))) found = true;
      }
    }
  });
  return found;
}

export const dataSizeValidation: Visitor = {
  name: "data-size-validation",
  severity: "high",
  appliesTo: ["pinocchio"],
  enter: {
    call_expression(node, ctx) {
      const fn = node.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      if (!name || !UNCHECKED_CALLS.has(name)) return;
      const scope = findEnclosingFunctionBody(node);
      if (!scope) return;
      if (scopeHasLengthCheck(scope, node, castTargetRoot(node))) return;
      ctx.output.issues.push({
        severity: "high",
        rule: "data-size-validation",
        title: `\`${name}\` without preceding length check`,
        location: formatLocation(ctx.filename, node),
        description: `\`${name}\` deserialises raw bytes without validating that the buffer is at least \`Self::LEN\` bytes. A short slice causes a buffer over-read inside the unsafe cast.`,
        suggestion: `Call \`require_len!(data, Self::LEN);\` (or an explicit \`if data.len() < Self::LEN { return Err(...) }\` guard) before \`${name}\`.`,
      });
    },
  },
};
