import type Parser from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { walk } from "../walk.js";
import { findEnclosingFunctionBody, getMethodCallName, rootIdentifierOf } from "./_helpers.js";

type Node = Parser.SyntaxNode;

function isCreateAccountStruct(node: Node): boolean {
  if (node.type !== "struct_expression") return false;
  const typeId = node.namedChild(0);
  if (!typeId) return false;
  // type_identifier "CreateAccount" or scoped_identifier ending in CreateAccount
  if (typeId.type === "type_identifier") return typeId.text === "CreateAccount";
  if (typeId.type === "scoped_type_identifier" || typeId.type === "scoped_identifier") {
    const last = typeId.namedChild(typeId.namedChildCount - 1);
    return last?.text === "CreateAccount";
  }
  return false;
}

function getFieldInitValue(struct: Node, fieldName: string): Node | null {
  const list = struct.namedChild(1);
  if (!list || list.type !== "field_initializer_list") return null;
  for (let i = 0; i < list.namedChildCount; i++) {
    const init = list.namedChild(i);
    if (!init || init.type !== "field_initializer") continue;
    const name = init.namedChild(0);
    if (name?.text === fieldName) return init.namedChild(init.namedChildCount - 1);
  }
  return null;
}

function isZeroLiteral(node: Node | null): boolean {
  return node?.type === "integer_literal" && node.text === "0";
}

function lamportsReceiverRoot(node: Node): string | null {
  if (node.type !== "call_expression") return null;
  if (getMethodCallName(node) !== "lamports") return null;
  const fn = node.childForFieldName("function");
  if (!fn || fn.type !== "field_expression") return null;
  const value = fn.childForFieldName("value");
  return value ? rootIdentifierOf(value) : null;
}

function comparisonChecksExistingTarget(node: Node, target: string): boolean {
  if (node.type !== "binary_expression") return false;
  const op = node.childForFieldName("operator")?.text;
  if (op !== ">" && op !== "==" && op !== "!=") return false;
  const left = node.childForFieldName("left");
  const right = node.childForFieldName("right");
  if (!left || !right) return false;
  const leftRoot = lamportsReceiverRoot(left);
  const rightRoot = lamportsReceiverRoot(right);
  if (leftRoot === target && isZeroLiteral(right)) return true;
  return rightRoot === target && isZeroLiteral(left);
}

function scopeChecksExistingLamports(scope: Node, beforeIndex: number, target: string): boolean {
  let found = false;
  walk(scope, n => {
    if (found) return "skip";
    if (n.startIndex >= beforeIndex) return "skip";
    if (comparisonChecksExistingTarget(n, target)) {
      found = true;
      return "skip";
    }
  });
  return found;
}

export const reinitialization: Visitor = {
  name: "reinitialization",
  severity: "critical",
  appliesTo: ["pinocchio"],
  enter: {
    struct_expression(node, ctx) {
      if (!isCreateAccountStruct(node)) return;
      const scope = findEnclosingFunctionBody(node);
      if (!scope) return;
      const to = getFieldInitValue(node, "to");
      const target = to ? rootIdentifierOf(to) : null;
      if (target && scopeChecksExistingLamports(scope, node.startIndex, target)) return;
      ctx.output.issues.push({
        severity: "critical",
        rule: "reinitialization",
        title: `CreateAccount used without checking existing lamports`,
        location: formatLocation(ctx.filename, node),
        description: `\`CreateAccount\` in this function is invoked without a preceding check that the target account doesn't already exist (e.g. \`pda_account.lamports() > 0\`). An attacker can pre-fund the PDA to make creation fail, or worse, re-initialise an already-initialised account if the program doesn't guard against it.`,
        suggestion: `Before invoking CreateAccount, guard with \`if pda_account.lamports() > 0 { return Err(ProgramError::AccountAlreadyInitialized); }\` (or use the idempotent allocate+assign pattern).`,
      });
    },
  },
};
