import type Parser from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { walk } from "../walk.js";
import { findEnclosingFunctionBody, getMethodCallName, getMethodReceiverRoot } from "./_helpers.js";

type Node = Parser.SyntaxNode;

function isLamportsZeroCall(node: Node): { receiver: string | null } | null {
  if (node.type !== "call_expression") return null;
  if (getMethodCallName(node) !== "set_lamports") return null;
  const args = node.childForFieldName("arguments");
  if (!args) return null;
  const first = args.namedChild(0);
  if (!first) return null;
  if (first.type !== "integer_literal" || first.text !== "0") return null;
  return { receiver: getMethodReceiverRoot(node) };
}

function scopeCallsCloseOn(scope: Node, target: string): boolean {
  let found = false;
  walk(scope, n => {
    if (found) return "skip";
    if (n.type !== "call_expression") return;
    if (getMethodCallName(n) !== "close") return;
    if (getMethodReceiverRoot(n) === target) found = true;
  });
  return found;
}

export const accountClosure: Visitor = {
  name: "account-closure",
  severity: "critical",
  appliesTo: ["pinocchio"],
  enter: {
    call_expression(node, ctx) {
      const info = isLamportsZeroCall(node);
      if (!info || !info.receiver) return;
      const scope = findEnclosingFunctionBody(node);
      if (!scope) return;
      if (scopeCallsCloseOn(scope, info.receiver)) return;
      ctx.output.issues.push({
        severity: "critical",
        rule: "account-closure",
        title: `Account ${info.receiver} drained without \`close()\``,
        location: formatLocation(ctx.filename, node),
        description: `\`${info.receiver}.set_lamports(0)\` is called but \`${info.receiver}.close()\` is never called in the same function. \`close()\` zeros the data buffer and reassigns the account to the system program; without it the closed account remains usable in the same transaction (reload attack).`,
        suggestion: `After draining lamports, call \`${info.receiver}.close()?;\` so the account is reset and reassigned to the system program.`,
      });
    },
  },
};
