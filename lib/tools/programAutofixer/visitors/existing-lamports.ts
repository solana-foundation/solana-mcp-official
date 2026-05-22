import type { Node } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { walk } from "../walk.js";
import { getCallName } from "../walk.js";
import { getMacroName, getMethodCallName, rootIdentifierOf } from "./_helpers.js";

/**
 * Idempotent account creation: if a function checks `lamports() > 0`, it must also
 * issue an `Allocate` + `Assign` (or `Transfer` to top up) inside the positive branch,
 * not silently skip creation. Flag when the lamports() > 0 branch lacks any of those.
 */
const FALLBACK_STRUCT_TYPES = new Set(["Allocate", "Assign", "Transfer"]);

function isFallbackStruct(node: Node): boolean {
  if (node.type !== "struct_expression") return false;
  const t = node.namedChild(0);
  if (!t) return false;
  if (t.type === "type_identifier") return FALLBACK_STRUCT_TYPES.has(t.text);
  if (t.type === "scoped_type_identifier" || t.type === "scoped_identifier") {
    const last = t.namedChild(t.namedChildCount - 1);
    return last ? FALLBACK_STRUCT_TYPES.has(last.text) : false;
  }
  return false;
}

function isIntegerLiteral(node: Node, value: string): boolean {
  return node.type === "integer_literal" && node.text.replaceAll("_", "") === value;
}

function lamportsReceiverRoot(node: Node): string | null {
  if (node.type !== "call_expression") return null;
  if (getMethodCallName(node) !== "lamports") return null;
  const fn = node.childForFieldName("function");
  if (!fn || fn.type !== "field_expression") return null;
  const value = fn.childForFieldName("value");
  return value ? rootIdentifierOf(value) : null;
}

function comparisonChecksExistingLamports(node: Node): boolean {
  if (node.type !== "binary_expression") return false;
  const op = node.childForFieldName("operator")?.text;
  if (!op) return false;
  const left = node.childForFieldName("left");
  const right = node.childForFieldName("right");
  if (!left || !right) return false;
  const leftLamports = lamportsReceiverRoot(left) !== null;
  const rightLamports = lamportsReceiverRoot(right) !== null;
  if (leftLamports === rightLamports) return false;
  const literal = leftLamports ? right : left;
  const lamportsOnLeft = leftLamports;
  if (isIntegerLiteral(literal, "0")) {
    if (op === "!=") return true;
    return lamportsOnLeft ? op === ">" : op === "<";
  }
  if (isIntegerLiteral(literal, "1")) {
    return lamportsOnLeft ? op === ">=" : op === "<=";
  }
  return false;
}

function findIfWithExistingLamportsCheck(scope: Node): Node | null {
  let result: Node | null = null;
  walk(scope, n => {
    if (result) return "skip";
    if (n.type !== "if_expression") return;
    let hasExistingLamportsCheck = false;
    walk(n.childForFieldName("condition") ?? n, c => {
      if (hasExistingLamportsCheck) return "skip";
      if (comparisonChecksExistingLamports(c)) {
        hasExistingLamportsCheck = true;
        return "skip";
      }
    });
    if (hasExistingLamportsCheck) result = n;
  });
  return result;
}

function nodeContainsErrorConstructor(node: Node): boolean {
  let found = false;
  walk(node, n => {
    if (found) return "skip";
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      if (name === "Err") {
        found = true;
        return "skip";
      }
    }
    if (n.type === "macro_invocation") {
      const name = getMacroName(n);
      if (name === "err") {
        found = true;
        return "skip";
      }
    }
  });
  return found;
}

function branchReturnsError(consequence: Node): boolean {
  let found = false;
  walk(consequence, n => {
    if (found) return "skip";
    if (n.type === "return_expression" && nodeContainsErrorConstructor(n)) {
      found = true;
      return "skip";
    }
  });
  return found;
}

export const existingLamports: Visitor = {
  name: "existing-lamports",
  severity: "medium",
  appliesTo: ["pinocchio"],
  enter: {
    function_item(node, ctx) {
      const body = node.childForFieldName("body");
      if (!body) return;
      const ifNode = findIfWithExistingLamportsCheck(body);
      if (!ifNode) return;
      const consequence = ifNode.childForFieldName("consequence");
      if (!consequence) return;
      if (branchReturnsError(consequence)) return;
      let hasFallback = false;
      walk(consequence, n => {
        if (hasFallback) return "skip";
        if (isFallbackStruct(n)) {
          hasFallback = true;
          return "skip";
        }
        if (n.type === "call_expression") {
          const fn = n.childForFieldName("function");
          const name = fn ? getCallName(fn) : null;
          if (name && (name === "create_pda_account_idempotent" || name === "allocate" || name === "assign")) {
            hasFallback = true;
            return "skip";
          }
        }
      });
      if (hasFallback) return;
      ctx.output.issues.push({
        severity: "medium",
        rule: "existing-lamports",
        title: `Idempotent branch lacks Allocate/Assign/Transfer handling`,
        location: formatLocation(ctx.filename, ifNode),
        description: `An \`if account.lamports() > 0 { ... }\` branch exists but doesn't run \`Allocate\` / \`Assign\` / \`Transfer\` (or call \`create_pda_account_idempotent\`). The function may fail when the PDA was pre-funded with rent — and may silently skip account creation entirely.`,
        suggestion: `Inside the positive branch, top up rent via \`Transfer\` then \`Allocate { space }.invoke_signed(&signers)?\` and \`Assign { owner }.invoke_signed(&signers)?\`. Or delegate to a shared \`create_pda_account_idempotent\` helper.`,
      });
    },
  },
};
