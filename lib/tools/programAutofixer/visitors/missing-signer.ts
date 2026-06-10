import type { Node, Tree } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { findAll, findFirst, getCallName, walk } from "../walk.js";
import {
  bodyContainsSignerValidationFor,
  findFunctionByName,
  getCallArgs,
  isSignerName,
  rejectingKeyCheckAgainst,
  rootIdentifierOf,
} from "./_helpers.js";

function parameterNameAt(fnItem: Node, index: number): string | null {
  const params = fnItem.childForFieldName("parameters");
  if (!params) return null;
  let position = 0;
  for (let i = 0; i < params.namedChildCount; i++) {
    const child = params.namedChild(i);
    if (!child || child.type !== "parameter") continue;
    if (position === index) {
      const pattern = child.childForFieldName("pattern");
      if (!pattern) return null;
      return findFirst(pattern, n => n.type === "identifier")?.text ?? null;
    }
    position++;
  }
  return null;
}

function validatedByLocalHelper(tree: Tree, body: Node, account: string): boolean {
  const calls = findAll(body, n => {
    if (n.type !== "call_expression") return false;
    return getCallArgs(n).some(a => rootIdentifierOf(a) === account);
  });
  for (const call of calls) {
    const fn = call.childForFieldName("function");
    const name = fn ? getCallName(fn) : null;
    if (!name || name === "try_from") continue;
    const localFn = findFunctionByName(tree, name);
    const localBody = localFn?.childForFieldName("body");
    if (!localFn || !localBody) continue;
    const argIndex = getCallArgs(call).findIndex(a => rootIdentifierOf(a) === account);
    const paramName = parameterNameAt(localFn, argIndex);
    if (paramName && bodyContainsSignerValidationFor(localBody, paramName)) return true;
  }
  return false;
}

function pdaDerivedVars(tree: Tree): Set<string> {
  const vars = new Set<string>();
  walk(tree.rootNode, n => {
    if (n.type !== "let_declaration") return;
    const value = n.childForFieldName("value");
    if (!value) return;
    const derives = !!findFirst(value, c => {
      if (c.type !== "call_expression") return false;
      const fn = c.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      return !!name && name.endsWith("program_address");
    });
    if (!derives) return;
    const pattern = n.childForFieldName("pattern");
    if (pattern) walk(pattern, p => void (p.type === "identifier" && vars.add(p.text)));
  });
  return vars;
}

export const missingSigner: Visitor = {
  name: "missing-signer",
  severity: "critical",
  appliesTo: ["pinocchio"],
  before(tree, ctx) {
    // A key compare only waives the signer requirement when the account is compared against a
    // derived PDA (PDAs cannot sign); a compare to an arbitrary constant proves nothing.
    const pdaVars = pdaDerivedVars(tree);
    for (const { body, destructured, implName } of ctx.tryFromBodies) {
      for (const account of destructured) {
        if (!isSignerName(account)) continue;
        if (bodyContainsSignerValidationFor(tree.rootNode, account)) continue;
        if (rejectingKeyCheckAgainst(tree.rootNode, account, pdaVars)) continue;
        if (validatedByLocalHelper(tree, body, account)) continue;
        ctx.output.issues.push({
          severity: "critical",
          rule: "missing-signer",
          title: `Missing signer check for ${account}`,
          location: formatLocation(ctx.filename, body),
          description: `Account \`${account}\` in \`${implName}::try_from\` looks like an authority but has no signer validation. An unsigned account here lets anyone perform the action.`,
          suggestion: `Validate the signer before constructing the struct, e.g. \`if !${account}.is_signer() { return Err(ProgramError::MissingRequiredSignature); }\` or your codebase's single-purpose \`verify_signer(${account})?\` helper.`,
        });
      }
    }
  },
};
