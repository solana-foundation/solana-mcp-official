import type Parser from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { getCallName, walk } from "../walk.js";
import { findEnclosingFunctionBody, getCallArgs, isProgramAccountName, rootIdentifierOf } from "./_helpers.js";

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

function verifiedProgramsBefore(scope: Node, beforeIndex: number): Set<string> {
  const verified = new Set<string>();
  walk(scope, n => {
    if (n.startIndex >= beforeIndex) return "skip";
    if (n.type !== "call_expression") return;
    const fn = n.childForFieldName("function");
    const name = fn ? getCallName(fn) : null;
    if (!name || !PROGRAM_VERIFY_FNS.has(name)) return;
    const programArg = getCallArgs(n)[0];
    const root = programArg ? rootIdentifierOf(programArg) : null;
    if (root) verified.add(root);
  });
  return verified;
}

function collectRootIdentifiers(node: Node): Set<string> {
  const roots = new Set<string>();
  walk(node, n => {
    const root = rootIdentifierOf(n);
    if (root) {
      roots.add(root);
      return "skip";
    }
  });
  return roots;
}

function programShapedRoots(roots: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const root of roots) {
    if (root === "program" || root.endsWith("_program") || isProgramAccountName(root)) out.add(root);
  }
  return out;
}

function invokeUsesVerifiedProgram(call: Node, verifiedPrograms: ReadonlySet<string>): boolean {
  if (verifiedPrograms.size === 0) return false;
  const accountList = getCallArgs(call)[1];
  if (!accountList) return false;
  const roots = collectRootIdentifiers(accountList);
  const programRoots = programShapedRoots(roots);
  if (programRoots.size > 0) {
    for (const root of programRoots) {
      if (!verifiedPrograms.has(root)) return false;
    }
    return true;
  }
  for (const verified of verifiedPrograms) {
    if (roots.has(verified)) return true;
  }
  return false;
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
      if (invokeUsesVerifiedProgram(node, verifiedProgramsBefore(scope, node.startIndex))) return;
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
