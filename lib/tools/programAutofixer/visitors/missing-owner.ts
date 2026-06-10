import type { Node } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { findFirst, getCallName, walk } from "../walk.js";
import {
  OWNER_MARKERS,
  VERIFY_OWNER_CALLS,
  bodyContainsRejectingCheckFor,
  bodyContainsVerifyFor,
  containsIdentifier,
  findEnclosingFunctionBody,
  findFunctionByName,
  getCallArgs,
  isFromBytesCall,
  rootIdentifierOf,
} from "./_helpers.js";

const CREATION_STRUCTS = new Set(["CreateAccount", "CreateAccountWithSeed", "Allocate", "Assign"]);

function structExpressionName(node: Node): string | null {
  const name = node.childForFieldName("name");
  if (!name) return null;
  if (name.type === "scoped_type_identifier") return name.childForFieldName("name")?.text ?? null;
  return name.text;
}

export function accountCreatedEarlierIn(scope: Node, target: Node, account: string): boolean {
  let found = false;
  walk(scope, n => {
    if (found) return "skip";
    if (n.startIndex >= target.startIndex) return "skip";
    if (n.type === "struct_expression") {
      const name = structExpressionName(n);
      if (name && CREATION_STRUCTS.has(name) && containsIdentifier(n, account)) found = true;
      return;
    }
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      if (name && name.toLowerCase().includes("create") && getCallArgs(n).some(a => rootIdentifierOf(a) === account)) {
        found = true;
      }
    }
  });
  return found;
}

export function localFromBytesImplChecks(node: Node, markers: readonly string[]): boolean {
  const fn = node.childForFieldName("function");
  const name = fn ? getCallName(fn) : null;
  if (!name) return false;
  const localFn = findFunctionByName(node.tree, name);
  const body = localFn?.childForFieldName("body");
  if (!localFn || !body) return false;
  const params = localFn.childForFieldName("parameters");
  if (!params) return false;
  for (let i = 0; i < params.namedChildCount; i++) {
    const param = params.namedChild(i);
    if (!param || param.type !== "parameter") continue;
    const pattern = param.childForFieldName("pattern");
    const paramName = pattern ? findFirst(pattern, n => n.type === "identifier")?.text : null;
    if (paramName && bodyContainsRejectingCheckFor(body, paramName, markers)) return true;
  }
  return false;
}

export const missingOwner: Visitor = {
  name: "missing-owner",
  severity: "high",
  appliesTo: ["pinocchio"],
  enter: {
    call_expression(node, ctx) {
      const info = isFromBytesCall(node);
      if (!info || !info.receiver) return;
      const scope = findEnclosingFunctionBody(node);
      if (!scope) return;
      const root = node.tree.rootNode;
      if (bodyContainsVerifyFor(root, VERIFY_OWNER_CALLS, info.receiver)) return;
      if (bodyContainsRejectingCheckFor(root, info.receiver, OWNER_MARKERS)) return;
      if (localFromBytesImplChecks(node, OWNER_MARKERS)) return;
      if (accountCreatedEarlierIn(scope, node, info.receiver)) return;
      ctx.output.issues.push({
        severity: "high",
        rule: "missing-owner",
        title: `Deserialization of ${info.receiver} without ownership check`,
        location: formatLocation(ctx.filename, node),
        description: `\`from_bytes\` is called on \`${info.receiver}\` without a preceding \`verify_owned_by(${info.receiver}, &crate::ID)\` (or \`verify_current_program_account\`). Type-cosplay attack: a malicious account owned by another program can be deserialized as our state.`,
        suggestion: `Insert \`verify_current_program_account(${info.receiver})?;\` (or \`verify_owned_by(${info.receiver}, &crate::ID)?;\`) before deserializing.`,
      });
    },
  },
};
