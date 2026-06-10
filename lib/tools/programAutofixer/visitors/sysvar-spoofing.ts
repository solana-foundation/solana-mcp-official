import type { Node } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { getCallName, walk } from "../walk.js";
import {
  KEY_MARKERS,
  SYSVAR_VERIFY_CALLS,
  bodyContainsRejectingCheckFor,
  bodyContainsVerifyFor,
  getCallArgs,
  getMethodCallName,
  getMethodReceiverRoot,
  rootIdentifierOf,
} from "./_helpers.js";

const SYSVAR_NAMES = new Set([
  "sysvar",
  "rent",
  "clock",
  "epoch_schedule",
  "stake_history",
  "slot_hashes",
  "instructions_sysvar",
]);

const VALIDATING_CONSTRUCTORS = new Set(["from_account_view", "from_account_info"]);

const DATA_ACCESS_METHODS = new Set(["data", "try_borrow_data"]);

function isSysvarAccountName(name: string): boolean {
  const lower = name.toLowerCase();
  return SYSVAR_NAMES.has(lower) || lower.endsWith("_sysvar");
}

function firstArgRoot(call: Node): string | null {
  const args = getCallArgs(call);
  return args.length > 0 ? rootIdentifierOf(args[0]) : null;
}

function fileHasValidatingConstructorFor(root: Node, account: string): boolean {
  let found = false;
  walk(root, n => {
    if (found) return "skip";
    if (n.type !== "call_expression") return;
    const fn = n.childForFieldName("function");
    const name = fn ? getCallName(fn) : null;
    if (name && VALIDATING_CONSTRUCTORS.has(name) && firstArgRoot(n) === account) found = true;
  });
  return found;
}

function accountDataConsumed(root: Node, account: string): boolean {
  let found = false;
  walk(root, n => {
    if (found) return "skip";
    if (n.type !== "call_expression") return;
    const fn = n.childForFieldName("function");
    const name = fn ? getCallName(fn) : null;
    if (name?.startsWith("from_account") && firstArgRoot(n) === account) {
      found = true;
      return;
    }
    const method = getMethodCallName(n);
    if (method && DATA_ACCESS_METHODS.has(method) && getMethodReceiverRoot(n) === account) found = true;
  });
  return found;
}

export const sysvarSpoofing: Visitor = {
  name: "sysvar-spoofing",
  severity: "medium",
  appliesTo: ["pinocchio"],
  before(tree, ctx) {
    for (const { destructured, body, implName } of ctx.tryFromBodies) {
      for (const account of destructured) {
        if (!isSysvarAccountName(account)) continue;
        if (!accountDataConsumed(tree.rootNode, account)) continue;
        if (bodyContainsVerifyFor(tree.rootNode, SYSVAR_VERIFY_CALLS, account)) continue;
        if (fileHasValidatingConstructorFor(tree.rootNode, account)) continue;
        if (bodyContainsRejectingCheckFor(tree.rootNode, account, KEY_MARKERS)) continue;
        ctx.output.issues.push({
          severity: "medium",
          rule: "sysvar-spoofing",
          title: `Sysvar account ${account} not verified`,
          location: formatLocation(ctx.filename, body),
          description: `\`${implName}::try_from\` accepts \`${account}\` as a sysvar without comparing its address to the known sysvar ID, and the account's data is read. Any account can be passed and read as a sysvar.`,
          suggestion: `Add \`verify_sysvar(${account}, &<Sysvar>::id())?;\`, compare \`${account}.key()\` to the sysvar ID, or construct via \`<Sysvar>::from_account_view(${account})\` which validates the key internally.`,
        });
      }
    }
  },
};
