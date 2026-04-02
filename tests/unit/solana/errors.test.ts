import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DEFAULT_CURRENTLY_UNSUPPORTED_MESSAGE,
  DEFAULT_INTERNAL_ERROR_MESSAGE,
  DEFAULT_NOT_FOUND_MESSAGE,
  MCP_TOOL_ERROR_CODES,
  currentlyUnsupported,
  internalError,
  invalidArgument,
  notFound,
  sanitizeToolError,
  toToolResult,
} from "../../../lib/solana/errors";

describe("MCP error taxonomy", () => {
  it("defines the supported tool error codes", () => {
    expect(MCP_TOOL_ERROR_CODES).toEqual(["INVALID_ARGUMENT", "NOT_FOUND", "CURRENTLY_UNSUPPORTED", "INTERNAL_ERROR"]);
  });

  it("maps zod validation errors to INVALID_ARGUMENT", () => {
    const schema = z.object({ id: z.string() });
    const parseResult = schema.safeParse({ id: 123 });

    if (parseResult.success) {
      throw new Error("Expected schema parsing to fail for invalid input.");
    }

    expect(sanitizeToolError(parseResult.error)).toEqual({
      code: "INVALID_ARGUMENT",
      message: expect.stringContaining("id:"),
    });
  });

  it("maps unknown runtime errors to INTERNAL_ERROR without leaking internals", () => {
    const sanitized = sanitizeToolError(new Error("db password mismatch"));

    expect(sanitized).toEqual({
      code: "INTERNAL_ERROR",
      message: DEFAULT_INTERNAL_ERROR_MESSAGE,
    });
    expect(sanitized.message).not.toContain("password");
  });

  it("supports all constructors and passes through canonical tool errors", () => {
    const notFoundError = notFound();
    const unsupportedError = currentlyUnsupported();

    expect(notFoundError).toEqual({
      code: "NOT_FOUND",
      message: DEFAULT_NOT_FOUND_MESSAGE,
    });
    expect(unsupportedError).toEqual({
      code: "CURRENTLY_UNSUPPORTED",
      message: DEFAULT_CURRENTLY_UNSUPPORTED_MESSAGE,
    });
    expect(sanitizeToolError(notFoundError)).toBe(notFoundError);
  });

  it("treats non-object unknown values as INTERNAL_ERROR", () => {
    expect(sanitizeToolError(null)).toEqual({
      code: "INTERNAL_ERROR",
      message: DEFAULT_INTERNAL_ERROR_MESSAGE,
    });
  });

  it("builds a strict error envelope with code and message only", () => {
    const result = toToolResult({
      payload: {},
      errors: [invalidArgument("arguments must be an object with no properties")],
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      payload: {},
      errors: [
        {
          code: "INVALID_ARGUMENT",
          message: "arguments must be an object with no properties",
        },
      ],
    });

    const [contentItem] = result.content;
    expect(contentItem?.type).toBe("text");

    if (!contentItem || contentItem.type !== "text") {
      throw new Error("Expected text content in tool error response.");
    }

    const parsedTextEnvelope = JSON.parse(contentItem.text) as {
      errors: Array<Record<string, unknown>>;
    };

    expect(parsedTextEnvelope).toEqual(result.structuredContent);
    expect(Object.keys(parsedTextEnvelope.errors[0] ?? {}).sort()).toEqual(["code", "message"]);
  });

  it("builds canonical tool result envelopes for success paths", () => {
    const result = toToolResult({
      payload: {
        entity: {
          kind: "account",
        },
      },
      errors: [],
    });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      payload: {
        entity: {
          kind: "account",
        },
      },
      errors: [],
    });
  });

  it("coerces safe BigInt values to numbers in payload", () => {
    const result = toToolResult({
      payload: {
        nested: {
          epoch: BigInt(605),
          fee: BigInt(0),
        },
      },
      errors: [],
    });

    expect(result.structuredContent).toEqual({
      payload: { nested: { epoch: 605, fee: 0 } },
      errors: [],
    });

    const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed).toEqual(result.structuredContent);
  });

  it("coerces unsafe BigInt values to strings in payload", () => {
    const result = toToolResult({
      payload: { huge: BigInt("99999999999999999999") },
      errors: [],
    });

    expect(result.structuredContent).toEqual({
      payload: { huge: "99999999999999999999" },
      errors: [],
    });
  });

  it("allows isError override to suppress error flag on degraded-but-valid responses", () => {
    const result = toToolResult({
      payload: { entity: { kind: "transaction" } },
      errors: [internalError("Confirmation status temporarily unavailable.")],
      isError: false,
    });

    expect(result.isError).toBe(false);
  });

  it("allows isError override to force error flag on empty errors", () => {
    const result = toToolResult({
      payload: {},
      errors: [],
      isError: true,
    });

    expect(result.isError).toBe(true);
  });

  it("defaults isError to true when errors are present and override is omitted", () => {
    const result = toToolResult({
      payload: {},
      errors: [internalError()],
    });

    expect(result.isError).toBe(true);
  });
});
