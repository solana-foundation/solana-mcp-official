import type { Node, Tree } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { findAll, findFirst, getCallName } from "../walk.js";
import {
  KEY_MARKERS,
  bodyContainsRejectingCheckFor,
  bodyContainsSignerValidationFor,
  findFunctionByName,
  getCallArgs,
  isSignerName,
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

export const missingSigner: Visitor = {
  name: "missing-signer",
  severity: "critical",
  appliesTo: ["pinocchio"],
  before(tree, ctx) {
    for (const { body, destructured, implName } of ctx.tryFromBodies) {
      for (const account of destructured) {
        if (!isSignerName(account)) continue;
        if (bodyContainsSignerValidationFor(tree.rootNode, account)) continue;
        if (bodyContainsRejectingCheckFor(tree.rootNode, account, KEY_MARKERS)) continue;
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
