import type Parser from "web-tree-sitter";
import type { Visitor, VisitorContext } from "../types.js";
import { formatLocation } from "../types.js";
import { walk } from "../walk.js";
import {
  VERIFY_SIGNER_CALLS,
  containsIdentifier,
  getCallArgs,
  getMacroName,
  getMethodCallName,
  getMethodReceiverRoot,
  isSignerName,
  macroIdentifiers,
  rootIdentifierOf,
} from "./_helpers.js";

type Node = Parser.SyntaxNode;

const AUTHORIZATION_METHODS = new Set(["eq", "ne", "equals", "not_equals"]);

const AUTHORIZATION_MACROS = new Set([
  "assert_eq",
  "assert_ne",
  "debug_assert_eq",
  "debug_assert_ne",
  "require_eq",
  "require_neq",
  "require_keys_eq",
]);

interface VerifiedSigner {
  name: string;
  body: Node;
  implName: string;
}

interface SignerNecessityState {
  verifiedSigners: VerifiedSigner[];
  used: Set<string>;
}

function findVerifiedSigners(body: Node): string[] {
  const verified: string[] = [];
  walk(body, n => {
    if (n.type !== "call_expression") return;
    const fnNode = n.childForFieldName("function");
    const fnName = fnNode ? (fnNode.lastChild?.text ?? fnNode.text) : null;
    if (!fnName || !VERIFY_SIGNER_CALLS.has(fnName)) return;
    const args = getCallArgs(n);
    if (args.length === 0) return;
    const root = rootIdentifierOf(args[0]);
    if (root) verified.push(root);
  });
  return verified;
}

function getState(ctx: VisitorContext): SignerNecessityState {
  const bag = ctx as unknown as { __signerNecessity?: SignerNecessityState };
  if (!bag.__signerNecessity) {
    bag.__signerNecessity = { verifiedSigners: [], used: new Set<string>() };
  }
  return bag.__signerNecessity;
}

function isInsideAnyVerifyBody(node: Node, signers: VerifiedSigner[]): boolean {
  return signers.some(s => node.startIndex >= s.body.startIndex && node.endIndex <= s.body.endIndex);
}

export const signerNecessity: Visitor = {
  name: "signer-necessity",
  severity: "medium",
  appliesTo: ["pinocchio"],
  before(_tree, ctx) {
    const state = getState(ctx);
    for (const { body, implName } of ctx.tryFromBodies) {
      for (const account of findVerifiedSigners(body)) {
        if (!isSignerName(account)) continue;
        state.verifiedSigners.push({ name: account, body, implName });
      }
    }
  },
  enter: {
    binary_expression(node, ctx) {
      const state = getState(ctx);
      if (state.verifiedSigners.length === 0) return;
      if (isInsideAnyVerifyBody(node, state.verifiedSigners)) return;
      const op = node.childForFieldName("operator")?.text;
      if (op !== "==" && op !== "!=") return;
      const left = node.childForFieldName("left");
      const right = node.childForFieldName("right");
      if (!left || !right) return;
      for (const s of state.verifiedSigners) {
        if (containsIdentifier(left, s.name) || containsIdentifier(right, s.name)) state.used.add(s.name);
      }
    },
    macro_invocation(node, ctx) {
      const state = getState(ctx);
      if (state.verifiedSigners.length === 0) return;
      if (isInsideAnyVerifyBody(node, state.verifiedSigners)) return;
      const name = getMacroName(node);
      if (!name || !AUTHORIZATION_MACROS.has(name)) return;
      const ids = macroIdentifiers(node);
      for (const s of state.verifiedSigners) {
        if (ids.includes(s.name)) state.used.add(s.name);
      }
    },
    call_expression(node, ctx) {
      const state = getState(ctx);
      if (state.verifiedSigners.length === 0) return;
      if (isInsideAnyVerifyBody(node, state.verifiedSigners)) return;
      const methodName = getMethodCallName(node);
      if (!methodName || !AUTHORIZATION_METHODS.has(methodName)) return;
      const receiverRoot = getMethodReceiverRoot(node);
      const args = getCallArgs(node);
      for (const s of state.verifiedSigners) {
        if (receiverRoot === s.name) state.used.add(s.name);
        else if (args.some(a => containsIdentifier(a, s.name))) state.used.add(s.name);
      }
    },
  },
  after(ctx) {
    const state = getState(ctx);
    for (const s of state.verifiedSigners) {
      if (state.used.has(s.name)) continue;
      ctx.output.issues.push({
        severity: "medium",
        rule: "signer-necessity",
        title: `Signer ${s.name} appears unused for authorization`,
        location: formatLocation(ctx.filename, s.body),
        description: `\`verify_signer(${s.name}, ...)\` is called in \`${s.implName}::try_from\` but the variable is never compared against a stored authority (no \`==\` / \`!=\`, \`.eq()\` / \`.ne()\`, or \`assert_eq!\` involving \`${s.name}\`) anywhere else in the file.`,
        suggestion: `Inside the processor, compare \`${s.name}.address()\` to the expected authority (e.g. \`state.admin\`). If not needed, drop the signer requirement.`,
      });
    }
  },
};
