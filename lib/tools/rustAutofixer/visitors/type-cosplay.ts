import type Parser from "web-tree-sitter";
import type { Visitor, VisitorContext } from "../types.js";
import { formatLocation } from "../types.js";

type Node = Parser.SyntaxNode;

interface DiscriminatorAssignment {
  ownerType: string;
  value: string;
  node: Node;
}

interface TypeCosplayState {
  assignments: DiscriminatorAssignment[];
}

function getState(ctx: VisitorContext): TypeCosplayState {
  const bag = ctx as unknown as { __typeCosplay?: TypeCosplayState };
  if (!bag.__typeCosplay) bag.__typeCosplay = { assignments: [] };
  return bag.__typeCosplay;
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

export const typeCosplay: Visitor = {
  name: "type-cosplay",
  severity: "critical",
  appliesTo: ["pinocchio"],
  enter: {
    const_item(node, ctx) {
      const name = _findConstName(node);
      if (name !== "DISCRIMINATOR") return;
      const value = _findConstValue(node);
      if (!value) return;
      const owner = findEnclosingImplTarget(node);
      if (!owner) return;
      getState(ctx).assignments.push({
        ownerType: owner,
        value,
        node,
      });
    },
  },
  after(ctx) {
    const { assignments } = getState(ctx);
    if (assignments.length < 2) return;
    const byValue = new Map<string, DiscriminatorAssignment[]>();
    for (const a of assignments) {
      const list = byValue.get(a.value) ?? [];
      list.push(a);
      byValue.set(a.value, list);
    }
    for (const [value, group] of byValue) {
      if (group.length < 2) continue;
      const owners = group.map(g => g.ownerType);
      const uniqueOwners = Array.from(new Set(owners));
      if (uniqueOwners.length < 2) continue;
      for (const a of group) {
        ctx.output.issues.push({
          severity: "critical",
          rule: "type-cosplay",
          title: `Duplicate DISCRIMINATOR value ${value} across ${uniqueOwners.join(", ")}`,
          location: formatLocation(ctx.filename, a.node),
          description: `\`${a.ownerType}::DISCRIMINATOR = ${value}\` collides with the same value on ${uniqueOwners.filter(o => o !== a.ownerType).join(", ")}. Two account types with the same discriminator can be substituted for each other after deserialization.`,
          suggestion: `Give each account type a distinct \`DISCRIMINATOR\` value (e.g. an enum like \`AccountDiscriminator::Escrow as u8 = 0\`, \`Config as u8 = 1\`).`,
        });
      }
    }
  },
};

function _findConstName(node: Node): string | null {
  const named = node.childForFieldName("name");
  if (named) return named.text;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c?.type === "identifier") return c.text;
  }
  return null;
}

function _findConstValue(node: Node): string | null {
  const valueNode = node.childForFieldName("value");
  if (valueNode) return valueNode.text.trim();
  // Last named child is the value expression in tree-sitter-rust's const_item layout.
  const last = node.namedChild(node.namedChildCount - 1);
  return last?.text.trim() ?? null;
}
