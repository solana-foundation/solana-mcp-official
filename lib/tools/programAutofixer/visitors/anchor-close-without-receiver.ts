import type { Node } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import {
  collectCtxAccountsAccesses,
  ctxAccountsField,
  findFieldsForHandlerContext,
  isInsideProgramModule,
} from "./_anchor-helpers.js";
import { findEnclosingFunctionBody, getMethodCallName } from "./_helpers.js";
import { findFirst, walk } from "../walk.js";

function isZeroLiteral(node: Node): boolean {
  if (node.type === "integer_literal") return node.text === "0";
  if (node.type === "parenthesized_expression") {
    const inner = node.namedChild(0);
    return inner ? isZeroLiteral(inner) : false;
  }
  return false;
}

function containsMethodCall(root: Node, methodName: string): boolean {
  let found = false;
  walk(root, n => {
    if (found) return "skip";
    if (n.type === "call_expression" && getMethodCallName(n) === methodName) {
      found = true;
      return "skip";
    }
  });
  return found;
}

function containsLamportsField(root: Node): boolean {
  let found = false;
  walk(root, n => {
    if (found) return "skip";
    if ((n.type === "field_identifier" || n.type === "identifier") && n.text === "lamports") {
      found = true;
      return "skip";
    }
  });
  return found;
}

// Only the AccountInfo lamports API counts — a plain `ctx.accounts.x.lamports`
// field access on `Account<T>` is Borsh state, not a lamport drain.
function lhsDrainsLamportsViaAccountInfo(left: Node): boolean {
  if (containsMethodCall(left, "try_borrow_mut_lamports")) return true;
  if (!containsLamportsField(left)) return false;
  return containsMethodCall(left, "to_account_info") || containsMethodCall(left, "borrow_mut");
}

function letBindingMentionsField(body: Node, name: string, fieldName: string): boolean {
  let found = false;
  walk(body, n => {
    if (found) return "skip";
    if (n.type !== "let_declaration") return;
    const pattern = n.childForFieldName("pattern");
    const bound = pattern ? findFirst(pattern, x => x.type === "identifier")?.text : null;
    if (bound !== name) return;
    const value = n.childForFieldName("value");
    if (value && collectCtxAccountsAccesses(value).has(fieldName)) found = true;
  });
  return found;
}

function bodyManuallyClosesAccount(body: Node, fieldName: string): boolean {
  let found = false;
  walk(body, n => {
    if (found) return "skip";
    if (n.type !== "call_expression") return;
    const method = getMethodCallName(n);
    if (method !== "assign" && method !== "realloc") return;
    const fn = n.childForFieldName("function");
    const receiver = fn?.childForFieldName("value");
    if (!receiver) return;
    if (ctxAccountsField(receiver) === fieldName) found = true;
    else if (receiver.type === "identifier" && letBindingMentionsField(body, receiver.text, fieldName)) found = true;
  });
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
      if (!lhsDrainsLamportsViaAccountInfo(left)) return;
      // Find ctx.accounts.X mentions inside the LHS chain (or its statement neighborhood) to identify the account.
      const fields = collectCtxAccountsAccesses(left);
      if (fields.size === 0) return;
      const body = findEnclosingFunctionBody(node);
      for (const fieldName of fields) {
        const candidates = findFieldsForHandlerContext(ctx.anchor, node, fieldName);
        if (candidates.length === 0) continue;
        const hasClose = candidates.some(f => f.attribute?.kvPairs.has("close"));
        if (hasClose) continue;
        if (body && bodyManuallyClosesAccount(body, fieldName)) continue;
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
