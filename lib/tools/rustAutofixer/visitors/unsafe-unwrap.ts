import type Parser from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation, snippet } from "../types.js";
import { getMethodCallName } from "./_helpers.js";

type Node = Parser.SyntaxNode;

const TARGETS = new Set(["unwrap", "expect"]);
const SAFE_CONVERT_METHODS = new Set(["to_le_bytes", "to_be_bytes", "to_ne_bytes"]);

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
 * True when the receiver of `.unwrap()` / `.expect()` is provably infallible:
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

export const unsafeUnwrap: Visitor = {
  name: "unsafe-unwrap",
  severity: "medium",
  appliesTo: ["pinocchio", "anchor"],
  enter: {
    call_expression(node, ctx) {
      const methodName = getMethodCallName(node);
      if (!methodName || !TARGETS.has(methodName)) return;
      if (receiverIsInfallibleTryInto(node)) return;
      ctx.output.issues.push({
        severity: "medium",
        rule: "unsafe-unwrap",
        title: `Use of \`.${methodName}()\` may panic`,
        location: formatLocation(ctx.filename, node),
        description: `\`.${methodName}()\` panics the program on failure. Solana program panics abort the transaction and emit no useful diagnostics. Prefer \`.ok_or(ProgramError::...)?\` or \`.map_err(|_| ...)?\`.`,
        suggestion: `Replace \`.${methodName}(...)\` with explicit error handling: \`.ok_or(ProgramError::InvalidArgument)?\` (Option) or \`.map_err(|_| ProgramError::InvalidAccountData)?\` (Result).`,
        code_snippet: snippet(ctx.source, node, 80),
      });
    },
  },
};
