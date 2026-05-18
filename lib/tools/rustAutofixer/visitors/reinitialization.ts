import type Parser from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { walk } from "../walk.js";
import { findEnclosingFunctionBody, getMethodCallName } from "./_helpers.js";

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

function scopeChecksExistingLamports(scope: Node): boolean {
  let found = false;
  walk(scope, n => {
    if (found) return "skip";
    if (n.type === "binary_expression") {
      const op = n.childForFieldName("operator")?.text;
      if (op !== ">" && op !== "==" && op !== "!=" && op !== "<" && op !== ">=" && op !== "<=") return;
      const left = n.childForFieldName("left");
      if (!left) return;
      // Looking for `account.lamports() > 0` shape on either side.
      if (left.type === "call_expression" && getMethodCallName(left) === "lamports") {
        found = true;
        return "skip";
      }
      const right = n.childForFieldName("right");
      if (right?.type === "call_expression" && getMethodCallName(right) === "lamports") {
        found = true;
        return "skip";
      }
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
      if (scopeChecksExistingLamports(scope)) return;
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
