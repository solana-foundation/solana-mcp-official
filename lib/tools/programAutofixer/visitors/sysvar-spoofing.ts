import type { Visitor } from "../types.js";
import { formatLocation } from "../types.js";
import { SYSVAR_VERIFY_CALLS, bodyContainsVerifyFor } from "./_helpers.js";

const SYSVAR_NAMES = new Set([
  "sysvar",
  "rent",
  "clock",
  "epoch_schedule",
  "stake_history",
  "slot_hashes",
  "instructions_sysvar",
]);

function isSysvarAccountName(name: string): boolean {
  const lower = name.toLowerCase();
  return SYSVAR_NAMES.has(lower) || lower.endsWith("_sysvar");
}

export const sysvarSpoofing: Visitor = {
  name: "sysvar-spoofing",
  severity: "high",
  appliesTo: ["pinocchio"],
  after(ctx) {
    for (const { body, destructured, implName } of ctx.tryFromBodies) {
      for (const account of destructured) {
        if (!isSysvarAccountName(account)) continue;
        if (bodyContainsVerifyFor(body, SYSVAR_VERIFY_CALLS, account)) continue;
        ctx.output.issues.push({
          severity: "high",
          rule: "sysvar-spoofing",
          title: `Sysvar account ${account} not verified`,
          location: formatLocation(ctx.filename, body),
          description: `\`${implName}::try_from\` accepts \`${account}\` as a sysvar without comparing its address to the known sysvar ID. Any account can be passed and read as a sysvar.`,
          suggestion: `Add \`verify_sysvar(${account}, &<Sysvar>::id())?;\` (or use a sysvar accessor that performs the check) inside \`try_from\`.`,
        });
      }
    }
  },
};
