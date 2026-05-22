import type { Node } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { walk } from "../walk.js";
import { getCallName } from "../walk.js";
import { getMacroName } from "./_helpers.js";

const LEN_MACROS = new Set(["require_len", "require_size", "require_eq_len"]);
const LEN_FNS = new Set(["require_len", "check_len", "verify_len"]);

/**
 * Walk an impl_item declaration_list for a `try_from` function and confirm it
 * contains a length-validation macro or call.
 */
function tryFromHasLenCheck(implItem: Node): boolean {
  let found = false;
  walk(implItem, n => {
    if (found) return "skip";
    if (n.type !== "function_item") return;
    const nameNode = n.childForFieldName("name");
    if (nameNode?.text !== "try_from") return;
    walk(n, inner => {
      if (found) return "skip";
      if (inner.type === "macro_invocation") {
        const m = getMacroName(inner);
        if (m && LEN_MACROS.has(m)) found = true;
      } else if (inner.type === "call_expression") {
        const fn = inner.childForFieldName("function");
        const name = fn ? getCallName(fn) : null;
        if (name && LEN_FNS.has(name)) found = true;
      }
    });
  });
  return found;
}

function isTryFromU8Impl(implItem: Node): { targetName: string } | null {
  let isTryFromSlice = false;
  for (let i = 0; i < implItem.namedChildCount; i++) {
    const c = implItem.namedChild(i);
    if (!c) continue;
    if (c.type === "generic_type") {
      const head = c.namedChild(0);
      if (head?.text !== "TryFrom") continue;
      const args = c.namedChild(1);
      if (!args) continue;
      walk(args, n => {
        if (isTryFromSlice) return "skip";
        if (n.type === "primitive_type" && n.text === "u8") isTryFromSlice = true;
      });
    }
  }
  if (!isTryFromSlice) return null;
  const target = implItem.childForFieldName("type");
  return target ? { targetName: target.text } : null;
}

export const instructionDataBounds: Visitor = {
  name: "instruction-data-bounds",
  severity: "high",
  appliesTo: ["pinocchio"],
  enter: {
    impl_item(node, ctx) {
      const info = isTryFromU8Impl(node);
      if (!info) return;
      if (tryFromHasLenCheck(node)) return;
      ctx.output.issues.push({
        severity: "high",
        rule: "instruction-data-bounds",
        title: `TryFrom<&[u8]> for ${info.targetName} skips bounds validation`,
        location: formatLocation(ctx.filename, node),
        description: `\`impl TryFrom<&[u8]> for ${info.targetName}\` parses instruction data without invoking a length check (\`require_len!\` / \`check_len\`). Short input causes out-of-bounds reads inside the parser.`,
        suggestion: `Open the \`try_from\` body with \`require_len!(data, Self::LEN);\` (or an equivalent explicit length compare) before indexing the slice.`,
      });
    },
  },
};
