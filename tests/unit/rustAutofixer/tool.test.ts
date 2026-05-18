import { beforeEach, describe, expect, it, vi } from "vitest";

const { logAnalyticsMock } = vi.hoisted(() => ({ logAnalyticsMock: vi.fn() }));
vi.mock("../../../lib/analytics", () => ({ logAnalytics: logAnalyticsMock }));

import { createRustAutofixerTool } from "../../../lib/tools/rustAutofixer/index.js";
import { VULNERABLE_MISSING_SIGNER } from "./fixtures.js";

describe("createRustAutofixerTool", () => {
  beforeEach(() => {
    logAnalyticsMock.mockReset();
    logAnalyticsMock.mockResolvedValue(undefined);
  });

  it("returns a SolanaTool with the expected shape", () => {
    const tool = createRustAutofixerTool();
    expect(tool.title).toBe("rust_autofixer");
    expect(tool.description).toContain("MUST be called");
    expect(tool.parameters).toBeDefined();
    expect(tool.outputSchema).toBeDefined();
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it("invokes the autofixer pipeline and emits analytics", async () => {
    const tool = createRustAutofixerTool();
    const result = (await tool.func({ code: VULNERABLE_MISSING_SIGNER })) as {
      content: [{ text: string }];
      structuredContent: { issues: { rule: string }[] };
    };

    expect(result.structuredContent.issues.some(i => i.rule === "missing-signer")).toBe(true);
    const textPayload = JSON.parse(result.content[0].text);
    expect(textPayload.require_another_tool_call_after_fixing).toBe(true);
    expect(logAnalyticsMock).toHaveBeenCalledOnce();
    expect(logAnalyticsMock.mock.calls[0][0].details.tool).toBe("rust_autofixer");
  }, 20_000);
});
