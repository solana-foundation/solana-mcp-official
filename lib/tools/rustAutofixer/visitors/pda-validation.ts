import type Parser from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { getCallName, walk } from "../walk.js";
import {
  containsIdentifier,
  findEnclosingFunctionBody,
  getMacroName,
  getMethodCallName,
  getMethodReceiverRoot,
} from "./_helpers.js";

type Node = Parser.SyntaxNode;

const PDA_DERIVATION_FNS = new Set(["find_program_address", "try_find_program_address", "create_program_address"]);

const PDA_VALIDATE_FNS = new Set(["validate_pda", "verify_pda", "check_pda"]);

const POSITIVE_COMPARISON_METHOD_NAMES = new Set(["eq", "equals"]);
const NEGATIVE_COMPARISON_METHOD_NAMES = new Set(["ne", "not_equals"]);

const POSITIVE_COMPARISON_MACROS = new Set(["assert_eq", "debug_assert_eq", "require_eq"]);
const ACCOUNT_IDENTITY_METHODS = new Set(["key", "address", "pubkey"]);
const ACCOUNT_IDENTITY_FIELDS = new Set(["key", "address", "pubkey"]);

function pdaVarsFromLet(letNode: Node, derivationCall: Node): string[] {
  const value = letNode.childForFieldName("value");
  if (!value) return [];
  if (!nodeContainsExact(value, derivationCall)) return [];
  const pattern = letNode.childForFieldName("pattern");
  if (!pattern) return [];
  const out: string[] = [];
  if (pattern.type === "tuple_pattern") {
    for (let i = 0; i < pattern.namedChildCount; i++) {
      const child = pattern.namedChild(i);
      if (child?.type === "identifier" && !child.text.startsWith("_")) {
        out.push(child.text);
        break;
      }
    }
  } else if (pattern.type === "identifier") {
    out.push(pattern.text);
  }
  return out;
}

function nodeContainsExact(haystack: Node, needle: Node): boolean {
  let hit = false;
  walk(haystack, n => {
    if (hit) return "skip";
    if (n.startIndex === needle.startIndex && n.endIndex === needle.endIndex && n.type === needle.type) {
      hit = true;
      return "skip";
    }
  });
  return hit;
}

function findEnclosingLet(node: Node): Node | null {
  let cursor: Node | null = node.parent;
  while (cursor) {
    if (cursor.type === "let_declaration") return cursor;
    cursor = cursor.parent;
  }
  return null;
}

function branchReturnsErr(ifNode: Node): boolean {
  const consequence = ifNode.childForFieldName("consequence");
  if (!consequence) return false;
  let found = false;
  walk(consequence, n => {
    if (found) return "skip";
    if (n.type !== "return_expression") return;
    walk(n, child => {
      if (found) return "skip";
      if (child.type !== "call_expression") return;
      const fn = child.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      if (name === "Err") {
        found = true;
        return "skip";
      }
    });
  });
  return found;
}

function isRejectingGuard(node: Node): boolean {
  let cursor: Node | null = node.parent;
  while (cursor) {
    if (cursor.type === "if_expression") {
      const condition = cursor.childForFieldName("condition") ?? cursor.namedChild(0);
      return !!condition && nodeContainsExact(condition, node) && branchReturnsErr(cursor);
    }
    cursor = cursor.parent;
  }
  return false;
}

function mentionsAnyIdentifier(node: Node, targets: readonly string[]): boolean {
  return targets.some(v => containsIdentifier(node, v));
}

function containsAccountIdentityMarker(node: Node): boolean {
  let found = false;
  walk(node, n => {
    if (found) return "skip";
    if (n.type === "call_expression") {
      const methodName = getMethodCallName(n);
      if (methodName && ACCOUNT_IDENTITY_METHODS.has(methodName)) {
        found = true;
        return "skip";
      }
    }
    if ((n.type === "field_identifier" || n.type === "identifier") && ACCOUNT_IDENTITY_FIELDS.has(n.text)) {
      found = true;
      return "skip";
    }
  });
  return found;
}

function looksLikeAccountIdentity(node: Node, pdaVars: readonly string[]): boolean {
  return !mentionsAnyIdentifier(node, pdaVars) && containsAccountIdentityMarker(node);
}

