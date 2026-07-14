import { createHash } from "node:crypto";
import type { Node, Tree } from "web-tree-sitter";
import type { Issue } from "./types.js";

const SCOPE_TYPES = new Set(["function_item", "impl_item", "struct_item", "enum_item", "trait_item", "mod_item"]);

function scopeName(node: Node): string {
  return node.childForFieldName("name")?.text ?? node.childForFieldName("type")?.text ?? "?";
}

function scopeChain(node: Node): string {
  const parts: string[] = [];
  let cursor: Node | null = node;
  while (cursor) {
    if (SCOPE_TYPES.has(cursor.type)) parts.unshift(`${cursor.type}:${scopeName(cursor)}`);
    cursor = cursor.parent;
  }
  return parts.length > 0 ? parts.join(">") : "file";
}

function nodeAtLocation(tree: Tree, location: string): Node | null {
  const match = /:(\d+):(\d+)$/.exec(location);
  if (!match) return null;
  return tree.rootNode.descendantForPosition({ row: Number(match[1]) - 1, column: Number(match[2]) - 1 });
}

export function fingerprintIssues(issues: Issue[], tree: Tree | null): void {
  for (const issue of issues) {
    const node = tree ? nodeAtLocation(tree, issue.location) : null;
    const scope = node ? scopeChain(node) : "file";
    const hash = createHash("sha256").update(`${issue.rule}\0${issue.title}\0${scope}`).digest("hex").slice(0, 12);
    issue.fingerprint = `${issue.rule}:${hash}`;
  }
}
