import type { Node } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { walk } from "../walk.js";
import { getMethodCallName } from "./_helpers.js";

const BORROW_METHODS = new Set(["try_borrow_mut", "try_borrow_mut_data", "borrow_mut"]);

interface BorrowSite {
  call: Node;
  receiver: string;
}

function collectMutBorrows(body: Node): BorrowSite[] {
  const out: BorrowSite[] = [];
  walk(body, n => {
    if (n.type === "function_item") return "skip";
    if (n.type !== "call_expression") return;
    const name = getMethodCallName(n);
    if (!name || !BORROW_METHODS.has(name)) return;
    const fn = n.childForFieldName("function");
    const value = fn?.childForFieldName("value");
    if (!value) return;
    out.push({ call: n, receiver: value.text.replace(/\s+/g, "") });
  });
  return out;
}

function enclosingLetDeclaration(call: Node, body: Node): Node | null {
  let cursor: Node | null = call.parent;
  while (cursor && cursor.id !== body.id) {
    if (cursor.type === "let_declaration") return cursor;
    if (cursor.type === "function_item" || cursor.type === "closure_expression") return null;
    cursor = cursor.parent;
  }
  return null;
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

function bindingStillLiveAt(earlier: BorrowSite, later: BorrowSite, body: Node): boolean {
  const letDecl = enclosingLetDeclaration(earlier.call, body);
  if (!letDecl) return false;
  const block = letDecl.parent;
  if (!block) return false;
  return later.call.startIndex > letDecl.endIndex && later.call.endIndex <= block.endIndex;
}

export const accountBorrow: Visitor = {
  name: "account-borrow",
  severity: "low",
  appliesTo: ["pinocchio", "anchor"],
  enter: {
    function_item(node, ctx) {
      const body = node.childForFieldName("body");
      if (!body) return;
      const sites = collectMutBorrows(body);
      const byReceiver = new Map<string, BorrowSite[]>();
      for (const site of sites) {
        const list = byReceiver.get(site.receiver) ?? [];
        list.push(site);
        byReceiver.set(site.receiver, list);
      }
      for (const [receiver, group] of byReceiver) {
        if (group.length < 2) continue;
        for (let j = 1; j < group.length; j++) {
          for (let i = 0; i < j; i++) {
            if (!bindingStillLiveAt(group[i], group[j], body)) continue;
            if (hasDropBetween(body, group[i].call, group[j].call)) continue;
            ctx.output.issues.push({
              severity: "low",
              rule: "account-borrow",
              title: `Repeated mutable borrow of ${receiver} without drop`,
              location: formatLocation(ctx.filename, group[j].call),
              description: `\`${receiver}\` is mutably borrowed again while an earlier \`let\`-bound borrow is still live in the same scope, with no \`drop(...)\` between borrows. The runtime will panic on the second borrow.`,
              suggestion: `Scope the first borrow inside a block so it drops before the second borrow, or call \`drop(borrow_handle);\` explicitly.`,
            });
            break;
          }
        }
      }
    },
  },
};
