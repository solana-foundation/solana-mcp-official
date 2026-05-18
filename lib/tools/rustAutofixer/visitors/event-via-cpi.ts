import type Parser from "web-tree-sitter";
import type { VisitorContext } from "../types.js";
import type { Visitor } from "../types.js";
import { formatLocation, snippet } from "../types.js";
import { getMacroName } from "./_helpers.js";

type Node = Parser.SyntaxNode;

const LOG_MACROS = new Set(["msg", "log", "sol_log"]);
const EVENT_LOG_HINTS = new Set([
  "burn",
  "close",
  "create",
  "deposit",
  "emit",
  "event",
  "initialize",
  "mint",
  "reward",
  "stake",
  "swap",
  "transfer",
  "unstake",
  "withdraw",
]);

interface EventViaCpiState {
  first: { node: Node; macroName: string } | null;
}

function getState(ctx: VisitorContext): EventViaCpiState {
  const bag = ctx as unknown as { __eventViaCpi?: EventViaCpiState };
  if (!bag.__eventViaCpi) bag.__eventViaCpi = { first: null };
  return bag.__eventViaCpi;
}

function logLooksEventShaped(text: string): boolean {
  const lower = text.toLowerCase();
  for (const hint of EVENT_LOG_HINTS) {
    if (lower.includes(hint)) return true;
  }
  return false;
}

export const eventViaCpi: Visitor = {
  name: "event-via-cpi",
  severity: "low",
  appliesTo: ["pinocchio"],
  enter: {
    macro_invocation(node, ctx) {
      const name = getMacroName(node);
      if (!name || !LOG_MACROS.has(name)) return;
      if (!logLooksEventShaped(node.text)) return;
      const state = getState(ctx);
      if (state.first) return;
      state.first = { node, macroName: name };
    },
  },
  after(ctx) {
    const state = getState(ctx);
    if (!state.first) return;
    const { macroName, node } = state.first;
    ctx.output.issues.push({
      severity: "low",
      rule: "event-via-cpi",
      title: `Event-shaped log emitted via \`${macroName}!\` may be truncated`,
      location: formatLocation(ctx.filename, node),
      description: `Program logs are truncated when transactions exceed log limits. Event-shaped logs should be emitted via a self-CPI so downstream consumers can read them from instruction data, not best-effort logs.`,
      suggestion: `Replace event-shaped \`${macroName}!(...)\` calls with \`emit_event(program_id, event_authority, program, &event_data)?\` (or your program's event CPI helper). Keep diagnostic logs as plain logs.`,
      code_snippet: snippet(ctx.source, node, 80),
    });
  },
};
