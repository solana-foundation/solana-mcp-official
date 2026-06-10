import type { Node } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { ctxAccountsField, findFieldsForHandlerContext, isInsideProgramModule } from "./_anchor-helpers.js";
import { walk } from "../walk.js";

const CPI_CONTEXT_CTORS = new Set(["new", "new_with_signer"]);

// Field types that carry a verified program identity (Anchor enforces the program ID at deserialize).
const TYPED_PROGRAM_TYPES = new Set(["Program", "Interface"]);

// Field types that don't enforce program identity on their own.
const UNTYPED_PROGRAM_TYPES = new Set(["AccountInfo", "UncheckedAccount"]);

function isCpiContextCall(call: Node): boolean {
  const fn = call.childForFieldName("function");
  if (!fn) return false;
  if (fn.type !== "scoped_identifier") return false;
  // scoped_identifier { "CpiContext", "::", "new" }
  const head = fn.namedChild(0);
  if (head?.text !== "CpiContext") return false;
  const tail = fn.lastChild;
  return !!tail && CPI_CONTEXT_CTORS.has(tail.text);
}

function callArgsFirst(call: Node): Node | null {
  const args = call.childForFieldName("arguments");
  if (!args) return null;
  return args.namedChild(0);
}

function unwrapAccountInfoCall(arg: Node): Node | null {
  if (arg.type !== "call_expression") return arg;
  const fn = arg.childForFieldName("function");
  if (!fn || fn.type !== "field_expression") return null;
  const method = fn.childForFieldName("field");
  if (method?.text !== "to_account_info") return null;
  return fn.childForFieldName("value");
}

function findEnclosingFunctionBody(node: Node): Node | null {
  let cursor: Node | null = node.parent;
  while (cursor) {
    if (cursor.type === "function_item") return cursor.childForFieldName("body");
    cursor = cursor.parent;
  }
  return null;
}

function localBindingValueBefore(scope: Node, name: string, beforeIndex: number): Node | null {
  let result: Node | null = null;
  walk(scope, n => {
    if (result) return "skip";
    if (n.startIndex >= beforeIndex) return "skip";
    if (n.type !== "let_declaration") return;
    const pattern = n.childForFieldName("pattern");
    const value = n.childForFieldName("value");
    if (pattern?.type === "identifier" && pattern.text === name && value) {
      result = value;
      return "skip";
    }
  });
  return result;
}

function resolveProgramTarget(arg: Node, scope: Node, beforeIndex: number, seen = new Set<string>()): Node | null {
  const unwrapped = unwrapAccountInfoCall(arg);
  if (!unwrapped) return null;
  if (unwrapped.type !== "identifier") return unwrapped;
  if (seen.has(unwrapped.text)) return unwrapped;
  seen.add(unwrapped.text);
  const bound = localBindingValueBefore(scope, unwrapped.text, beforeIndex);
  return bound ? resolveProgramTarget(bound, scope, beforeIndex, seen) : unwrapped;
}

function programArgUsesHardcodedId(arg: Node): boolean {
  let found = false;
  walk(arg, n => {
    if (found) return "skip";
    if (n.type !== "scoped_identifier") return;
    let last: Node | null = null;
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i);
      if (c) last = c;
    }
    if (last && (last.text === "ID" || last.text === "id")) found = true;
  });
  return found;
}

export const anchorCpiContextUnverified: Visitor = {
  name: "anchor-cpi-context-unverified",
  severity: "high",
  appliesTo: ["anchor"],
  enter: {
    call_expression(node, ctx) {
      if (!isInsideProgramModule(node, ctx.anchor.programModule)) return;
      if (!isCpiContextCall(node)) return;
      const first = callArgsFirst(node);
      if (!first) return;
      if (programArgUsesHardcodedId(first)) return;
      const scope = findEnclosingFunctionBody(node);
      if (!scope) return;
      const target = resolveProgramTarget(first, scope, node.startIndex);
      if (!target) return;
      const field = ctxAccountsField(target);
      if (!field) return;
      const candidates = findFieldsForHandlerContext(ctx.anchor, node, field);
      if (candidates.length === 0) return;
      // Fire when EVERY candidate field is untyped (AccountInfo / UncheckedAccount).
      // If any candidate uses a typed program wrapper (Program / Interface), assume the program identity is enforced.
      const allUntyped = candidates.every(
        f => f.typeIdentifier !== null && UNTYPED_PROGRAM_TYPES.has(f.typeIdentifier),
      );
      const someTyped = candidates.some(f => f.typeIdentifier !== null && TYPED_PROGRAM_TYPES.has(f.typeIdentifier));
      if (someTyped || !allUntyped) return;
      // `address =` / `owner =` / `executable` constraints pin the program identity even on untyped wrappers.
      const anyConstrained = candidates.some(
        f =>
          f.attribute?.kvPairs.has("address") ||
          f.attribute?.kvPairs.has("owner") ||
          f.attribute?.keywords.has("executable"),
      );
      if (anyConstrained) return;
      const fn = node.childForFieldName("function");
      const tail = fn?.lastChild?.text ?? "new";
      ctx.output.issues.push({
        severity: "high",
        rule: "anchor-cpi-context-unverified",
        title: `CpiContext::${tail} uses untyped program account ${field}`,
        location: formatLocation(ctx.filename, node),
        description: `\`CpiContext::${tail}\` is called with \`ctx.accounts.${field}.to_account_info()\` but \`${field}\` is typed as \`AccountInfo\` / \`UncheckedAccount\`. The Anchor runtime cannot verify the program ID before invoking the CPI — an attacker can swap in a malicious program.`,
        suggestion: `Change the \`${field}\` field type to \`Program<'info, T>\` (or \`Interface<'info, T>\` for Token-2022 compatible APIs), so Anchor enforces the program ID on deserialize.`,
      });
    },
  },
};
