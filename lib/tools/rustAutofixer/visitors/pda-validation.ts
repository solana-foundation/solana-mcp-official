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
  macroIdentifiers,
} from "./_helpers.js";

type Node = Parser.SyntaxNode;

const PDA_DERIVATION_FNS = new Set(["find_program_address", "try_find_program_address", "create_program_address"]);

const PDA_VALIDATE_FNS = new Set(["validate_pda", "verify_pda", "check_pda"]);

const COMPARISON_METHOD_NAMES = new Set(["eq", "ne", "equals", "not_equals"]);

const COMPARISON_MACROS = new Set([
  "assert_eq",
  "assert_ne",
  "debug_assert_eq",
  "debug_assert_ne",
  "require_eq",
  "require_neq",
]);

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
      if (child?.type === "identifier" && !child.text.startsWith("_")) out.push(child.text);
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

function scopeValidatesPda(scope: Node, pdaVars: string[]): boolean {
  if (pdaVars.length === 0) return false;
  let validated = false;

  walk(scope, n => {
    if (validated) return "skip";

    if (n.type === "binary_expression") {
      const op = n.childForFieldName("operator")?.text;
      if (op !== "==" && op !== "!=") return;
      const left = n.childForFieldName("left");
      const right = n.childForFieldName("right");
      if (!left || !right) return;
      if (pdaVars.some(v => containsIdentifier(left, v) || containsIdentifier(right, v))) {
        validated = true;
        return "skip";
      }
    }

    if (n.type === "macro_invocation") {
      const macroName = getMacroName(n);
      if (!macroName || !COMPARISON_MACROS.has(macroName)) return;
      const ids = macroIdentifiers(n);
      if (pdaVars.some(v => ids.includes(v))) {
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
      if (methodName && COMPARISON_METHOD_NAMES.has(methodName)) {
        const receiverRoot = getMethodReceiverRoot(n);
        const argMentions = pdaVars.some(v => containsIdentifier(n, v));
        if ((receiverRoot && pdaVars.includes(receiverRoot)) || argMentions) {
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
  severity: "high",
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
        severity: "high",
        rule: "pda-validation",
        title: `PDA derived but not validated`,
        location: formatLocation(ctx.filename, node),
        description: `\`${name}\` derives a program address but the result is never compared to the account that was passed in. Without that comparison the caller can supply an arbitrary account claiming to be the PDA.`,
        suggestion: `After \`${name}\`, compare the derived key to the account address (\`validate_pda(...)\`, \`assert_eq!(derived, account.key())\`, or \`account.key().ne(&derived.to_bytes())\`) before trusting it.`,
      });
    },
  },
};
