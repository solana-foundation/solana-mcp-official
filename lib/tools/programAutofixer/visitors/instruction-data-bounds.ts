import type { Node } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { findFirst, walk } from "../walk.js";
import { getCallName } from "../walk.js";
import {
  LEN_MARKERS,
  bodyContainsRejectingCheckFor,
  getMacroName,
  getMethodCallName,
  getMethodReceiverRoot,
  isRejectingGuard,
  macroIdentifiers,
  rootIdentifierOf,
} from "./_helpers.js";

const LEN_MACROS = new Set(["require_len", "require_size", "require_eq_len"]);
const LEN_FNS = new Set(["require_len", "check_len", "verify_len"]);
const BOUNDS_METHODS = new Set(["try_into", "get", "split_first", "split_at", "split_at_checked"]);
const CHECK_MACRO_PATTERN = /assert|require/;
const LEN_TOKEN_PATTERN = /len|size/;

function tryFromDataParam(fnNode: Node): string | null {
  const params = fnNode.childForFieldName("parameters");
  if (!params) return null;
  for (let i = 0; i < params.namedChildCount; i++) {
    const param = params.namedChild(i);
    if (param?.type !== "parameter") continue;
    const pattern = param.childForFieldName("pattern");
    if (pattern?.type === "identifier") return pattern.text;
  }
  return null;
}

function rootMatches(value: Node, dataParam: string | null): boolean {
  if (!dataParam) return true;
  const root = rootIdentifierOf(value);
  return !root || root === dataParam;
}

function containsSlicePattern(node: Node): boolean {
  return findFirst(node, n => n.type === "slice_pattern") !== null;
}

function lenComparisonInGuard(binary: Node): boolean {
  let hasLenField = false;
  walk(binary, n => {
    if (hasLenField) return "skip";
    if (n.type === "field_identifier" && LEN_MARKERS.some(m => n.text.toLowerCase().includes(m))) hasLenField = true;
  });
  return hasLenField && isRejectingGuard(binary);
}

function bodyValidatesBounds(body: Node, dataParam: string | null): boolean {
  if (dataParam && bodyContainsRejectingCheckFor(body, dataParam, LEN_MARKERS)) return true;
  let found = false;
  walk(body, n => {
    if (found) return "skip";
    if (n.type === "macro_invocation") {
      const m = getMacroName(n);
      if (!m) return;
      if (LEN_MACROS.has(m)) {
        found = true;
        return;
      }
      if (m === "array_ref" && (!dataParam || macroIdentifiers(n).includes(dataParam))) {
        found = true;
        return;
      }
      if (CHECK_MACRO_PATTERN.test(m) && macroIdentifiers(n).some(id => LEN_TOKEN_PATTERN.test(id.toLowerCase()))) {
        found = true;
      }
      return;
    }
    if (n.type === "let_declaration") {
      const pattern = n.childForFieldName("pattern");
      const value = n.childForFieldName("value");
      if (pattern && value && containsSlicePattern(pattern) && rootMatches(value, dataParam)) found = true;
      return;
    }
    if (n.type === "match_expression") {
      const value = n.childForFieldName("value");
      const bodyNode = n.childForFieldName("body");
      if (value && bodyNode && rootMatches(value, dataParam) && containsSlicePattern(bodyNode)) found = true;
      return;
    }
    if (n.type === "binary_expression") {
      if (lenComparisonInGuard(n)) found = true;
      return;
    }
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      if (name && LEN_FNS.has(name)) {
        found = true;
        return;
      }
      const methodName = getMethodCallName(n);
      if (methodName && BOUNDS_METHODS.has(methodName)) {
        const receiverRoot = getMethodReceiverRoot(n);
        if (!dataParam || !receiverRoot || receiverRoot === dataParam) found = true;
      }
    }
  });
  return found;
}

function tryFromHasLenCheck(implItem: Node): boolean {
  let found = false;
  walk(implItem, n => {
    if (found) return "skip";
    if (n.type !== "function_item") return;
    const nameNode = n.childForFieldName("name");
    if (nameNode?.text !== "try_from") return;
    const body = n.childForFieldName("body");
    if (!body) return;
    if (bodyValidatesBounds(body, tryFromDataParam(n))) found = true;
    return "skip";
  });
  return found;
}

function isTryFromSliceImpl(implItem: Node): { targetName: string } | null {
  const trait = implItem.childForFieldName("trait");
  if (!trait || trait.type !== "generic_type") return null;
  const head = trait.childForFieldName("type") ?? trait.namedChild(0);
  if (head?.text !== "TryFrom") return null;
  const args = trait.childForFieldName("type_arguments") ?? trait.namedChild(1);
  if (!args) return null;
  let isSliceOfU8 = false;
  for (let i = 0; i < args.namedChildCount; i++) {
    const arg = args.namedChild(i);
    if (arg?.type !== "reference_type") continue;
    const inner = arg.childForFieldName("type") ?? arg.namedChild(arg.namedChildCount - 1);
    if (!inner || (inner.type !== "slice_type" && inner.type !== "array_type")) continue;
    if (inner.namedChildCount !== 1) continue;
    const element = inner.childForFieldName("element") ?? inner.namedChild(0);
    if (element?.type === "primitive_type" && element.text === "u8") isSliceOfU8 = true;
  }
  if (!isSliceOfU8) return null;
  const target = implItem.childForFieldName("type");
  return target ? { targetName: target.text } : null;
}

export const instructionDataBounds: Visitor = {
  name: "instruction-data-bounds",
  severity: "high",
  appliesTo: ["pinocchio"],
  enter: {
    impl_item(node, ctx) {
      const info = isTryFromSliceImpl(node);
      if (!info) return;
      if (tryFromHasLenCheck(node)) return;
      ctx.output.issues.push({
        severity: "high",
        rule: "instruction-data-bounds",
        title: `TryFrom<&[u8]> for ${info.targetName} skips bounds validation`,
        location: formatLocation(ctx.filename, node),
        description: `\`impl TryFrom<&[u8]> for ${info.targetName}\` parses instruction data without a length check or slice-pattern destructuring. Direct indexing panics on short input (DoS).`,
        suggestion: `Open the \`try_from\` body with \`require_len!(data, Self::LEN);\`, an explicit \`data.len()\` compare, or destructure via \`let [tag, rest @ ..] = data else { return Err(...) };\` before indexing the slice.`,
      });
    },
  },
};
