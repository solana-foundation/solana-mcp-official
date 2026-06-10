import type { Node } from "web-tree-sitter";
import type { Visitor, VisitorContext } from "../types.js";
import { formatLocation } from "../types.js";
import { isRejectingGuard } from "./_helpers.js";

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
  "get_extension",
  "get_extension_types",
  "get_extension_mut",
]);

const EXTENSION_AWARE_TYPES = new Set(["StateWithExtensions", "StateWithExtensionsMut", "ExtensionType"]);

interface Token2022State {
  hints: Node[];
  checked: boolean;
}

function getState(ctx: VisitorContext): Token2022State {
  const bag = ctx as unknown as { __token2022?: Token2022State };
  if (!bag.__token2022) bag.__token2022 = { hints: [], checked: false };
  return bag.__token2022;
}

function enclosingUseDeclaration(node: Node): Node | null {
  let cursor: Node | null = node.parent;
  while (cursor) {
    if (cursor.type === "use_declaration") return cursor;
    cursor = cursor.parent;
  }
  return null;
}

function hintIndicatesProcessing(hint: Node): boolean {
  const useDecl = enclosingUseDeclaration(hint);
  if (useDecl) {
    const text = useDecl.text.replace(/\s+/g, "");
    return !(text.endsWith("::ID;") || text.endsWith("::id;") || text.includes("TOKEN_2022_PROGRAM_ID"));
  }
  return !isRejectingGuard(hint);
}

function recordHint(node: Node, ctx: VisitorContext): void {
  const state = getState(ctx);
  if (TOKEN_2022_MARKERS.has(node.text)) state.hints.push(node);
  if (EXTENSION_AWARE_TYPES.has(node.text)) state.checked = true;
}

export const token2022Extensions: Visitor = {
  name: "token-2022-extensions",
  severity: "medium",
  appliesTo: ["pinocchio"],
  enter: {
    identifier: recordHint,
    type_identifier: recordHint,
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
    if (state.checked) return;
    const processingHint = state.hints.find(hintIndicatesProcessing);
    if (!processingHint) return;
    ctx.output.issues.push({
      severity: "medium",
      rule: "token-2022-extensions",
      title: `Token-2022 used without extension safety check`,
      location: formatLocation(ctx.filename, processingHint),
      description: `This program processes Token-2022 accounts (\`${processingHint.text}\`) but never inspects extensions (\`get_extension\`, \`get_extension_types\`, \`StateWithExtensions\`, or a safety helper like \`verify_safe_mint\`). Token-2022 mints may carry dangerous extensions — \`TransferFee\`, \`TransferHook\`, \`PermanentDelegate\`, \`ConfidentialTransfer\`, \`DefaultAccountState: Frozen\` — that change transfer semantics in ways callers don't expect.`,
      suggestion: `Add a helper such as \`fn verify_safe_mint(mint: &AccountView)\` that rejects mints carrying dangerous extensions (via \`get_extension_types\`), and call it before performing transfers / minting / freezing.`,
    });
  },
};
