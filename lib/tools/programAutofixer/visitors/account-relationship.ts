import type { Node } from "web-tree-sitter";
import type { Visitor, VisitorContext } from "../types.js";
import { formatLocation } from "../types.js";
import { walk } from "../walk.js";
import { getCallName } from "../walk.js";
import { findEnclosingFunctionBody, getMacroName, getMethodCallName, macroIdentifiers } from "./_helpers.js";

const TRANSFER_STRUCT_TYPES = new Set(["TransferChecked", "Transfer", "Burn", "MintTo", "Approve"]);
const RELATIONSHIP_CHECK_FNS = new Set([
  "validate_associated_token_account",
  "verify_associated_token_account",
  "check_associated_token_account",
  "validate_token_account",
  "verify_token_account",
  "verify_mint",
]);
const RELATIONSHIP_MARKERS = ["mint", "owner"];
const CHECK_MACROS = new Set([
  "assert",
  "assert_eq",
  "assert_ne",
  "require",
  "require_eq",
  "require_neq",
  "require_keys_eq",
  "require_keys_neq",
]);
const PDA_DERIVE_FNS = new Set(["find_program_address", "try_find_program_address", "create_program_address"]);

interface RelationshipState {
  inlineChecked: boolean;
  pdaDerived: boolean;
}

function getState(ctx: VisitorContext): RelationshipState {
  const bag = ctx as unknown as { __accountRelationship?: RelationshipState };
  if (!bag.__accountRelationship) bag.__accountRelationship = { inlineChecked: false, pdaDerived: false };
  return bag.__accountRelationship;
}

function nodeRejects(node: Node): boolean {
  let found = false;
  walk(node, n => {
    if (found) return "skip";
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function");
      if (fn && getCallName(fn) === "Err") {
        found = true;
        return "skip";
      }
    }
    if (n.type === "macro_invocation") {
      const name = getMacroName(n);
      if (name === "err" || name === "require") {
        found = true;
        return "skip";
      }
    }
  });
  return found;
}

function mentionsRelationshipMarker(node: Node): boolean {
  let found = false;
  walk(node, n => {
    if (found) return "skip";
    if (n.type === "identifier" || n.type === "field_identifier") {
      const text = n.text.toLowerCase();
      if (RELATIONSHIP_MARKERS.some(m => text.includes(m))) found = true;
    }
  });
  return found;
}

function structFieldNames(node: Node): Set<string> {
  const out = new Set<string>();
  const list = node.namedChild(1);
  if (!list || list.type !== "field_initializer_list") return out;
  for (let i = 0; i < list.namedChildCount; i++) {
    const init = list.namedChild(i);
    if (!init) continue;
    if (init.type === "field_initializer") {
      const name = init.namedChild(0);
      if (name) out.add(name.text);
    }
    if (init.type === "shorthand_field_initializer") {
      const name = init.namedChild(0);
      if (name) out.add(name.text);
    }
  }
  return out;
}

function isTransferishStruct(node: Node): { name: string } | null {
  if (node.type !== "struct_expression") return null;
  const head = node.namedChild(0);
  if (!head) return null;
  let tail: string | null = null;
  if (head.type === "type_identifier") tail = head.text;
  else if (head.type === "scoped_type_identifier" || head.type === "scoped_identifier") {
    const last = head.namedChild(head.namedChildCount - 1);
    tail = last?.text ?? null;
  }
  if (!tail || !TRANSFER_STRUCT_TYPES.has(tail)) return null;
  if (tail === "Transfer") {
    if (head.text.toLowerCase().includes("system")) return null;
    const fields = structFieldNames(node);
    if (fields.has("lamports")) return null;
    const tokenShaped = fields.has("mint") || fields.has("authority") || (fields.has("from") && fields.has("to"));
    if (!tokenShaped) return null;
  }
  return { name: tail };
}

function scopeHasRelationshipCheck(scope: Node): boolean {
  let found = false;
  walk(scope, n => {
    if (found) return "skip";
    if (n.type !== "call_expression") return;
    const fn = n.childForFieldName("function");
    const callName = fn ? getCallName(fn) : null;
    if (callName && RELATIONSHIP_CHECK_FNS.has(callName)) {
      found = true;
      return "skip";
    }
    const methodName = getMethodCallName(n);
    if (methodName && RELATIONSHIP_CHECK_FNS.has(methodName)) {
      found = true;
      return "skip";
    }
  });
  return found;
}

export const accountRelationship: Visitor = {
  name: "account-relationship",
  severity: "low",
  appliesTo: ["pinocchio"],
  before(tree, ctx) {
    const state = getState(ctx);
    walk(tree.rootNode, n => {
      if (state.inlineChecked && state.pdaDerived) return "skip";
      if (n.type === "if_expression") {
        const condition = n.childForFieldName("condition") ?? n.namedChild(0);
        const consequence = n.childForFieldName("consequence");
        if (condition && consequence && mentionsRelationshipMarker(condition) && nodeRejects(consequence)) {
          state.inlineChecked = true;
        }
        return;
      }
      if (n.type === "macro_invocation") {
        const name = getMacroName(n);
        if (
          name &&
          CHECK_MACROS.has(name) &&
          macroIdentifiers(n).some(id => RELATIONSHIP_MARKERS.some(m => id.toLowerCase().includes(m)))
        ) {
          state.inlineChecked = true;
        }
        return;
      }
      if (n.type === "call_expression") {
        const fn = n.childForFieldName("function");
        const name = fn ? getCallName(fn) : null;
        if (name && PDA_DERIVE_FNS.has(name)) state.pdaDerived = true;
      }
    });
  },
  enter: {
    struct_expression(node, ctx) {
      const info = isTransferishStruct(node);
      if (!info) return;
      const state = getState(ctx);
      if (state.inlineChecked || state.pdaDerived) return;
      const scope = findEnclosingFunctionBody(node);
      if (!scope) return;
      if (scopeHasRelationshipCheck(scope)) return;
      ctx.output.issues.push({
        severity: "low",
        rule: "account-relationship",
        title: `${info.name} CPI without relationship validation`,
        location: formatLocation(ctx.filename, node),
        description: `\`${info.name}\` is invoked but no \`validate_associated_token_account\` / \`verify_token_account\` / \`verify_mint\` call (or inline mint/owner comparison) appears in this file. Token accounts must be tied to the expected wallet+mint; otherwise an attacker can supply an arbitrary mint and drain the wrong account.`,
        suggestion: `Before invoking ${info.name}, validate that the token account belongs to the expected wallet and mint via \`validate_associated_token_account(token_account, expected_wallet, expected_mint, token_program)?;\` or an explicit \`token_account.mint() == expected_mint.key()\` guard.`,
      });
    },
  },
};
