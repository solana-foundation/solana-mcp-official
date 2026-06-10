import type { Node } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { getCallName, walk } from "../walk.js";
import {
  KEY_MARKERS,
  bodyContainsRejectingCheckFor,
  getCallArgs,
  isProgramAccountName,
  rootIdentifierOf,
} from "./_helpers.js";

const PROGRAM_VERIFY_NAME_RE = /^(verify|check|assert)_.*program/;
const EXTRA_PROGRAM_VERIFY_NAMES = new Set(["check_id", "check_program_id", "assert_program_id", "verify_program"]);

function fileContainsProgramVerifyFor(root: Node, account: string): boolean {
  let found = false;
  walk(root, n => {
    if (found) return "skip";
    if (n.type !== "call_expression") return;
    const fn = n.childForFieldName("function");
    const name = fn ? getCallName(fn) : null;
    if (!name) return;
    if (!PROGRAM_VERIFY_NAME_RE.test(name) && !EXTRA_PROGRAM_VERIFY_NAMES.has(name)) return;
    if (getCallArgs(n).some(a => rootIdentifierOf(a) === account)) found = true;
  });
  return found;
}

export const programIdVerification: Visitor = {
  name: "program-id-verification",
  severity: "low",
  appliesTo: ["pinocchio"],
  before(tree, ctx) {
    for (const { body, destructured, implName } of ctx.tryFromBodies) {
      for (const account of destructured) {
        if (!isProgramAccountName(account)) continue;
        if (fileContainsProgramVerifyFor(tree.rootNode, account)) continue;
        if (bodyContainsRejectingCheckFor(tree.rootNode, account, KEY_MARKERS)) continue;
        ctx.output.issues.push({
          severity: "low",
          rule: "program-id-verification",
          title: `Program account ${account} not verified by address`,
          location: formatLocation(ctx.filename, body),
          description: `\`${implName}::try_from\` accepts \`${account}\` without comparing its address to the canonical program ID.`,
          suggestion: `If instructions are built with a caller-supplied program id, compare \`${account}.key()\` against the canonical ID (e.g. \`if ${account}.key() != &pinocchio_system::ID { return Err(...); }\`). This is usually harmless with pinocchio CPI wrappers, which hardcode the program ID.`,
        });
      }
    }
  },
};
