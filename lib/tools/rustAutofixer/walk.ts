import type Parser from "web-tree-sitter";

type Node = Parser.SyntaxNode;

export type WalkCallback = (node: Node) => void | "skip";

export function walk(node: Node, cb: WalkCallback): void {
  const cursor = node.walk();
  const visit = (): void => {
    const current = cursor.currentNode();
    const result = cb(current);
    if (result === "skip") return;
    if (cursor.gotoFirstChild()) {
      do {
        visit();
      } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
  };
  visit();
  cursor.delete();
}

export function findAll(root: Node, predicate: (n: Node) => boolean): Node[] {
  const matches: Node[] = [];
  walk(root, n => {
    if (predicate(n)) matches.push(n);
  });
  return matches;
}

export function findFirst(root: Node, predicate: (n: Node) => boolean): Node | null {
  let result: Node | null = null;
  walk(root, n => {
    if (result) return "skip";
    if (predicate(n)) {
      result = n;
      return "skip";
    }
  });
  return result;
}

export function isCallTo(node: Node, fnName: string): boolean {
  if (node.type !== "call_expression") return false;
  const fn = node.childForFieldName("function");
  if (!fn) return false;
  return getCallName(fn) === fnName;
}

export function getCallName(fnNode: Node): string | null {
  if (fnNode.type === "identifier") return fnNode.text;
  if (fnNode.type === "scoped_identifier" || fnNode.type === "field_expression") {
    const name = fnNode.childForFieldName("name") ?? fnNode.lastChild;
    return name?.text ?? null;
  }
  return fnNode.lastChild?.text ?? null;
}

export function callsAnyOf(root: Node, names: ReadonlySet<string>): boolean {
  let found = false;
  walk(root, n => {
    if (found) return "skip";
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      if (name && names.has(name)) {
        found = true;
        return "skip";
      }
    }
  });
  return found;
}
