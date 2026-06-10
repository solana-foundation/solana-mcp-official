import type { Node } from "web-tree-sitter";
import type { Visitor, VisitorContext } from "../types.js";
import { formatLocation } from "../types.js";
import { findFirst, getCallName } from "../walk.js";
import { getCallArgs } from "./_helpers.js";

const DERIVATION_FNS = new Set(["find_program_address", "try_find_program_address", "create_program_address"]);

interface SeedConst {
  ownerType: string;
  name: string;
  value: string;
  node: Node;
}

interface SeedElement {
  kind: "literal" | "path" | "other";
  text: string;
}

interface Derivation {
  elements: SeedElement[];
}

interface SeedState {
  entries: SeedConst[];
  derivations: Derivation[];
}

function getState(ctx: VisitorContext): SeedState {
  const bag = ctx as unknown as { __pdaSeed?: SeedState };
  if (!bag.__pdaSeed) bag.__pdaSeed = { entries: [], derivations: [] };
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

function isByteLikeConstType(typeNode: Node | null): boolean {
  if (!typeNode) return false;
  const t = typeNode.text.replace(/\s+/g, "");
  return /^&(?:'\w+)?\[u8\]$/.test(t) || /^\[u8;[^\]]+\]$/.test(t) || /^&(?:'\w+)?str$/.test(t);
}

function classifySeedElement(element: Node): SeedElement {
  let cursor = element;
  while (cursor.type === "reference_expression" || cursor.type === "parenthesized_expression") {
    const inner = cursor.childForFieldName("value") ?? cursor.namedChild(cursor.namedChildCount - 1);
    if (!inner) break;
    cursor = inner;
  }
  if (cursor.type.endsWith("_literal")) return { kind: "literal", text: cursor.text };
  if (cursor.type === "identifier" || cursor.type === "scoped_identifier") return { kind: "path", text: cursor.text };
  return { kind: "other", text: cursor.text };
}

function normalizeOwner(ownerType: string): string {
  const base = ownerType.split("<")[0].trim();
  return base.split("::").pop() ?? base;
}

function resolveElement(element: SeedElement, entries: SeedConst[]): string {
  if (element.kind === "literal") return `lit:${element.text}`;
  if (element.kind === "path") {
    const segments = element.text.split("::");
    const name = segments[segments.length - 1];
    const owner = segments.length > 1 ? segments[segments.length - 2] : null;
    const matches = entries.filter(e => e.name === name && (!owner || normalizeOwner(e.ownerType) === owner));
    const values = Array.from(new Set(matches.map(m => m.value)));
    if (values.length === 1) return `lit:${values[0]}`;
  }
  return "_";
}

function derivationSignature(derivation: Derivation, entries: SeedConst[]): string {
  return derivation.elements.map(el => resolveElement(el, entries)).join("|");
}

function hasDuplicate(values: string[]): boolean {
  return new Set(values).size < values.length;
}

export const pdaSeedCollision: Visitor = {
  name: "pda-seed-collision",
  severity: "medium",
  appliesTo: ["pinocchio"],
  enter: {
    const_item(node, ctx) {
      const name = findConstName(node);
      if (name !== "PREFIX" && name !== "SEED") return;
      if (!isByteLikeConstType(node.childForFieldName("type"))) return;
      const value = findConstValueText(node);
      if (!value) return;
      const owner = findEnclosingImplTarget(node) ?? "<top-level>";
      getState(ctx).entries.push({ ownerType: owner, name, value: value.trim(), node });
    },
    call_expression(node, ctx) {
      const fn = node.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      if (!name || !DERIVATION_FNS.has(name)) return;
      const args = getCallArgs(node);
      if (args.length === 0) return;
      const seedArray = findFirst(args[0], n => n.type === "array_expression");
      if (!seedArray) return;
      const elements: SeedElement[] = [];
      for (let i = 0; i < seedArray.namedChildCount; i++) {
        const element = seedArray.namedChild(i);
        if (element) elements.push(classifySeedElement(element));
      }
      getState(ctx).derivations.push({ elements });
    },
  },
  after(ctx) {
    const { entries, derivations } = getState(ctx);
    if (entries.length < 2) return;
    const byValue = new Map<string, SeedConst[]>();
    for (const e of entries) {
      const list = byValue.get(e.value) ?? [];
      list.push(e);
      byValue.set(e.value, list);
    }
    for (const [value, group] of byValue) {
      const uniqueOwners = Array.from(new Set(group.map(g => g.ownerType)));
      if (uniqueOwners.length < 2) continue;
      const usingDerivations = derivations.filter(d =>
        d.elements.some(el => el.kind === "path" && resolveElement(el, group) === `lit:${value}`),
      );
      if (usingDerivations.length > 0) {
        const signatures = usingDerivations.map(d => derivationSignature(d, entries));
        if (!hasDuplicate(signatures)) continue;
        for (const e of group) {
          ctx.output.issues.push({
            severity: "medium",
            rule: "pda-seed-collision",
            title: `Duplicate PDA seed prefix ${value} on ${uniqueOwners.join(", ")}`,
            location: formatLocation(ctx.filename, e.node),
            description: `\`${e.ownerType}\` shares the seed prefix ${value} with ${uniqueOwners
              .filter(o => o !== e.ownerType)
              .join(
                ", ",
              )}, and two derivations using it have indistinguishable seed shapes. An attacker can confuse one PDA for another.`,
            suggestion: `Give each PDA-deriving type a unique \`PREFIX\` / \`SEED\` constant (e.g. \`b"escrow"\` vs \`b"config"\`), or add a distinguishing literal seed to each derivation.`,
          });
        }
        continue;
      }
      for (const e of group) {
        ctx.output.issues.push({
          severity: "medium",
          rule: "pda-seed-collision",
          title: `Duplicate PDA seed prefix ${value} on ${uniqueOwners.join(", ")}`,
          location: formatLocation(ctx.filename, e.node),
          description: `\`${e.ownerType}\` shares the seed prefix ${value} with ${uniqueOwners
            .filter(o => o !== e.ownerType)
            .join(
              ", ",
            )}. Verify the remaining seeds in each derivation differ; identical seed lists make the PDAs collide.`,
          suggestion: `Prefer a unique \`PREFIX\` / \`SEED\` constant per PDA-deriving type (e.g. \`b"escrow"\` vs \`b"config"\`).`,
        });
      }
    }
  },
};
