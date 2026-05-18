import type Parser from "web-tree-sitter";
import { walk } from "../walk.js";

type Node = Parser.SyntaxNode;
type Tree = Parser.Tree;

export interface ParsedAccountAttr {
  /** Bare keywords inside the macro body, e.g. `init`, `bump`, `signer`, `mut`. */
  keywords: Set<string>;
  /** `key = value` entries. Compound keys like `realloc::payer` are stored joined by `::`. */
  kvPairs: Map<string, Node[]>;
  attributeNode: Node;
}

export interface AnchorField {
  name: string;
  /** Outer type identifier text, e.g. `Account` for `Account<'info, Escrow>`. Null when type is opaque. */
  typeIdentifier: string | null;
  /** Inner generic argument identifier, e.g. `Escrow` for `Account<'info, Escrow>`. Null when not generic. */
  innerTypeIdentifier: string | null;
  /** Full type text. */
  typeText: string;
  attribute: ParsedAccountAttr | null;
  fieldNode: Node;
}

export interface AnchorStruct {
  name: string;
  structNode: Node;
  fields: AnchorField[];
}

export interface AnchorContext {
  structs: AnchorStruct[];
  programModule: Node | null;
}

const KEYWORD_NODE_TYPES = new Set(["identifier", "mutable_specifier", "primitive_type"]);

/**
 * Walk a `#[account(...)]` attribute's token_tree, extracting bare keywords
 * and `key = value` pairs. Compound keys like `realloc::payer` are joined by
 * `::` and stored as a single key string.
 */
export function parseAccountAttribute(attributeNode: Node): ParsedAccountAttr {
  const keywords = new Set<string>();
  const kvPairs = new Map<string, Node[]>();
  // attribute → { identifier "account", token_tree "(...)" }
  let tokenTree: Node | null = null;
  for (let i = 0; i < attributeNode.namedChildCount; i++) {
    const c = attributeNode.namedChild(i);
    if (c?.type === "token_tree") {
      tokenTree = c;
      break;
    }
  }
  if (!tokenTree) return { keywords, kvPairs, attributeNode };

  // Collect children excluding outer parens.
  const children: Node[] = [];
  for (let i = 0; i < tokenTree.childCount; i++) {
    const c = tokenTree.child(i);
    if (!c) continue;
    if (c.text === "(" || c.text === ")") continue;
    children.push(c);
  }

  // Split on top-level commas.
  const segments: Node[][] = [];
  let segment: Node[] = [];
  for (const c of children) {
    if (c.text === ",") {
      segments.push(segment);
      segment = [];
    } else {
      segment.push(c);
    }
  }
  if (segment.length > 0) segments.push(segment);

  for (const seg of segments) {
    if (seg.length === 0) continue;
    const eqIdx = seg.findIndex(s => s.text === "=" && s.type === "=");
    if (eqIdx === -1) {
      const key = joinKeyParts(seg);
      if (key) keywords.add(key);
    } else {
      const key = joinKeyParts(seg.slice(0, eqIdx));
      const value = seg.slice(eqIdx + 1);
      if (key) kvPairs.set(key, value);
    }
  }

  return { keywords, kvPairs, attributeNode };
}

function joinKeyParts(parts: Node[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (KEYWORD_NODE_TYPES.has(p.type)) out.push(p.text);
    else if (p.text === "::") out.push("::");
  }
  return out.join("");
}

/**
 * For an attribute_item node, return the parsed inner `#[account(...)]` if
 * that's what it is. Returns null for `#[derive(...)]`, `#[program]`, etc.
 */
export function parseIfAccountAttribute(attrItem: Node): ParsedAccountAttr | null {
  if (attrItem.type !== "attribute_item") return null;
  const attribute = attrItem.namedChild(0);
  if (!attribute || attribute.type !== "attribute") return null;
  const head = attribute.namedChild(0);
  if (head?.text !== "account") return null;
  return parseAccountAttribute(attribute);
}

function attributeIsDeriveAccounts(attrItem: Node): boolean {
  if (attrItem.type !== "attribute_item") return false;
  const attribute = attrItem.namedChild(0);
  if (!attribute || attribute.type !== "attribute") return false;
  const head = attribute.namedChild(0);
  if (head?.text !== "derive") return false;
  let found = false;
  walk(attribute, n => {
    if (found) return "skip";
    if (n.type === "identifier" && n.text === "Accounts") found = true;
  });
  return found;
}

