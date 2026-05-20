import type { Node, Tree } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { walk } from "../walk.js";
import { getCallName } from "../walk.js";
import { getCallArgs, rootIdentifierOf } from "./_helpers.js";

const WRITABLE_VERIFY_CALLS = new Set(["verify_writable"]);
const MUTATING_METHODS = new Set([
  "set_lamports",
  "data_mut",
  "try_borrow_mut_data",
  "try_borrow_mut",
  "realloc",
  "assign",
  "close",
  "from_bytes_mut",
  "load_mut",
]);

function collectWritableArgs(body: Node): string[] {
  const out: string[] = [];
  walk(body, n => {
    if (n.type !== "call_expression") return;
    const fn = n.childForFieldName("function");
    const name = fn ? getCallName(fn) : null;
    if (!name || !WRITABLE_VERIFY_CALLS.has(name)) return;
    const args = getCallArgs(n);
    if (args.length === 0) return;
    const root = rootIdentifierOf(args[0]);
    if (root) out.push(root);
  });
  return out;
}

function chainMentions(node: Node, target: string): boolean {
  let mentions = false;
  walk(node, n => {
    if (mentions) return "skip";
    if ((n.type === "identifier" || n.type === "field_identifier") && n.text === target) {
      mentions = true;
      return "skip";
    }
  });
  return mentions;
}

function moduleMutatesAccount(tree: Tree, target: string): boolean {
  let mutated = false;
  walk(tree.rootNode, n => {
    if (mutated) return "skip";
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function");
      if (fn?.type === "field_expression") {
        const field = fn.childForFieldName("field") ?? fn.lastChild;
        const value = fn.childForFieldName("value");
        if (field && value && MUTATING_METHODS.has(field.text)) {
          if (rootIdentifierOf(value) === target || chainMentions(value, target)) mutated = true;
        }
      }
    } else if (n.type === "assignment_expression") {
      const left = n.childForFieldName("left");
      if (left) {
        if (rootIdentifierOf(left) === target || chainMentions(left, target)) mutated = true;
      }
    }
  });
  return mutated;
}

export const writableMutation: Visitor = {
  name: "writable-mutation",
  severity: "low",
  appliesTo: ["pinocchio"],
  after(ctx) {
    // Look at every `verify_writable(<account>, ...)` call across all try_from bodies.
    // For each, confirm the same account is actually mutated somewhere in the file.
    // Note: this is intentionally a *file-level* scan; cross-module mutation is out of scope.
    for (const { body, implName } of ctx.tryFromBodies) {
      const writableArgs = collectWritableArgs(body);
      for (const account of writableArgs) {
        // Build a fresh sub-tree walk against the entire file source via the body's root.
        let root: Node = body;
        while (root.parent) root = root.parent;
        if (moduleMutatesAccount(root.tree, account)) continue;
        ctx.output.issues.push({
          severity: "low",
          rule: "writable-mutation",
          title: `Account ${account} marked writable but never mutated`,
          location: formatLocation(ctx.filename, body),
          description: `\`${implName}::try_from\` calls \`verify_writable(${account}, ...)\` but the file never mutates \`${account}\` (no \`set_lamports\`, \`data_mut\`, \`assign\`, \`realloc\`, \`close\`, or assignment via \`${account}.*\`). Mark it readonly to save compute and reduce attack surface.`,
          suggestion: `If \`${account}\` is only read, change to \`verify_readonly(${account})?;\` and remove the writable marker from the instruction docs.`,
        });
      }
    }
  },
};