function binaryComparesPdaWithAccountIdentity(node: Node, pdaVars: readonly string[]): boolean {
  const left = node.childForFieldName("left");
  const right = node.childForFieldName("right");
  if (!left || !right) return false;
  const leftMentionsPda = mentionsAnyIdentifier(left, pdaVars);
  const rightMentionsPda = mentionsAnyIdentifier(right, pdaVars);
  if (leftMentionsPda === rightMentionsPda) return false;
  return leftMentionsPda ? looksLikeAccountIdentity(right, pdaVars) : looksLikeAccountIdentity(left, pdaVars);
}

function macroComparesPdaWithAccountIdentity(node: Node, pdaVars: readonly string[]): boolean {
  if (!mentionsAnyIdentifier(node, pdaVars)) return false;
  return containsAccountIdentityMarker(node);
}

function methodReceiverValue(callNode: Node): Node | null {
  const fn = callNode.childForFieldName("function");
  if (!fn || fn.type !== "field_expression") return null;
  return fn.childForFieldName("value");
}

function methodComparesPdaWithAccountIdentity(node: Node, pdaVars: readonly string[]): boolean {
  const receiver = methodReceiverValue(node);
  if (!receiver) return false;
  const receiverMentionsPda = mentionsAnyIdentifier(receiver, pdaVars);
  const argsMentionPda = pdaVars.some(v => containsIdentifier(node, v)) && !receiverMentionsPda;
  if (receiverMentionsPda) {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child && looksLikeAccountIdentity(child, pdaVars)) return true;
    }
    return false;
  }
  return argsMentionPda && looksLikeAccountIdentity(receiver, pdaVars);
}

function scopeValidatesPda(scope: Node, pdaVars: string[]): boolean {
  if (pdaVars.length === 0) return false;
  let validated = false;

  walk(scope, n => {
    if (validated) return "skip";

    if (n.type === "binary_expression") {
      const op = n.childForFieldName("operator")?.text;
      if (op !== "==" && op !== "!=") return;
      if (op === "==" && binaryComparesPdaWithAccountIdentity(n, pdaVars)) {
        validated = true;
        return "skip";
      }
      if (op === "!=" && isRejectingGuard(n) && binaryComparesPdaWithAccountIdentity(n, pdaVars)) {
        validated = true;
        return "skip";
      }
    }

    if (n.type === "macro_invocation") {
      const macroName = getMacroName(n);
      if (!macroName || !POSITIVE_COMPARISON_MACROS.has(macroName)) return;
      if (macroComparesPdaWithAccountIdentity(n, pdaVars)) {
        validated = true;
        return "skip";
      }
    }

    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      if (name && PDA_VALIDATE_FNS.has(name)) {
        const receiverRoot = getMethodReceiverRoot(n);
        if (pdaVars.some(v => receiverRoot === v || containsIdentifier(n, v))) {
          validated = true;
          return "skip";
        }
      }
      const methodName = getMethodCallName(n);
      if (methodName && POSITIVE_COMPARISON_METHOD_NAMES.has(methodName)) {
        if (methodComparesPdaWithAccountIdentity(n, pdaVars)) {
          validated = true;
          return "skip";
        }
      }
      if (methodName && NEGATIVE_COMPARISON_METHOD_NAMES.has(methodName) && isRejectingGuard(n)) {
        if (methodComparesPdaWithAccountIdentity(n, pdaVars)) {
          validated = true;
          return "skip";
        }
      }
    }
  });

  return validated;
}

export const pdaValidation: Visitor = {
  name: "pda-validation",
  severity: "critical",
  appliesTo: ["pinocchio"],
  enter: {
    call_expression(node, ctx) {
      const fn = node.childForFieldName("function");
      const name = fn ? getCallName(fn) : null;
      if (!name || !PDA_DERIVATION_FNS.has(name)) return;

      const letNode = findEnclosingLet(node);
      const pdaVars = letNode ? pdaVarsFromLet(letNode, node) : [];
      const scope = findEnclosingFunctionBody(node);
      if (!scope) return;

      if (pdaVars.length > 0 && scopeValidatesPda(scope, pdaVars)) return;

      ctx.output.issues.push({
        severity: "critical",
        rule: "pda-validation",
        title: `PDA derived but not validated`,
        location: formatLocation(ctx.filename, node),
        description: `\`${name}\` derives a program address but the result is never compared to the account that was passed in. Without that comparison the caller can supply an arbitrary account claiming to be the PDA.`,
        suggestion: `After \`${name}\`, compare the derived key to the account address (\`validate_pda(...)\`, \`assert_eq!(derived, account.key())\`, or \`account.key().ne(&derived.to_bytes())\`) before trusting it.`,
      });
    },
  },
};
