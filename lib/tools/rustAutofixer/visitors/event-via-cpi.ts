import type { Visitor } from "../types.js";
import { formatLocation, snippet } from "../types.js";
import { getMacroName } from "./_helpers.js";

const LOG_MACROS = new Set(["msg", "log", "sol_log"]);

export const eventViaCpi: Visitor = {
  name: "event-via-cpi",
  severity: "low",
  appliesTo: ["pinocchio"],
  enter: {
    macro_invocation(node, ctx) {
      const name = getMacroName(node);
      if (!name || !LOG_MACROS.has(name)) return;
      ctx.output.issues.push({
        severity: "low",
        rule: "event-via-cpi",
        title: `Event emitted via \`${name}!\` may be truncated`,
        location: formatLocation(ctx.filename, node),
        description: `Program logs are truncated when transactions exceed log limits. Important events should be emitted via a self-CPI so downstream consumers can read them from instruction data, not best-effort logs.`,
        suggestion: `Replace \`${name}!(...)\` with \`emit_event(program_id, event_authority, program, &event_data)?\` (or your program's event CPI helper) for events consumers need to observe reliably.`,
        code_snippet: snippet(ctx.source, node, 80),
      });
    },
  },
};
