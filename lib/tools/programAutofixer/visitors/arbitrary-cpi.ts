import type { Node, Tree } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { findAll, getCallName, walk } from "../walk.js";
import {
  KEY_MARKERS,
  bodyContainsRejectingCheckFor,
  bodyContainsVerifyFor,
  fileContainsProgramVerifyFor,
  findEnclosingFunctionBody,
  getCallArgs,
  isProgramAccountName,
  rootIdentifierOf,
} from "./_helpers.js";

const INVOKE_FNS = new Set(["invoke", "invoke_signed", "invoke_unchecked", "invoke_signed_unchecked"]);

const PROGRAM_VERIFY_FNS = new Set([
  "verify_program_id",
  "verify_system_program",
  "verify_token_program",
  "verify_associated_token_program",
  "verify_token_2022_program",
]);

const CHECK_ID_FNS = new Set(["check_id", "verify_program_id"]);

const TRUSTED_BUILDER_PATHS = [
  "system_instruction::",
  "spl_token::instruction::",
  "spl_associated_token_account::instruction::",
  "pinocchio_system::instructions::",
  "pinocchio_token::instructions::",
];

function lastSegmentOf(scoped: Node): string | null {
  let last: Node | null = null;
  for (let i = 0; i < scoped.namedChildCount; i++) {
    const c = scoped.namedChild(i);
    if (c) last = c;
  }
  return last?.text ?? null;
}

function invokeUsesHardcodedProgramId(expr: Node): boolean {
  let usesHardcoded = false;
  walk(expr, n => {
    if (usesHardcoded) return "skip";
    if (n.type !== "scoped_identifier") return;
    const tail = lastSegmentOf(n);
    if (tail === "ID" || tail === "id") usesHardcoded = true;
  });
  return usesHardcoded;
}

function isTrustedBuilderExpr(expr: Node): boolean {
  const text = expr.text.replace(/\s+/g, "");
  return TRUSTED_BUILDER_PATHS.some(path => text.includes(path));
}

function letInitializersFor(scope: Node, name: string, before: number): Node[] {
  const out: Node[] = [];
  walk(scope, n => {
    if (n.startIndex >= before) return "skip";
    if (n.type !== "let_declaration") return;
    const pattern = n.childForFieldName("pattern");
    if (pattern?.type !== "identifier" || pattern.text !== name) return;
    const value = n.childForFieldName("value");
    if (value) out.push(value);
  });
  return out;
}

