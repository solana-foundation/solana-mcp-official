import type Parser from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { walk } from "../walk.js";
import { getCallName } from "../walk.js";
import { getMethodCallName } from "./_helpers.js";

type Node = Parser.SyntaxNode;

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

function findIfWithLamportsCheck(scope: Node): Node | null {
  let result: Node | null = null;
  walk(scope, n => {
    if (result) return "skip";
    if (n.type !== "if_expression") return;
    let hasLamports = false;
    walk(n.childForFieldName("condition") ?? n, c => {
      if (hasLamports) return "skip";
      if (c.type === "call_expression" && getMethodCallName(c) === "lamports") hasLamports = true;
    });
    if (hasLamports) result = n;
  });
  return result;
}

export const existingLamports: Visitor = {
  name: "existing-lamports",
  severity: "medium",
  appliesTo: ["pinocchio"],
  enter: {
    function_item(node, ctx) {
      const body = node.childForFieldName("body");
      if (!body) return;
      const ifNode = findIfWithLamportsCheck(body);
      if (!ifNode) return;
      const consequence = ifNode.childForFieldName("consequence");
      if (!consequence) return;
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
