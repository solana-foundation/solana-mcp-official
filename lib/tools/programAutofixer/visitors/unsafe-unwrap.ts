import type { Node } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation, snippet } from "../types.js";
import { getCallName, walk } from "../walk.js";
import { findEnclosingFunctionBody, getCallArgs, getMethodCallName, getMethodReceiverRoot } from "./_helpers.js";

const SAFE_CONVERT_METHODS = new Set(["to_le_bytes", "to_be_bytes", "to_ne_bytes"]);
const LITERAL_PARSE_FNS = new Set(["from_str", "try_from"]);
const OPTION_RESULT_CHECKS = new Set(["is_none", "is_some", "is_err", "is_ok"]);

/**
 * Detect `<expr>[a..b]` whose range length is statically a literal:
 *   - `data[0..4]`                    → range_expression { literal..literal }
 *   - `data[offset..offset + 4]`      → in tree-sitter-rust, parses as
 *                                       binary_expression { range_expression{id..id}, +, literal }
 *   - `data[offset..(offset + 4)]`    → range_expression { id..binary_expression{id,+,literal} }
 */
function isFixedLengthSliceIndex(indexExpr: Node): boolean {
  if (indexExpr.type !== "index_expression") return false;
  const idx = indexExpr.childForFieldName("index") ?? indexExpr.namedChild(1);
  if (!idx) return false;

  if (idx.type === "range_expression") {
    const start = idx.namedChild(0);
    const end = idx.namedChild(1);
    if (!start || !end) return false;
    if (start.type === "integer_literal" && end.type === "integer_literal") return true;
    if (start.type === "identifier" && end.type === "binary_expression") {
      const op = end.childForFieldName("operator")?.text;
      if (op !== "+" && op !== "-") return false;
      const left = end.childForFieldName("left");
      const right = end.childForFieldName("right");
      return left?.type === "identifier" && left.text === start.text && right?.type === "integer_literal";
    }
    return false;
  }

  if (idx.type === "binary_expression") {
    const op = idx.childForFieldName("operator")?.text;
    if (op !== "+" && op !== "-") return false;
    const left = idx.childForFieldName("left");
    const right = idx.childForFieldName("right");
    if (right?.type !== "integer_literal" || left?.type !== "range_expression") return false;
    const rangeStart = left.namedChild(0);
    const rangeEnd = left.namedChild(1);
    return rangeStart?.type === "identifier" && rangeEnd?.type === "identifier" && rangeStart.text === rangeEnd.text;
  }

  return false;
}

/**
 * True when the receiver of `.unwrap()` is provably infallible:
 *   - `<fixed-slice>.try_into().unwrap()`
 *   - `<int>.to_le_bytes().try_into().unwrap()` (and be/ne)
 */
function receiverIsInfallibleTryInto(unwrapCall: Node): boolean {
  const fn = unwrapCall.childForFieldName("function");
  if (!fn || fn.type !== "field_expression") return false;
  const tryIntoCall = fn.childForFieldName("value");
  if (!tryIntoCall || tryIntoCall.type !== "call_expression") return false;
  if (getMethodCallName(tryIntoCall) !== "try_into") return false;

  const tryIntoFn = tryIntoCall.childForFieldName("function");
  if (!tryIntoFn || tryIntoFn.type !== "field_expression") return false;
  const source = tryIntoFn.childForFieldName("value");
  if (!source) return false;

  if (source.type === "index_expression" && isFixedLengthSliceIndex(source)) return true;

  if (source.type === "call_expression") {
    const innerMethod = getMethodCallName(source);
    if (innerMethod && SAFE_CONVERT_METHODS.has(innerMethod)) return true;
  }

  return false;
}

function receiverIsLiteralParse(unwrapCall: Node): boolean {
  const fn = unwrapCall.childForFieldName("function");
  if (!fn || fn.type !== "field_expression") return false;
  let value = fn.childForFieldName("value");
  while (value && (value.type === "try_expression" || value.type === "parenthesized_expression")) {
    value = value.namedChild(0);
  }
  if (!value || value.type !== "call_expression") return false;
  const inner = value.childForFieldName("function");
  const name = inner ? getCallName(inner) : null;
  if (!name || !LITERAL_PARSE_FNS.has(name)) return false;
  const args = getCallArgs(value);
  return args.length > 0 && args[0].type === "string_literal";
}

function hasTestAttribute(item: Node): boolean {
  let sib = item.previousNamedSibling;
  while (sib && sib.type === "attribute_item") {
    const text = sib.text.replace(/\s/g, "");
    if (text.includes("cfg(test)") || text === "#[test]" || text.endsWith("::test]")) return true;
    sib = sib.previousNamedSibling;
  }
  return false;
}

function isInTestCode(node: Node): boolean {
  let cursor: Node | null = node;
  while (cursor) {
    if ((cursor.type === "mod_item" || cursor.type === "function_item") && hasTestAttribute(cursor)) return true;
    cursor = cursor.parent;
  }
  return false;
}

function conditionChecksOption(condition: Node, root: string): boolean {
  let found = false;
  walk(condition, n => {
    if (found) return "skip";
    if (n.type !== "call_expression") return;
    const name = getMethodCallName(n);
    if (!name || !OPTION_RESULT_CHECKS.has(name)) return;
    if (getMethodReceiverRoot(n) === root) found = true;
  });
  return found;
}

function branchDiverges(consequence: Node): boolean {
  let found = false;
  walk(consequence, n => {
    if (found) return "skip";
    if (n.type === "return_expression" || n.type === "continue_expression" || n.type === "break_expression") {
      found = true;
    }
  });
  return found;
}

function guardedByPrecedingCheck(node: Node, root: string): boolean {
  const body = findEnclosingFunctionBody(node);
  if (!body) return false;
  let found = false;
  walk(body, n => {
    if (found) return "skip";
    if (n.startIndex >= node.startIndex) return "skip";
    if (n.type !== "if_expression") return;
    const condition = n.childForFieldName("condition") ?? n.namedChild(0);
    const consequence = n.childForFieldName("consequence");
    if (!condition || !consequence) return;
    if (conditionChecksOption(condition, root) && branchDiverges(consequence)) found = true;
  });
  return found;
}

export const unsafeUnwrap: Visitor = {
  name: "unsafe-unwrap",
  severity: "low",
  appliesTo: ["pinocchio", "anchor"],
  enter: {
    call_expression(node, ctx) {
      if (getMethodCallName(node) !== "unwrap") return;
      if (receiverIsInfallibleTryInto(node)) return;
      if (receiverIsLiteralParse(node)) return;
      if (isInTestCode(node)) return;
      const root = getMethodReceiverRoot(node);
      if (root && guardedByPrecedingCheck(node, root)) return;
      ctx.output.issues.push({
        severity: "low",
        rule: "unsafe-unwrap",
        title: `Use of \`.unwrap()\` may panic`,
        location: formatLocation(ctx.filename, node),
        description: `\`.unwrap()\` panics the program on failure. Solana program panics abort the transaction and emit no useful diagnostics. Prefer \`.ok_or(ProgramError::...)?\` or \`.map_err(|_| ...)?\`.`,
        suggestion: `Replace \`.unwrap()\` with explicit error handling: \`.ok_or(ProgramError::InvalidArgument)?\` (Option) or \`.map_err(|_| ProgramError::InvalidAccountData)?\` (Result), or \`.expect("reason")\` to document why it cannot fail.`,
        code_snippet: snippet(ctx.source, node, 80),
      });
    },
  },
};
