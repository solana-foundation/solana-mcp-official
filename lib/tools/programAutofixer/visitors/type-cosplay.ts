import type { Node } from "web-tree-sitter";
import type { Visitor, VisitorContext } from "../types.js";
import { formatLocation } from "../types.js";

const ACCOUNT_STATE_CALL_PATTERN = /^(?:from_bytes|load|try_from_slice)/;

interface DiscriminatorAssignment {
  ownerType: string;
  traitName: string;
  value: string;
  node: Node;
}

interface TypeCosplayState {
  assignments: DiscriminatorAssignment[];
  accountLikeTypes: Set<string>;
}

function getState(ctx: VisitorContext): TypeCosplayState {
  const bag = ctx as unknown as { __typeCosplay?: TypeCosplayState };
  if (!bag.__typeCosplay) bag.__typeCosplay = { assignments: [], accountLikeTypes: new Set() };
  return bag.__typeCosplay;
}

function findEnclosingImpl(node: Node): { typeName: string; traitName: string } | null {
  let cursor: Node | null = node.parent;
  while (cursor) {
    if (cursor.type === "impl_item") {
      const target = cursor.childForFieldName("type");
      if (!target) return null;
      const trait = cursor.childForFieldName("trait");
      return { typeName: target.text, traitName: trait?.text ?? "<inherent>" };
    }
    cursor = cursor.parent;
  }
  return null;
}

function normalizeTypeName(name: string): string {
  const base = name.split("<")[0].trim();
  return base.split("::").pop() ?? base;
}

export const typeCosplay: Visitor = {
  name: "type-cosplay",
  severity: "critical",
  appliesTo: ["pinocchio"],
  enter: {
    const_item(node, ctx) {
      const name = _findConstName(node);
      if (name === "LEN") {
        const impl = findEnclosingImpl(node);
        if (impl) getState(ctx).accountLikeTypes.add(normalizeTypeName(impl.typeName));
        return;
      }
      if (name !== "DISCRIMINATOR") return;
      const value = _findConstValue(node);
      if (!value) return;
      const impl = findEnclosingImpl(node);
      if (!impl) return;
      getState(ctx).assignments.push({
        ownerType: impl.typeName,
        traitName: impl.traitName,
        value,
        node,
      });
    },
    call_expression(node, ctx) {
      const fn = node.childForFieldName("function");
      if (!fn || fn.type !== "scoped_identifier") return;
      const name = fn.childForFieldName("name")?.text;
      if (!name || !ACCOUNT_STATE_CALL_PATTERN.test(name)) return;
      const path = fn.childForFieldName("path");
      if (!path) return;
      getState(ctx).accountLikeTypes.add(normalizeTypeName(path.text));
    },
  },
  after(ctx) {
    const { assignments, accountLikeTypes } = getState(ctx);
    if (assignments.length < 2) return;
    const byKey = new Map<string, DiscriminatorAssignment[]>();
    for (const a of assignments) {
      const key = `${a.traitName}|${a.value}`;
      const list = byKey.get(key) ?? [];
      list.push(a);
      byKey.set(key, list);
    }
    for (const group of byKey.values()) {
      const inherent = group[0].traitName === "<inherent>";
      const relevant = inherent ? group.filter(a => accountLikeTypes.has(normalizeTypeName(a.ownerType))) : group;
      const uniqueOwners = Array.from(new Set(relevant.map(g => g.ownerType)));
      if (uniqueOwners.length < 2) continue;
      for (const a of relevant) {
        ctx.output.issues.push({
          severity: "critical",
          rule: "type-cosplay",
          title: `Duplicate DISCRIMINATOR value ${a.value} across ${uniqueOwners.join(", ")}`,
          location: formatLocation(ctx.filename, a.node),
          description: `\`${a.ownerType}::DISCRIMINATOR = ${a.value}\` collides with the same value on ${uniqueOwners.filter(o => o !== a.ownerType).join(", ")}. Two account types with the same discriminator can be substituted for each other after deserialization.`,
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
