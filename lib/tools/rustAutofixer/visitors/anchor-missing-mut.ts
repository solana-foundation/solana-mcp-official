import type Parser from "web-tree-sitter";
import type { Visitor, VisitorContext } from "../types.js";
import { formatLocation } from "../types.js";
import { ctxAccountsField, findFieldsByName, isInsideProgramModule } from "./_anchor-helpers.js";
import { getMethodCallName } from "./_helpers.js";

type Node = Parser.SyntaxNode;

const MUTATING_METHODS = new Set([
  "set_lamports",
  "realloc",
  "assign",
  "close",
  "try_borrow_mut_data",
  "try_borrow_mut_lamports",
  "set_inner",
]);

interface MissingMutState {
  reported: Set<string>; // location keys to dedupe
}

function getState(ctx: VisitorContext): MissingMutState {
  const bag = ctx as unknown as { __anchorMissingMut?: MissingMutState };
  if (!bag.__anchorMissingMut) bag.__anchorMissingMut = { reported: new Set<string>() };
  return bag.__anchorMissingMut;
}

function emitIfFieldLacksMut(node: Node, fieldName: string, ctx: VisitorContext): void {
  const candidates = findFieldsByName(ctx.anchor.structs, fieldName);
  if (candidates.length === 0) return;
  // Conservative: only fire when EVERY matching field lacks `mut`. Avoids cross-struct ambiguity FPs.
  const anyMut = candidates.some(f => f.attribute?.keywords.has("mut"));
  if (anyMut) return;
  // `init` / `init_if_needed` / `close` implicitly grant mutability — Anchor doesn't require explicit `mut`.
  const anyImplicitMut = candidates.some(
    f =>
      f.attribute?.keywords.has("init") ||
      f.attribute?.keywords.has("init_if_needed") ||
      f.attribute?.kvPairs.has("close"),
  );
  if (anyImplicitMut) return;
  // Skip Signer / typed program fields — they're typically read-only by convention.
  const allReadOnlyByType = candidates.every(f => {
    const t = f.typeIdentifier;
    return t === "Signer" || t === "Program" || t === "Sysvar" || t === "Interface";
  });
  if (allReadOnlyByType) return;
  const location = formatLocation(ctx.filename, node);
  const state = getState(ctx);
  const dedupeKey = `${fieldName}|${location}`;
  if (state.reported.has(dedupeKey)) return;
  state.reported.add(dedupeKey);
  ctx.output.issues.push({
    severity: "high",
    rule: "anchor-missing-mut",
    title: `Mutation of ctx.accounts.${fieldName} without \`mut\` constraint`,
    location,
    description: `\`ctx.accounts.${fieldName}\` is mutated inside a handler, but the matching field in the Accounts struct does not declare \`mut\` in its \`#[account(...)]\` attribute. Anchor will refuse the write at runtime — at best a hard error, at worst an inconsistency between declared writability and actual usage.`,
    suggestion: `Add \`mut\` to the \`#[account(...)]\` attribute on the \`${fieldName}\` field (e.g. \`#[account(mut)]\` or \`#[account(mut, ...)]\`).`,
  });
}

export const anchorMissingMut: Visitor = {
  name: "anchor-missing-mut",
  severity: "high",
  appliesTo: ["anchor"],
  enter: {
    assignment_expression(node, ctx) {
      if (!isInsideProgramModule(node, ctx.anchor.programModule)) return;
      const left = node.childForFieldName("left");
      if (!left) return;
      const field = ctxAccountsField(left);
      if (!field) return;
      emitIfFieldLacksMut(node, field, ctx);
    },
    compound_assignment_expr(node, ctx) {
      if (!isInsideProgramModule(node, ctx.anchor.programModule)) return;
      const left = node.childForFieldName("left");
      if (!left) return;
      const field = ctxAccountsField(left);
      if (!field) return;
      emitIfFieldLacksMut(node, field, ctx);
    },
    call_expression(node, ctx) {
      if (!isInsideProgramModule(node, ctx.anchor.programModule)) return;
      const method = getMethodCallName(node);
      if (!method || !MUTATING_METHODS.has(method)) return;
      const fn = node.childForFieldName("function");
      if (!fn || fn.type !== "field_expression") return;
      const receiver = fn.childForFieldName("value");
      if (!receiver) return;
      const field = ctxAccountsField(receiver);
      if (!field) return;
      emitIfFieldLacksMut(node, field, ctx);
    },
  },
};
