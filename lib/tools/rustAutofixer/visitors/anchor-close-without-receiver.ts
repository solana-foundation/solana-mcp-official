import type Parser from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { collectCtxAccountsAccesses, findFieldsForHandlerContext, isInsideProgramModule } from "./_anchor-helpers.js";

type Node = Parser.SyntaxNode;

function isZeroLiteral(node: Node): boolean {
  if (node.type === "integer_literal") return node.text === "0";
  if (node.type === "parenthesized_expression") {
    const inner = node.namedChild(0);
    return inner ? isZeroLiteral(inner) : false;
  }
  return false;
}

function lhsTouchesLamports(left: Node): boolean {
  let found = false;
  const cursor = left.walk();
  const visit = (): void => {
    const n = cursor.currentNode();
    if (found) return;
    if (n.type === "field_identifier" && n.text === "lamports") found = true;
    if (n.type === "identifier" && n.text === "lamports") found = true;
    if (!found && cursor.gotoFirstChild()) {
      do {
        visit();
      } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
  };
  visit();
  cursor.delete();
  return found;
}

export const anchorCloseWithoutReceiver: Visitor = {
  name: "anchor-close-without-receiver",
  severity: "critical",
  appliesTo: ["anchor"],
  enter: {
    assignment_expression(node, ctx) {
      if (!isInsideProgramModule(node, ctx.anchor.programModule)) return;
      const left = node.childForFieldName("left");
      const right = node.childForFieldName("right");
      if (!left || !right) return;
      if (!isZeroLiteral(right)) return;
      if (!lhsTouchesLamports(left)) return;
      // Find ctx.accounts.X mentions inside the LHS chain (or its statement neighborhood) to identify the account.
      const fields = collectCtxAccountsAccesses(left);
      if (fields.size === 0) return;
      for (const fieldName of fields) {
        const candidates = findFieldsForHandlerContext(ctx.anchor, node, fieldName);
        if (candidates.length === 0) continue;
        const hasClose = candidates.some(f => f.attribute?.kvPairs.has("close"));
        if (hasClose) continue;
        ctx.output.issues.push({
          severity: "critical",
          rule: "anchor-close-without-receiver",
          title: `Manual lamport drain on ${fieldName} without \`close = ...\` constraint`,
          location: formatLocation(ctx.filename, node),
          description: `\`ctx.accounts.${fieldName}\` is having its lamports set to 0 in a handler, but the Accounts struct doesn't declare \`#[account(close = <receiver>)]\` for this field. Without \`close\`, Anchor won't reassign the account to the system program and zero its data buffer — the account remains usable in the same transaction (reload attack).`,
          suggestion: `Add \`close = <receiver>\` to the \`#[account(...)]\` attribute on \`${fieldName}\` (where \`<receiver>\` is the account that absorbs the lamports). Drop the manual lamport-drain code — Anchor handles closure correctly when the constraint is declared.`,
        });
      }
    },
  },
};
