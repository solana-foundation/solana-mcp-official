import type { Node } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation, snippet } from "../types.js";
import { walk } from "../walk.js";
import {
  LEN_MARKERS,
  findEnclosingFunctionBody,
  getMacroName,
  isRejectingGuard,
  macroIdentifiers,
} from "./_helpers.js";

const CHECK_MACRO_PATTERN = /assert|require/;
const LEN_TOKEN_PATTERN = /len|size/;

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

function mentionsLenMarker(node: Node): boolean {
  let found = false;
  walk(node, n => {
    if (found) return "skip";
    if (n.type === "identifier" || n.type === "field_identifier") {
      const text = n.text.toLowerCase();
      if (LEN_MARKERS.some(m => text.includes(m))) found = true;
    }
  });
  return found;
}

function bodyHasLenValidationBefore(body: Node, beforeIndex: number): boolean {
  let found = false;
  walk(body, n => {
    if (found) return "skip";
    if (n.startIndex >= beforeIndex) return "skip";
    if (n.type === "if_expression") {
      const condition = n.childForFieldName("condition") ?? n.namedChild(0);
      if (condition && mentionsLenMarker(condition) && isRejectingGuard(condition)) found = true;
      return;
    }
    if (n.type === "macro_invocation") {
      const m = getMacroName(n);
      if (
        m &&
        CHECK_MACRO_PATTERN.test(m) &&
        macroIdentifiers(n).some(id => LEN_TOKEN_PATTERN.test(id.toLowerCase()))
      ) {
        found = true;
      }
    }
  });
  return found;
}

function pointerTargetIsPrimitive(pointerType: Node): boolean {
  const target = pointerType.childForFieldName("type") ?? pointerType.namedChild(pointerType.namedChildCount - 1);
  return target?.type === "primitive_type" || target?.type === "unit_type";
}

export const uncheckedDeserialization: Visitor = {
  name: "unchecked-deserialization",
  severity: "medium",
  appliesTo: ["pinocchio", "anchor"],
  enter: {
    type_cast_expression(node, ctx) {
      let pointerType: Node | null = null;
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c?.type === "pointer_type") {
          pointerType = c;
          break;
        }
      }
      if (!pointerType) return;
      if (pointerTargetIsPrimitive(pointerType)) return;
      if (isInsideUncheckedFn(node)) return;
      const body = findEnclosingFunctionBody(node);
      if (body && bodyHasLenValidationBefore(body, node.startIndex)) return;
      ctx.output.issues.push({
        severity: "medium",
        rule: "unchecked-deserialization",
        title: `Raw pointer cast without length validation`,
        location: formatLocation(ctx.filename, node),
        description: `Casting bytes to a typed pointer (\`as *const T\` / \`as *mut T\`) bypasses length and discriminator validation. Validate the buffer length first, or keep raw casts inside a private \`from_bytes_unchecked\` (or similarly \`*_unchecked\`) helper that callers reach only via a safe wrapper.`,
        suggestion: `Guard the cast with a length check (\`if data.len() < Self::LEN { return Err(...) }\`) or move it into a \`*_unchecked\` function fronted by a safe \`from_bytes\` that validates length + discriminator.`,
        code_snippet: snippet(ctx.source, node, 80),
      });
    },
  },
};
