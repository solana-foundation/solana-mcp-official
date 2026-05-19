import type Parser from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { walk } from "../walk.js";
import { getCallName } from "../walk.js";
import { findEnclosingFunctionBody, getMethodCallName } from "./_helpers.js";

type Node = Parser.SyntaxNode;

const TRANSFER_STRUCT_TYPES = new Set(["TransferChecked", "Transfer", "Burn", "MintTo", "Approve"]);
const RELATIONSHIP_CHECK_FNS = new Set([
  "validate_associated_token_account",
  "verify_associated_token_account",
  "check_associated_token_account",
  "validate_token_account",
  "verify_token_account",
  "verify_mint",
]);

function isTransferishStruct(node: Node): { name: string } | null {
  if (node.type !== "struct_expression") return null;
  const head = node.namedChild(0);
  if (!head) return null;
  let tail: string | null = null;
  if (head.type === "type_identifier") tail = head.text;
  else if (head.type === "scoped_type_identifier" || head.type === "scoped_identifier") {
    const last = head.namedChild(head.namedChildCount - 1);
    tail = last?.text ?? null;
  }
  if (tail && TRANSFER_STRUCT_TYPES.has(tail)) return { name: tail };
  return null;
}

function scopeHasRelationshipCheck(scope: Node): boolean {
  let found = false;
  walk(scope, n => {
    if (found) return "skip";
    if (n.type !== "call_expression") return;
    const fn = n.childForFieldName("function");
    const callName = fn ? getCallName(fn) : null;
    if (callName && RELATIONSHIP_CHECK_FNS.has(callName)) {
      found = true;
      return "skip";
    }
    const methodName = getMethodCallName(n);
    if (methodName && RELATIONSHIP_CHECK_FNS.has(methodName)) {
      found = true;
      return "skip";
    }
  });
  return found;
}

export const accountRelationship: Visitor = {
  name: "account-relationship",
  severity: "medium",
  appliesTo: ["pinocchio"],
  enter: {
    struct_expression(node, ctx) {
      const info = isTransferishStruct(node);
      if (!info) return;
      const scope = findEnclosingFunctionBody(node);
      if (!scope) return;
      if (scopeHasRelationshipCheck(scope)) return;
      ctx.output.issues.push({
        severity: "medium",
        rule: "account-relationship",
        title: `${info.name} CPI without relationship validation`,
        location: formatLocation(ctx.filename, node),
        description: `\`${info.name}\` is invoked but no \`validate_associated_token_account\` / \`verify_token_account\` / \`verify_mint\` call appears in the same function. Token accounts must be tied to the expected wallet+mint; otherwise an attacker can supply an arbitrary mint and drain the wrong account.`,
        suggestion: `Before invoking ${info.name}, validate that the token account belongs to the expected wallet and mint via \`validate_associated_token_account(token_account, expected_wallet, expected_mint, token_program)?;\`.`,
      });
    },
  },
};
