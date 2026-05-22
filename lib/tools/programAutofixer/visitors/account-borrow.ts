import type { Node } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { walk } from "../walk.js";
import { findEnclosingFunctionBody, getMethodCallName, getMethodReceiverRoot } from "./_helpers.js";

const BORROW_METHODS = new Set(["try_borrow_mut", "try_borrow_mut_data", "borrow_mut"]);

/**
 * Conservative double-mut-borrow detection: if a function body has two or more
 * `*.try_borrow_mut*()` calls with the same receiver and no intervening `drop()`,
 * flag.
 */
function findMutBorrowsByReceiver(body: Node): Map<string, Node[]> {
  const out = new Map<string, Node[]>();
  walk(body, n => {
    if (n.type === "function_item") return "skip";
    if (n.type !== "call_expression") return;
    const name = getMethodCallName(n);
    if (!name || !BORROW_METHODS.has(name)) return;
    const root = getMethodReceiverRoot(n);
    if (!root) return;
    const list = out.get(root) ?? [];
    list.push(n);
    out.set(root, list);
  });
  return out;
}

function hasDropBetween(scope: Node, first: Node, second: Node): boolean {
  let found = false;
  walk(scope, n => {
    if (found) return "skip";
    if (n.type === "function_item") return "skip";
    if (n.startIndex <= first.endIndex) return;
    if (n.startIndex >= second.startIndex) return "skip";
    if (n.type !== "call_expression") return;
    const fn = n.childForFieldName("function");
    if (fn?.text === "drop") found = true;
  });
  return found;
}

export const accountBorrow: Visitor = {
  name: "account-borrow",
  severity: "low",
  appliesTo: ["pinocchio", "anchor"],
  enter: {
    function_item(node, ctx) {
      const body = node.childForFieldName("body");
      if (!body) return;
      const borrows = findMutBorrowsByReceiver(body);
      const scope = findEnclosingFunctionBody(node) ?? body;
      for (const [account, calls] of borrows) {
        if (calls.length < 2) continue;
        for (let i = 1; i < calls.length; i++) {
          const prev = calls[i - 1];
          const cur = calls[i];
          if (hasDropBetween(scope, prev, cur)) continue;
          ctx.output.issues.push({
            severity: "low",
            rule: "account-borrow",
            title: `Repeated mutable borrow of ${account} without drop`,
            location: formatLocation(ctx.filename, cur),
            description: `\`${account}\` is mutably borrowed twice within the same function without an explicit \`drop(...)\` between borrows. The runtime will panic on the second borrow.`,
            suggestion: `Scope the first borrow inside a block so it drops before the second borrow, or call \`drop(borrow_handle);\` explicitly.`,
          });
        }
      }
    },
  },
};
