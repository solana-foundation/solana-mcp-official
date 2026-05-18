import type Parser from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { walk } from "../walk.js";
import { getCallName } from "../walk.js";
import { findEnclosingFunctionBody, getMacroName } from "./_helpers.js";

type Node = Parser.SyntaxNode;

const UNCHECKED_CALLS = new Set(["from_bytes_unchecked", "load_unchecked"]);
const LENGTH_CHECK_MACROS = new Set(["require_len", "require_size", "require_eq_len"]);
const LENGTH_CHECK_FNS = new Set(["require_len", "check_len", "verify_len"]);

function scopeHasLengthCheck(scope: Node, beforeIndex: number): boolean {
  let found = false;
  walk(scope, n => {
    if (found) return "skip";
    if (n.startIndex >= beforeIndex) return "skip";
    if (n.type === "macro_invocation") {
      const m = getMacroName(n);
      if (m && LENGTH_CHECK_MACROS.has(m)) found = true;
    } else if (n.type === "call_expression") {
      const fn = n.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      if (name && LENGTH_CHECK_FNS.has(name)) found = true;
    }
  });
  return found;
}

export const dataSizeValidation: Visitor = {
  name: "data-size-validation",
  severity: "high",
  appliesTo: ["pinocchio"],
  enter: {
    call_expression(node, ctx) {
      const fn = node.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      if (!name || !UNCHECKED_CALLS.has(name)) return;
      const scope = findEnclosingFunctionBody(node);
      if (!scope) return;
      if (scopeHasLengthCheck(scope, node.startIndex)) return;
      ctx.output.issues.push({
        severity: "high",
        rule: "data-size-validation",
        title: `\`${name}\` without preceding length check`,
        location: formatLocation(ctx.filename, node),
        description: `\`${name}\` deserialises raw bytes without validating that the buffer is at least \`Self::LEN\` bytes. A short slice causes a buffer over-read inside the unsafe cast.`,
        suggestion: `Call \`require_len!(data, Self::LEN);\` (or your equivalent length helper) before \`${name}\`.`,
      });
    },
  },
};