function getStructTypeIdentifier(typeNode: Node): { outer: string | null; inner: string | null; text: string } {
  const text = typeNode.text;
  if (typeNode.type === "type_identifier") return { outer: typeNode.text, inner: null, text };
  if (typeNode.type === "generic_type") {
    const outerId = typeNode.namedChild(0);
    const outer = outerId?.type === "type_identifier" ? outerId.text : null;
    const args = typeNode.childForFieldName("type_arguments") ?? typeNode.namedChild(1);
    let inner: string | null = null;
    if (args) {
      for (let i = 0; i < args.namedChildCount; i++) {
        const c = args.namedChild(i);
        if (c?.type === "type_identifier") {
          inner = c.text;
          break;
        }
      }
    }
    return { outer, inner, text };
  }
  if (typeNode.type === "reference_type") {
    const inner = typeNode.namedChild(typeNode.namedChildCount - 1);
    if (inner) return getStructTypeIdentifier(inner);
  }
  return { outer: null, inner: null, text };
}

function collectStructFields(structNode: Node): AnchorField[] {
  const list = structNode.childForFieldName("body") ?? findFieldList(structNode);
  if (!list) return [];
  const fields: AnchorField[] = [];
  let pendingAttr: ParsedAccountAttr | null = null;
  for (let i = 0; i < list.namedChildCount; i++) {
    const child = list.namedChild(i);
    if (!child) continue;
    if (child.type === "attribute_item") {
      const parsed = parseIfAccountAttribute(child);
      if (parsed) pendingAttr = parsed;
      continue;
    }
    if (child.type === "field_declaration") {
      const nameNode = child.childForFieldName("name") ?? findFieldName(child);
      const typeNode = child.childForFieldName("type") ?? findFieldType(child);
      if (!nameNode || !typeNode) {
        pendingAttr = null;
        continue;
      }
      const { outer, inner, text } = getStructTypeIdentifier(typeNode);
      fields.push({
        name: nameNode.text,
        typeIdentifier: outer,
        innerTypeIdentifier: inner,
        typeText: text,
        attribute: pendingAttr,
        fieldNode: child,
      });
      pendingAttr = null;
    }
  }
  return fields;
}

function findFieldList(structNode: Node): Node | null {
  for (let i = 0; i < structNode.namedChildCount; i++) {
    const c = structNode.namedChild(i);
    if (c?.type === "field_declaration_list") return c;
  }
  return null;
}

function findFieldName(fieldNode: Node): Node | null {
  for (let i = 0; i < fieldNode.namedChildCount; i++) {
    const c = fieldNode.namedChild(i);
    if (c?.type === "field_identifier") return c;
  }
  return null;
}

function findFieldType(fieldNode: Node): Node | null {
  // First named child that isn't a visibility_modifier, attribute_item, or field_identifier.
  for (let i = 0; i < fieldNode.namedChildCount; i++) {
    const c = fieldNode.namedChild(i);
    if (!c) continue;
    if (c.type === "visibility_modifier" || c.type === "attribute_item" || c.type === "field_identifier") continue;
    return c;
  }
  return null;
}

/**
 * Build the per-file anchor context: every `#[derive(Accounts)]` struct with
 * its fields and parsed attributes, plus a pointer to the `#[program]` module
 * (if any). Walks source_file's named children pairwise to associate
 * attribute_item with the immediately-following struct/mod.
 */
export function collectAnchorContext(tree: Tree): AnchorContext {
  const structs: AnchorStruct[] = [];
  let programModule: Node | null = null;
  const root = tree.rootNode;

  let pendingIsAccountsDerive = false;
  let pendingIsProgramAttr = false;
  for (let i = 0; i < root.namedChildCount; i++) {
    const node = root.namedChild(i);
    if (!node) continue;

    if (node.type === "attribute_item") {
      if (attributeIsDeriveAccounts(node)) pendingIsAccountsDerive = true;
      else if (isProgramAttr(node)) pendingIsProgramAttr = true;
      continue;
    }

    if (node.type === "struct_item") {
      if (pendingIsAccountsDerive) {
        const nameNode = node.childForFieldName("name");
        const name = nameNode?.text ?? "<anonymous>";
        structs.push({ name, structNode: node, fields: collectStructFields(node) });
      }
      pendingIsAccountsDerive = false;
      pendingIsProgramAttr = false;
      continue;
    }

    if (node.type === "mod_item") {
      if (pendingIsProgramAttr) programModule = node;
      pendingIsAccountsDerive = false;
      pendingIsProgramAttr = false;
      continue;
    }

    // Any other top-level node clears the pending flags.
    pendingIsAccountsDerive = false;
    pendingIsProgramAttr = false;
  }

  return { structs, programModule };
}

function isProgramAttr(attrItem: Node): boolean {
  const attribute = attrItem.namedChild(0);
  if (!attribute || attribute.type !== "attribute") return false;
  const head = attribute.namedChild(0);
  return head?.text === "program";
}
