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
  return {
    framework_requested: framework,
    framework_detected: result.framework_detected,
    code_length: code.length,
    issue_count: result.issues.length,
    suggestion_count: result.suggestions.length,
    rules: Array.from(new Set(result.issues.map(i => i.rule))).sort(),
    severities: Array.from(new Set(result.issues.map(i => i.severity))).sort(),
    require_another_tool_call_after_fixing: result.require_another_tool_call_after_fixing,
  };
}

export const PROGRAM_AUTOFIXER_DESCRIPTION = `Analyze Solana program Rust for Pinocchio and Anchor security antipatterns. Returns structured issues, fix suggestions, the detected framework, and whether another validation pass is required.

MUST be called whenever the user asks to write or modify Solana program Rust, before returning code. After applying fixes, call it again until \`require_another_tool_call_after_fixing\` is false. The flag stays true only while syntax errors or critical/high issues remain; medium/low findings and suggestions are advisory — surface them to the user, but they do not require another pass.`;

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
    },
    outputSchema: {
      issues: z.array(issueSchema),
      suggestions: z.array(z.string()),
      framework_detected: z.enum(["pinocchio", "anchor", "unknown"]),
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
    }: {
      code: string;
      filename?: string;
      framework?: "pinocchio" | "anchor" | "auto";
    }) => {
      const frameworkRequested = framework ?? "auto";
      const result = await runProgramAutofixer({ code, filename, framework: frameworkRequested });
      const text = JSON.stringify(result, null, 2);
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
