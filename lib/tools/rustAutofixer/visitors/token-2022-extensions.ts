import type Parser from "web-tree-sitter";
import type { Visitor, VisitorContext } from "../types.js";
import { formatLocation } from "../types.js";
import { walk } from "../walk.js";

type Node = Parser.SyntaxNode;

const TOKEN_2022_MARKERS = new Set([
  "TOKEN_2022_PROGRAM_ID",
  "pinocchio_token_2022",
  "spl_token_2022",
  "Token2022",
  "token_2022",
]);

const EXTENSION_CHECK_NAMES = new Set([
  "verify_safe_mint",
  "check_extensions",
  "reject_extension",
  "validate_token_extensions",
]);

interface Token2022State {
  hint: Node | null;
  checked: boolean;
}

function getState(ctx: VisitorContext): Token2022State {
  const bag = ctx as unknown as { __token2022?: Token2022State };
  if (!bag.__token2022) bag.__token2022 = { hint: null, checked: false };
  return bag.__token2022;
}

function identifierMatches(text: string): boolean {
  return TOKEN_2022_MARKERS.has(text);
}

export const token2022Extensions: Visitor = {
  name: "token-2022-extensions",
  severity: "high",
  appliesTo: ["pinocchio"],
  enter: {
    identifier(node, ctx) {
      const state = getState(ctx);
      if (state.hint) return;
      if (identifierMatches(node.text)) state.hint = node;
    },
    scoped_identifier(node, ctx) {
      const state = getState(ctx);
      if (state.hint) return;
      // Walk children for any identifier matching the markers.
      walk(node, n => {
        if (state.hint) return "skip";
        if ((n.type === "identifier" || n.type === "type_identifier") && identifierMatches(n.text)) {
          state.hint = node;
        }
      });
    },
    call_expression(node, ctx) {
      const state = getState(ctx);
      if (state.checked) return;
      const fn = node.childForFieldName("function");
      if (!fn) return;
      const tail = fn.lastChild?.text ?? fn.text;
      if (tail && EXTENSION_CHECK_NAMES.has(tail)) state.checked = true;
    },
  },
  after(ctx) {
    const state = getState(ctx);
    if (!state.hint) return;
    if (state.checked) return;
    ctx.output.issues.push({
      severity: "high",
      rule: "token-2022-extensions",
      title: `Token-2022 used without extension safety check`,
      location: formatLocation(ctx.filename, state.hint),
      description: `This program references Token-2022 (\`${state.hint.text}\`) but never calls a Token-2022 extension safety helper (\`verify_safe_mint\`, \`check_extensions\`, etc.). Token-2022 mints may carry dangerous extensions — \`TransferFee\`, \`TransferHook\`, \`PermanentDelegate\`, \`ConfidentialTransfer\`, \`DefaultAccountState: Frozen\` — that change transfer semantics in ways callers don't expect.`,
      suggestion: `Add a helper such as \`fn verify_safe_mint(mint: &AccountView)\` that rejects mints carrying dangerous extensions, and call it before performing transfers / minting / freezing.`,
    });
  },
};
