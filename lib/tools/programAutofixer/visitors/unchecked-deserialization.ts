import type { Node } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation, snippet } from "../types.js";

/**
 * Pointer cast `as *const T` / `as *mut T` is fine inside a function explicitly
 * named with `_unchecked` (the safe wrapper convention). Outside that, flag.
 */
function isInsideUncheckedFn(node: Node): boolean {
  let cursor: Node | null = node.parent;
  while (cursor) {
    if (cursor.type === "function_item") {
      const name = cursor.childForFieldName("name")?.text ?? "";
      if (name.endsWith("_unchecked") || name === "from_bytes_unchecked") return true;
      return false;
    }
    cursor = cursor.parent;
  }
  return false;
}

export const uncheckedDeserialization: Visitor = {
  name: "unchecked-deserialization",
  severity: "high",
  appliesTo: ["pinocchio", "anchor"],
  enter: {
    type_cast_expression(node, ctx) {
      // Look for `as *const T` / `as *mut T`
      let castsToPointer = false;
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c?.type === "pointer_type") {
          castsToPointer = true;
          break;
        }
      }
      if (!castsToPointer) return;
      if (isInsideUncheckedFn(node)) return;
      ctx.output.issues.push({
        severity: "high",
        rule: "unchecked-deserialization",
        title: `Raw pointer cast outside \`*_unchecked\` function`,
        location: formatLocation(ctx.filename, node),
        description: `Casting bytes to a typed pointer (\`as *const T\` / \`as *mut T\`) bypasses length and discriminator validation. By convention, raw casts belong inside a private \`from_bytes_unchecked\` (or similarly \`*_unchecked\`) helper that callers reach only via a safe wrapper.`,
        suggestion: `Move the cast into a function named \`*_unchecked\` and provide a safe \`from_bytes\` that calls \`require_len!\` + \`validate_discriminator!\` before delegating to it.`,
        code_snippet: snippet(ctx.source, node, 80),
      });
    },
  },
};