function candidateInstructionExprs(scope: Node, invoke: Node): Node[] {
  const out: Node[] = [invoke];
  const ixArg = getCallArgs(invoke)[0];
  if (!ixArg) return out;
  const root = rootIdentifierOf(ixArg);
  if (!root) return out;
  const inits = letInitializersFor(scope, root, invoke.startIndex);
  out.push(...inits);
  for (const init of inits) {
    walk(init, n => {
      if (n.type !== "identifier" || n.text === root) return;
      out.push(...letInitializersFor(scope, n.text, init.startIndex));
    });
  }
  return out;
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

function programAccountVerified(scope: Node, invoke: Node): boolean {
  const roots = new Set<string>();
  for (const arg of getCallArgs(invoke)) {
    for (const root of collectRootIdentifiers(arg)) roots.add(root);
  }
  const programRoots = programShapedRoots(roots);
  if (programRoots.size === 0) return false;
  for (const root of programRoots) {
    const verified =
      bodyContainsVerifyFor(scope, CHECK_ID_FNS, root) ||
      bodyContainsRejectingCheckFor(scope, root, KEY_MARKERS) ||
      fileContainsProgramVerifyFor(scope, root);
    if (!verified) return false;
  }
  return true;
}

function buildsInstructionWithHardcodedId(body: Node): boolean {
  const literals = findAll(body, n => {
    if (n.type !== "struct_expression") return false;
    const typeName = n.childForFieldName("name")?.text ?? "";
    return typeName === "Instruction" || typeName.endsWith("::Instruction");
  });
  if (literals.length === 0) return false;
  return literals.every(literal => {
    const programId = findAll(literal, n => n.type === "field_initializer").find(
      f => (f.childForFieldName("field") ?? f.namedChild(0))?.text === "program_id",
    );
    const value = programId?.childForFieldName("value") ?? programId?.namedChild(1);
    return !!value && invokeUsesHardcodedProgramId(value);
  });
}

function enclosingModule(node: Node): Node | null {
  let cursor: Node | null = node.parent;
  while (cursor) {
    if (cursor.type === "mod_item") return cursor;
    cursor = cursor.parent;
  }
  return null;
}

function fileImportsName(tree: Tree, name: string): boolean {
  return (
    findAll(tree.rootNode, n => {
      if (n.type !== "use_declaration") return false;
      return findAll(n, id => id.type === "identifier" && id.text === name).length > 0;
    }).length > 0
  );
}

function isLocalInstructionBuilder(tree: Tree, call: Node, name: string): boolean {
  // An import of the same name may shadow the local definition, and the imported
  // body is not in the submitted text.
  if (fileImportsName(tree, name)) return false;
  const matches = findAll(tree.rootNode, n => {
    if (n.type !== "function_item") return false;
    return n.childForFieldName("name")?.text === name;
  });
  // A duplicated name (concatenated modules) makes the call unattributable, so don't trust it.
  if (matches.length !== 1) return false;
  const fn = matches[0];
  if (enclosingModule(fn) !== enclosingModule(call)) return false;
  const returnType = fn.childForFieldName("return_type");
  if (!returnType?.text.includes("Instruction")) return false;
  const body = fn.childForFieldName("body");
  return !!body && buildsInstructionWithHardcodedId(body);
}

function builtByLocalHardcodedBuilder(tree: Tree, candidates: Node[]): boolean {
  for (const candidate of candidates) {
    let hardcoded = false;
    walk(candidate, n => {
      if (hardcoded) return "skip";
      if (n.type !== "call_expression") return;
      // Bare calls only: a qualified path or method call can't be attributed to a local
      // function by name alone.
      const fn = n.childForFieldName("function");
      if (fn?.type !== "identifier") return;
      if (isLocalInstructionBuilder(tree, n, fn.text)) hardcoded = true;
    });
    if (hardcoded) return true;
  }
  return false;
}

export const arbitraryCpi: Visitor = {
  name: "arbitrary-cpi",
  severity: "critical",
  appliesTo: ["pinocchio"],
  falsePositiveWhen: [
    "program id verified in a helper in another file, outside the submitted text",
    "instruction built by a project-local builder in another file, called via a qualified path or method, sharing its name with another function, or not returning Instruction",
    "program binding name not program-shaped so verification unattributed",
    "instruction flows through match/closure/struct-field bindings untraceable to ::ID",
  ],
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
      const scope = findEnclosingFunctionBody(node);
      if (!scope) return;
      const candidates = candidateInstructionExprs(scope, node);
      if (candidates.some(invokeUsesHardcodedProgramId)) return;
      if (candidates.some(isTrustedBuilderExpr)) return;
      if (builtByLocalHardcodedBuilder(ctx.tree, candidates)) return;
      if (invokeUsesVerifiedProgram(node, verifiedProgramsBefore(scope, node.startIndex))) return;
      if (programAccountVerified(ctx.tree.rootNode, node)) return;
      ctx.output.issues.push({
        severity: "critical",
        rule: "arbitrary-cpi",
        title: `Unverified program in ${name}()`,
        location: formatLocation(ctx.filename, node),
        description: `\`${name}\` is called inside a function that never verifies the target program's address (no \`verify_program_id\` or \`verify_<spl>_program\` call, no hard-coded \`<crate>::ID\`). An attacker can substitute a malicious program and intercept the CPI.`,
        suggestion: `Hard-code the target program ID (e.g. \`&pinocchio_token::ID\`) or call \`verify_token_program(...)\` / \`verify_program_id(<program>, &<EXPECTED_ID>)\` before \`${name}\`.`,
      });
    },
  },
};
