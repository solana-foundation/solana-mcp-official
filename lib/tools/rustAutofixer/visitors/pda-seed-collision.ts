import type { Node } from "web-tree-sitter";
import type { Visitor, VisitorContext } from "../types.js";
import { formatLocation } from "../types.js";

interface PrefixEntry {
  ownerType: string;
  prefix: string;
  node: Node;
}

interface PrefixState {
  entries: PrefixEntry[];
}

function getState(ctx: VisitorContext): PrefixState {
  const bag = ctx as unknown as { __pdaSeed?: PrefixState };
  if (!bag.__pdaSeed) bag.__pdaSeed = { entries: [] };
  return bag.__pdaSeed;
}

function findEnclosingImplTarget(node: Node): string | null {
  let cursor: Node | null = node.parent;
  while (cursor) {
    if (cursor.type === "impl_item") {
      const target = cursor.childForFieldName("type");
      return target?.text ?? null;
    }
    cursor = cursor.parent;
  }
  return null;
}

function findConstName(node: Node): string | null {
  const named = node.childForFieldName("name");
  if (named) return named.text;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c?.type === "identifier") return c.text;
  }
  return null;
}

function findConstValueText(node: Node): string | null {
  const valueNode = node.childForFieldName("value");
  if (valueNode) return valueNode.text;
  const last = node.namedChild(node.namedChildCount - 1);
  return last?.text ?? null;
}

export const pdaSeedCollision: Visitor = {
  name: "pda-seed-collision",
  severity: "high",
  appliesTo: ["pinocchio"],
  enter: {
    const_item(node, ctx) {
      const name = findConstName(node);
      if (name !== "PREFIX" && name !== "SEED") return;
      const value = findConstValueText(node);
      if (!value) return;
      const owner = findEnclosingImplTarget(node) ?? "<top-level>";
      getState(ctx).entries.push({ ownerType: owner, prefix: value.trim(), node });
    },
  },
  after(ctx) {
    const { entries } = getState(ctx);
    if (entries.length < 2) return;
    const byValue = new Map<string, PrefixEntry[]>();
    for (const e of entries) {
      const list = byValue.get(e.prefix) ?? [];
      list.push(e);
      byValue.set(e.prefix, list);
    }
    for (const [value, group] of byValue) {
      const uniqueOwners = Array.from(new Set(group.map(g => g.ownerType)));
      if (uniqueOwners.length < 2) continue;
      for (const e of group) {
        ctx.output.issues.push({
          severity: "high",
          rule: "pda-seed-collision",
          title: `Duplicate PDA seed prefix ${value} on ${uniqueOwners.join(", ")}`,
          location: formatLocation(ctx.filename, e.node),
          description: `\`${e.ownerType}\` shares the seed prefix ${value} with ${uniqueOwners
            .filter(o => o !== e.ownerType)
            .join(", ")}. Without distinct seeds an attacker can confuse one PDA for another.`,
          suggestion: `Give each PDA-deriving type a unique \`PREFIX\` / \`SEED\` constant (e.g. \`b"escrow"\` vs \`b"config"\`).`,
        });
      }
    }
  },
};
