import { beforeEach, describe, expect, it, vi } from "vitest";

const { logAnalyticsMock } = vi.hoisted(() => ({ logAnalyticsMock: vi.fn() }));
vi.mock("../../../lib/analytics", () => ({ logAnalytics: logAnalyticsMock }));

import { createProgramAutofixerTool } from "../../../lib/tools/programAutofixer/index.js";
import { VULNERABLE_MISSING_SIGNER } from "./fixtures-pinocchio.js";

describe("createProgramAutofixerTool", () => {
  beforeEach(() => {
    logAnalyticsMock.mockReset();
    logAnalyticsMock.mockResolvedValue(undefined);
  });

  it("returns a SolanaTool with the expected shape", () => {
    const tool = createProgramAutofixerTool();
    expect(tool.title).toBe("program_autofixer");
    expect(tool.description).toContain("MUST be called");
    expect(tool.parameters).toBeDefined();
    const parameters = tool.parameters as unknown as Record<string, { parse: (value: unknown) => unknown }>;
    expect(parameters.framework.parse(undefined)).toBe("auto");
    expect(parameters.dismissed.parse(undefined)).toBeUndefined();
    expect(() => parameters.dismissed.parse([{ fingerprint: "missing-signer:abc123" }])).toThrow();
    expect(() => parameters.dismissed.parse([{ fingerprint: "missing-signer:abc123", reason: "" }])).toThrow();
    expect(tool.outputSchema).toBeDefined();
    expect(tool.annotations?.title).toBe("Program Autofixer");
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it("invokes the autofixer pipeline and emits analytics", async () => {
    const tool = createProgramAutofixerTool();
    const result = (await tool.func({ code: VULNERABLE_MISSING_SIGNER })) as {
      content: [{ text: string }];
      structuredContent: { framework_detected: string; issues: { rule: string }[] };
    };

    expect(result.structuredContent.framework_detected).toBe("pinocchio");
    expect(result.structuredContent.issues.some(i => i.rule === "missing-signer")).toBe(true);
    const textPayload = JSON.parse(result.content[0].text);
    expect(textPayload.framework_detected).toBe("pinocchio");
    expect(textPayload.require_another_tool_call_after_fixing).toBe(true);
    expect(logAnalyticsMock).toHaveBeenCalledOnce();
    expect(logAnalyticsMock.mock.calls[0][0].details.tool).toBe("program_autofixer");
    expect(logAnalyticsMock.mock.calls[0][0].details.req).toBe(
      JSON.stringify({ framework_requested: "auto", code_length: VULNERABLE_MISSING_SIGNER.length }),
    );
    expect(logAnalyticsMock.mock.calls[0][0].details.req).not.toContain(VULNERABLE_MISSING_SIGNER.slice(0, 20));
    expect(logAnalyticsMock.mock.calls[0][0].details.res).not.toContain("pub struct InitAccounts");
  }, 20_000);

  it("logs dismissed rule names and counts but never dismissal reasons", async () => {
    const tool = createProgramAutofixerTool();
    const first = (await tool.func({ code: VULNERABLE_MISSING_SIGNER })) as {
      structuredContent: { issues: { rule: string; fingerprint: string }[] };
    };
    const signerIssue = first.structuredContent.issues.find(i => i.rule === "missing-signer");
    expect(signerIssue).toBeDefined();

    logAnalyticsMock.mockClear();
    const reason = "verified: admin signer enforced by caller-level guard";
    await tool.func({
      code: VULNERABLE_MISSING_SIGNER,
      dismissed: [{ fingerprint: signerIssue!.fingerprint, reason }],
    });

    const res = JSON.parse(logAnalyticsMock.mock.calls[0][0].details.res);
    expect(res.dismissed_count).toBe(1);
    expect(res.dismissed_rules).toEqual(["missing-signer"]);
    expect(logAnalyticsMock.mock.calls[0][0].details.req).not.toContain(reason);
    expect(logAnalyticsMock.mock.calls[0][0].details.res).not.toContain(reason);
    expect(logAnalyticsMock.mock.calls[0][0].details.res).not.toContain(signerIssue!.fingerprint);
  }, 20_000);
});
