import type Parser from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { getCallName, walk } from "../walk.js";
import { findEnclosingFunctionBody } from "./_helpers.js";

type Node = Parser.SyntaxNode;

const INVOKE_FNS = new Set(["invoke", "invoke_signed", "invoke_unchecked", "invoke_signed_unchecked"]);

const PROGRAM_VERIFY_FNS = new Set([
  "verify_program_id",
  "verify_system_program",
  "verify_token_program",
  "verify_associated_token_program",
  "verify_token_2022_program",
]);

function lastSegmentOf(scoped: Node): string | null {
  let last: Node | null = null;
  for (let i = 0; i < scoped.namedChildCount; i++) {
    const c = scoped.namedChild(i);
    if (c) last = c;
  }
  return last?.text ?? null;
}

function invokeUsesHardcodedProgramId(call: Node): boolean {
  let usesHardcoded = false;
  walk(call, n => {
    if (usesHardcoded) return "skip";
    if (n.type !== "scoped_identifier") return;
    const tail = lastSegmentOf(n);
    if (tail === "ID" || tail === "id") usesHardcoded = true;
  });
  return usesHardcoded;
}

function functionHasProgramVerification(scope: Node, beforeIndex: number): boolean {
  let found = false;
  walk(scope, n => {
    if (found) return "skip";
    if (n.startIndex >= beforeIndex) return "skip";
    if (n.type !== "call_expression") return;
    const fn = n.childForFieldName("function");
    const name = fn ? getCallName(fn) : null;
    if (name && PROGRAM_VERIFY_FNS.has(name)) found = true;
  });
  return found;
}

export const arbitraryCpi: Visitor = {
  name: "arbitrary-cpi",
  severity: "high",
  appliesTo: ["pinocchio"],
  enter: {
    call_expression(node, ctx) {
      const fn = node.childForFieldName("function");
      if (!fn) return;
      // Only flag bare `invoke(...)` / `module::invoke(...)`. Method calls like
      // `Builder { ... }.invoke()` encode the program ID inside the builder type
      // — we can't statically verify them and shouldn't blanket-warn.
      if (fn.type === "field_expression") return;
      const name = getCallName(fn);
      if (!name || !INVOKE_FNS.has(name)) return;
      if (invokeUsesHardcodedProgramId(node)) return;
      const scope = findEnclosingFunctionBody(node);
      if (!scope) return;
      if (functionHasProgramVerification(scope, node.startIndex)) return;
      ctx.output.issues.push({
        severity: "high",
        rule: "arbitrary-cpi",
        title: `Unverified program in ${name}()`,
        location: formatLocation(ctx.filename, node),
        description: `\`${name}\` is called inside a function that never verifies the target program's address (no \`verify_program_id\` or \`verify_<spl>_program\` call, no hard-coded \`<crate>::ID\`). An attacker can substitute a malicious program and intercept the CPI.`,
        suggestion: `Hard-code the target program ID (e.g. \`&pinocchio_token::ID\`) or call \`verify_token_program(...)\` / \`verify_program_id(<program>, &<EXPECTED_ID>)\` before \`${name}\`.`,
      });
    },
  },
};
