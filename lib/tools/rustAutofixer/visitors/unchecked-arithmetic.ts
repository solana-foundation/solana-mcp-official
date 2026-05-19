import type Parser from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation, snippet } from "../types.js";
import { walk } from "../walk.js";
import { CHECKED_ARITHMETIC_METHODS } from "./_helpers.js";

type Node = Parser.SyntaxNode;

const RISKY_OPS = new Set(["+", "-", "*"]);
const COMPOUND_OPS = new Set(["+=", "-=", "*="]);

const BALANCE_NAMES = new Set([
  "amount",
  "balance",
  "lamports",
  "tokens",
  "value",
  "total",
  "fee",
  "supply",
  "deposit",
  "withdraw",
  "transfer_amount",
  "reward",
  "stake",
]);

const BALANCE_ROOTS = [
  "amount",
  "balance",
  "lamport",
  "token",
  "supply",
  "fee",
  "stake",
  "reward",
  "deposit",
  "withdraw",
];

function nameLooksLikeBalance(name: string): boolean {
  const lower = name.toLowerCase();
  if (BALANCE_NAMES.has(lower)) return true;
  const tokens = lower.split("_");
  for (const tok of tokens) {
    const stripped = tok.endsWith("s") ? tok.slice(0, -1) : tok;
    if (BALANCE_ROOTS.includes(stripped)) return true;
  }
  return false;
}

function exprMentionsBalance(node: Node): boolean {
  let hit = false;
  walk(node, n => {
    if (hit) return "skip";
    if ((n.type === "identifier" || n.type === "field_identifier") && nameLooksLikeBalance(n.text)) {
      hit = true;
    }
  });
  return hit;
}

function enclosingFunctionMentionsBalance(node: Node): boolean {
  let cursor: Node | null = node.parent;
  while (cursor) {
    if (cursor.type === "function_item") {
      const nameNode = cursor.childForFieldName("name");
      if (nameNode && nameLooksLikeBalance(nameNode.text)) return true;
      return false;
    }
    cursor = cursor.parent;
  }
  return false;
}

function getOperator(binaryNode: Node): string | null {
  return binaryNode.childForFieldName("operator")?.text ?? null;
}

function isLiteralOnly(node: Node): boolean {
  if (node.type === "integer_literal" || node.type === "float_literal") return true;
  if (node.type === "parenthesized_expression") {
    const inner = node.namedChild(0);
    return inner ? isLiteralOnly(inner) : false;
  }
  return false;
}

function isInsideCheckedCall(node: Node, maxDepth = 4): boolean {
  let cursor: Node | null = node.parent;
  let depth = 0;
  while (cursor && depth < maxDepth) {
    if (cursor.type === "call_expression") {
      const fn = cursor.childForFieldName("function");
      if (fn) {
        const name =
          fn.type === "field_expression"
            ? (fn.childForFieldName("field") ?? fn.lastChild)?.text
            : (fn.lastChild?.text ?? fn.text);
        if (name && CHECKED_ARITHMETIC_METHODS.has(name)) return true;
      }
    }
    cursor = cursor.parent;
    depth++;
  }
  return false;
}

function handleArithmetic(node: Node, ctx: import("../types.js").VisitorContext): void {
  const op = getOperator(node);
  if (!op) return;
  const baseOp = op.endsWith("=") ? op.slice(0, -1) : op;
  const isCompound = COMPOUND_OPS.has(op);
  if (!isCompound && !RISKY_OPS.has(baseOp)) return;
  const left = node.childForFieldName("left");
  const right = node.childForFieldName("right");
  if (!left || !right) return;
  if (isLiteralOnly(left) && isLiteralOnly(right)) return;
  if (isInsideCheckedCall(node)) return;

  const leftLooksBalance = exprMentionsBalance(left);
  const rightLooksBalance = exprMentionsBalance(right);
  const enclosingMentionsBalance = enclosingFunctionMentionsBalance(node);
  if (!leftLooksBalance && !rightLooksBalance && !enclosingMentionsBalance) return;

  const opName = baseOp === "+" ? "add" : baseOp === "-" ? "sub" : "mul";
  ctx.output.issues.push({
    severity: "medium",
    rule: "unchecked-arithmetic",
    title: `Unchecked integer ${opName}`,
    location: formatLocation(ctx.filename, node),
    description: `Plain \`${baseOp}\` on a balance-shaped value panics on overflow in debug and wraps silently in release. For balance / amount math this is exploitable.`,
    suggestion: `Use \`.checked_${opName}(...).ok_or(ProgramError::ArithmeticOverflow)?\` or \`saturating_${opName}\` if saturation is intended.`,
    code_snippet: snippet(ctx.source, node, 80),
  });
}

export const uncheckedArithmetic: Visitor = {
  name: "unchecked-arithmetic",
  severity: "medium",
  appliesTo: ["pinocchio", "anchor"],
  enter: {
    binary_expression: handleArithmetic,
    compound_assignment_expr: handleArithmetic,
  },
};
