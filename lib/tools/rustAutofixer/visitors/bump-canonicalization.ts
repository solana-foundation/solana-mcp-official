import type Parser from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { walk } from "../walk.js";
import { getCallName } from "../walk.js";
import { findEnclosingFunctionBody, getMacroName } from "./_helpers.js";

type Node = Parser.SyntaxNode;

const PDA_DERIVATION_FNS = new Set(["find_program_address", "try_find_program_address", "create_program_address"]);
const VALIDATE_FNS = new Set(["validate_pda", "verify_pda", "check_pda"]);
const ASSERT_MACROS = new Set(["assert_eq", "assert_ne", "debug_assert_eq", "debug_assert_ne"]);

function extractBumpBindingFromLet(letNode: Node, derivationCall: Node): string | null {
  const value = letNode.childForFieldName("value");
  if (!value) return null;
  let contains = false;
  walk(value, n => {
    if (contains) return "skip";
    if (n.startIndex === derivationCall.startIndex && n.endIndex === derivationCall.endIndex) contains = true;
  });
  if (!contains) return null;
  const pattern = letNode.childForFieldName("pattern");
  if (!pattern || pattern.type !== "tuple_pattern") return null;
  // (_pda, bump) — second binding holds the bump.
  if (pattern.namedChildCount < 2) return null;
  const second = pattern.namedChild(1);
  if (second?.type === "identifier") return second.text;
  return null;
}

function findEnclosingLet(node: Node): Node | null {
  let cursor: Node | null = node.parent;
  while (cursor) {
    if (cursor.type === "let_declaration") return cursor;
    cursor = cursor.parent;
  }
  return null;
}

function scopeComparesBumpToStored(scope: Node, bumpVar: string): boolean {
  let found = false;
  walk(scope, n => {
    if (found) return "skip";
    if (n.type === "binary_expression") {
      const op = n.childForFieldName("operator")?.text;
      if (op !== "==" && op !== "!=") return;
      const left = n.childForFieldName("left");
      const right = n.childForFieldName("right");
      if (!left || !right) return;
      if (left.text === bumpVar || right.text === bumpVar) found = true;
    } else if (n.type === "macro_invocation") {
      const m = getMacroName(n);
      if (!m || !ASSERT_MACROS.has(m)) return;
      let mentions = false;
      walk(n, c => {
        if (mentions) return "skip";
        if (c.type === "identifier" && c.text === bumpVar) mentions = true;
      });
      if (mentions) found = true;
    } else if (n.type === "call_expression") {
      const fn = n.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      if (name && VALIDATE_FNS.has(name)) found = true;
    }
  });
  return found;
}

export const bumpCanonicalization: Visitor = {
  name: "bump-canonicalization",
  severity: "high",
  appliesTo: ["pinocchio"],
  enter: {
    call_expression(node, ctx) {
      const fn = node.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      if (!name || !PDA_DERIVATION_FNS.has(name)) return;
      const letNode = findEnclosingLet(node);
      if (!letNode) return;
      const bumpVar = extractBumpBindingFromLet(letNode, node);
      if (!bumpVar) return;
      if (bumpVar.startsWith("_")) return; // intentionally discarded
      const scope = findEnclosingFunctionBody(node);
      if (!scope) return;
      if (scopeComparesBumpToStored(scope, bumpVar)) return;
      ctx.output.issues.push({
        severity: "high",
        rule: "bump-canonicalization",
        title: `Bump ${bumpVar} re-derived without canonical check`,
        location: formatLocation(ctx.filename, node),
        description: `\`${name}\` returns a bump bound to \`${bumpVar}\` but that bump is never compared to a stored canonical bump (via \`==\`, \`assert_eq!\`, or \`validate_pda\`). An attacker can submit a non-canonical bump and still derive a colliding PDA.`,
        suggestion: `Store the canonical bump in the account at creation, then verify \`${bumpVar} == state.bump\` (or call \`validate_pda(account, &crate::ID, expected_bump)\`) before trusting it.`,
      });
    },
  },
};
