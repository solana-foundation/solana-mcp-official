import type { Node } from "web-tree-sitter";
import type { Visitor, VisitorContext } from "../types.js";
import { formatLocation } from "../types.js";
import { findFirst, getCallName, walk } from "../walk.js";
import {
  FROM_BYTES_NAMES,
  OWNER_MARKERS,
  VERIFY_OWNER_CALLS,
  bodyContainsRejectingCheckFor,
  bodyContainsVerifyFor,
  containsIdentifier,
  findEnclosingFunctionBody,
  findFunctionByName,
  getCallArgs,
  isFromBytesCall,
  precedingCallsContain,
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

const DATA_BORROW_METHODS = new Set([
  "data",
  "borrow_data",
  "try_borrow_data",
  "borrow_mut_data",
  "try_borrow_mut_data",
  "borrow_data_unchecked",
  "borrow_mut_data_unchecked",
]);

function isAccountNameNode(n: Node): boolean {
  if (n.type === "identifier") return !FROM_BYTES_NAMES.has(n.text);
  if (n.type === "field_identifier") return !DATA_BORROW_METHODS.has(n.text) && !FROM_BYTES_NAMES.has(n.text);
  return false;
}

function dataBufferAliasSources(scope: Node, bufferName: string): string[] {
  const sources: string[] = [];
  walk(scope, n => {
    if (n.type !== "let_declaration") return;
    const pattern = n.childForFieldName("pattern");
    const bound = pattern ? findFirst(pattern, x => x.type === "identifier")?.text : null;
    if (bound !== bufferName) return;
    const value = n.childForFieldName("value");
    if (!value) return;
    walk(value, v => {
      if (isAccountNameNode(v) && v.text !== bufferName) sources.push(v.text);
    });
  });
  return sources;
}

function fromBytesAccountCandidates(node: Node, scope: Node): string[] {
  const candidates = new Set<string>();
  const arg = getCallArgs(node)[0];
  if (arg) {
    walk(arg, n => {
      if (isAccountNameNode(n)) candidates.add(n.text);
    });
  }
  for (const name of [...candidates]) {
    for (const source of dataBufferAliasSources(scope, name)) candidates.add(source);
  }
  return [...candidates];
}

export function fromBytesTargetValidated(
  node: Node,
  ctx: VisitorContext,
  calls: ReadonlySet<string>,
  markers: readonly string[],
): boolean {
  const scope = findEnclosingFunctionBody(node);
  if (!scope) return true;
  const candidates = fromBytesAccountCandidates(node, scope);
  for (const candidate of candidates) {
    // Same function: the check must precede the deserialization sink.
    if (precedingCallsContain(scope, node, calls, candidate)) return true;
    if (bodyContainsRejectingCheckFor(scope, candidate, markers, node.startIndex)) return true;
    if (accountCreatedEarlierIn(scope, node, candidate)) return true;
    // A separate try_from body runs before the processing function, so position is irrelevant.
    for (const tf of ctx.tryFromBodies) {
      if (tf.body.id === scope.id) continue;
      if (bodyContainsVerifyFor(tf.body, calls, candidate)) return true;
      if (bodyContainsRejectingCheckFor(tf.body, candidate, markers)) return true;
    }
  }
  return localFromBytesImplChecks(node, markers);
}

export const missingOwner: Visitor = {
  name: "missing-owner",
  severity: "high",
  appliesTo: ["pinocchio"],
  enter: {
    call_expression(node, ctx) {
      const info = isFromBytesCall(node);
      if (!info || !info.receiver) return;
      if (fromBytesTargetValidated(node, ctx, VERIFY_OWNER_CALLS, OWNER_MARKERS)) return;
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
