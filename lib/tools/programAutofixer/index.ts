import { z } from "zod";
import { logAnalytics } from "../../analytics.js";
import { runProgramAutofixer } from "./handler.js";
import type { SolanaTool } from "../types.js";
import type { AutofixerOutput } from "./types.js";

const issueSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]),
  rule: z.string(),
  title: z.string(),
  location: z.string(),
  description: z.string(),
  suggestion: z.string(),
  code_snippet: z.string().optional(),
  fingerprint: z.string(),
  dismissed: z.boolean().optional(),
});

function summarizeForAnalytics({
  code,
  framework,
  result,
}: {
  code: string;
  framework: "pinocchio" | "anchor" | "auto";
  result: AutofixerOutput;
}) {
  const dismissedIssues = result.issues.filter(i => i.dismissed);
  return {
    framework_requested: framework,
    framework_detected: result.framework_detected,
    code_length: code.length,
    issue_count: result.issues.length,
    suggestion_count: result.suggestions.length,
    rules: Array.from(new Set(result.issues.map(i => i.rule))).sort(),
    severities: Array.from(new Set(result.issues.map(i => i.severity))).sort(),
    dismissed_count: dismissedIssues.length,
    dismissed_rules: Array.from(new Set(dismissedIssues.map(i => i.rule))).sort(),
    require_another_tool_call_after_fixing: result.require_another_tool_call_after_fixing,
  };
}

export const PROGRAM_AUTOFIXER_DESCRIPTION = `Static security linter for Solana program Rust (Pinocchio + Anchor). Returns issues (with stable \`fingerprint\`), suggestions, detected framework, \`false_positive_hints\` (rule → known blind spots), and \`require_another_tool_call_after_fixing\`.

MUST be called whenever the user asks to write or modify Solana program Rust, before returning code. Re-call after fixes until \`require_another_tool_call_after_fixing\` is false — true only while syntax errors or undismissed critical/high issues remain; medium/low are advisory.

False positives: check the rule's \`false_positive_hints\` conditions against the code. If one verifiably holds, re-call with \`dismissed: [{fingerprint, reason}]\`, citing the evidence. Dismissed issues stop gating the flag, return marked \`dismissed: true\`. Surface dismissed critical/high to the user with the reason. Never dismiss unverified.`;

export function createProgramAutofixerTool(): SolanaTool {
  return {
    title: "program_autofixer",
    description: PROGRAM_AUTOFIXER_DESCRIPTION,
    parameters: {
      code: z.string().describe("Rust source: a single program file or concatenated module."),
      filename: z
        .string()
        .optional()
        .describe('File name for issue locations, e.g. "instructions/init.rs". Defaults to "input.rs".'),
      framework: z
        .enum(["pinocchio", "anchor", "auto"])
        .optional()
        .default("auto")
        .describe("Framework hint. Default 'auto' — detect from imports / attributes."),
      dismissed: z
        .array(z.object({ fingerprint: z.string(), reason: z.string().min(1) }))
        .optional()
        .describe(
          "Issues verified as false positives, by fingerprint. `reason` must cite the code evidence. Dismissed issues stop gating `require_another_tool_call_after_fixing` but are still returned flagged `dismissed: true`.",
        ),
    },
    outputSchema: {
      issues: z.array(issueSchema),
      suggestions: z.array(z.string()),
      framework_detected: z.enum(["pinocchio", "anchor", "unknown"]),
      false_positive_hints: z.record(z.string(), z.string()),
      require_another_tool_call_after_fixing: z.boolean(),
    },
    annotations: {
      title: "Program Autofixer",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    func: async ({
      code,
      filename,
      framework,
      dismissed,
    }: {
      code: string;
      filename?: string;
      framework?: "pinocchio" | "anchor" | "auto";
      dismissed?: { fingerprint: string; reason: string }[];
    }) => {
      const frameworkRequested = framework ?? "auto";
      const result = await runProgramAutofixer({ code, filename, framework: frameworkRequested, dismissed });
      const text = JSON.stringify(result);
      const analytics = summarizeForAnalytics({ code, framework: frameworkRequested, result });
      await logAnalytics({
        event_type: "message_response",
        details: {
          tool: "program_autofixer",
          req: JSON.stringify({
            framework_requested: analytics.framework_requested,
            code_length: analytics.code_length,
          }),
          res: JSON.stringify(analytics),
        },
      });
      return {
        content: [{ type: "text", text }],
        structuredContent: result,
      };
    },
  };
}
