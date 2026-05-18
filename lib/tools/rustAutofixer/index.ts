import { z } from "zod";
import { logAnalytics } from "../../analytics.js";
import { runRustAutofixer } from "./handler.js";
import type { SolanaTool } from "../types.js";

const ANALYTICS_RES_SNIPPET_CHARS = 500;

function snippet(text: string): string {
  return text.length <= ANALYTICS_RES_SNIPPET_CHARS ? text : `${text.slice(0, ANALYTICS_RES_SNIPPET_CHARS)}…`;
}

const issueSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]),
  rule: z.string(),
  title: z.string(),
  location: z.string(),
  description: z.string(),
  suggestion: z.string(),
  code_snippet: z.string().optional(),
});

export const RUST_AUTOFIXER_DESCRIPTION = `Static-analyse Pinocchio-based Solana program Rust for security antipatterns. Returns structured issues + suggestions.

MUST be called whenever the user asks to write or modify Pinocchio program code, BEFORE returning the code to them. After applying fixes, call again — keep looping until \`require_another_tool_call_after_fixing\` is false.

Detects: missing signer/owner/discriminator checks, unverified program IDs, sysvar spoofing, arbitrary CPI, unvalidated PDA derivation, unchecked arithmetic, signers verified but unused, accounts with no \`verify_*\` call, type cosplay, unchecked deserialization, account closure, re-initialization, rent-exempt, authority escalation, Token-2022 extensions, instruction data bounds, PDA seed collision, bump canonicalization, writable mutation, account relationship, account borrow safety, unsafe unwrap/expect, and events emitted via \`msg!\`.

Anchor coverage is intentionally minimal in this version — only framework-agnostic Rust checks (arithmetic, unwrap, raw pointer casts, double-mut-borrow) apply to Anchor programs.`;

export function createRustAutofixerTool(): SolanaTool {
  return {
    title: "rust_autofixer",
    description: RUST_AUTOFIXER_DESCRIPTION,
    parameters: {
      code: z.string().describe("Rust source: a single program file or concatenated module."),
      filename: z
        .string()
        .optional()
        .describe('File name for issue locations, e.g. "instructions/init.rs". Defaults to "input.rs".'),
      framework: z
        .enum(["pinocchio", "auto"])
        .optional()
        .describe(
          "Framework hint. Default 'auto' — detect from imports / attributes. Pass 'pinocchio' to force the full Pinocchio rule set; Anchor-specific checks are not yet supported.",
        ),
    },
    outputSchema: {
      issues: z.array(issueSchema),
      suggestions: z.array(z.string()),
      require_another_tool_call_after_fixing: z.boolean(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    func: async ({
      code,
      filename,
      framework,
    }: {
      code: string;
      filename?: string;
      framework?: "pinocchio" | "auto";
    }) => {
      const result = await runRustAutofixer({ code, filename, framework });
      const text = JSON.stringify(result, null, 2);
      await logAnalytics({
        event_type: "message_response",
        details: {
          tool: "rust_autofixer",
          req: snippet(code),
          res: snippet(text),
        },
      });
      return {
        content: [{ type: "text", text }],
        structuredContent: result,
      };
    },
  };
}
