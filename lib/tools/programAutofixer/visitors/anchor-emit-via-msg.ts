import type { Visitor } from "../types.js";
import { formatLocation, snippet } from "../types.js";
import { getMacroName } from "./_helpers.js";
import { isInsideProgramModule } from "./_anchor-helpers.js";

export const anchorEmitViaMsg: Visitor = {
  name: "anchor-emit-via-msg",
  severity: "low",
  appliesTo: ["anchor"],
  enter: {
    macro_invocation(node, ctx) {
      if (!isInsideProgramModule(node, ctx.anchor.programModule)) return;
      const name = getMacroName(node);
      if (name !== "msg") return;
      ctx.output.issues.push({
        severity: "low",
        rule: "anchor-emit-via-msg",
        title: `Event emitted via \`msg!\` inside #[program] mod`,
        location: formatLocation(ctx.filename, node),
        description: `\`msg!\` writes to program logs, which are truncated when transactions exceed log limits. For events downstream consumers index, use Anchor's typed \`emit!\` (or \`emit_cpi!\` for CPI-stored events) so the data is captured deterministically.`,
        suggestion: `Define an \`#[event] struct\` for the payload and call \`emit!(MyEvent { ... })\` instead of \`msg!\`. For event data that must survive log truncation in large transactions, use \`emit_cpi!\` with a self-CPI authority.`,
        code_snippet: snippet(ctx.source, node, 80),
      });
    },
  },
};
