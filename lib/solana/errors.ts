import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";

export const MCP_TOOL_ERROR_CODES = [
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "CURRENTLY_UNSUPPORTED",
  "INTERNAL_ERROR",
] as const;

export type McpToolErrorCode = (typeof MCP_TOOL_ERROR_CODES)[number];

export type McpToolError = {
  code: McpToolErrorCode;
  message: string;
};

export const DEFAULT_INVALID_ARGUMENT_MESSAGE = "Invalid tool arguments.";
export const DEFAULT_NOT_FOUND_MESSAGE = "Requested entity was not found.";
export const DEFAULT_CURRENTLY_UNSUPPORTED_MESSAGE = "The requested operation is currently unsupported.";
export const DEFAULT_INTERNAL_ERROR_MESSAGE = "An internal error occurred.";

type ToolResultEnvelope = {
  payload: Record<string, unknown>;
  errors: McpToolError[];
};

export function invalidArgument(message: string = DEFAULT_INVALID_ARGUMENT_MESSAGE): McpToolError {
  return { code: "INVALID_ARGUMENT", message };
}

export function notFound(message: string = DEFAULT_NOT_FOUND_MESSAGE): McpToolError {
  return { code: "NOT_FOUND", message };
}

export function currentlyUnsupported(message: string = DEFAULT_CURRENTLY_UNSUPPORTED_MESSAGE): McpToolError {
  return { code: "CURRENTLY_UNSUPPORTED", message };
}

export function internalError(message: string = DEFAULT_INTERNAL_ERROR_MESSAGE): McpToolError {
  return { code: "INTERNAL_ERROR", message };
}

function isMcpToolError(value: unknown): value is McpToolError {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<McpToolError>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.message === "string" &&
    MCP_TOOL_ERROR_CODES.includes(candidate.code as McpToolErrorCode)
  );
}

export function sanitizeToolError(error: unknown): McpToolError {
  if (isMcpToolError(error)) {
    return error;
  }

  if (error instanceof ZodError) {
    const details = error.issues
      .map(i => {
        const field = i.path.join(".");
        return field ? `${field}: ${i.message}` : i.message;
      })
      .join("; ");
    return invalidArgument(details || DEFAULT_INVALID_ARGUMENT_MESSAGE);
  }

  return internalError();
}

// @solana/kit returns BigInt for large numeric fields (epochs, fees, etc.).
// BigInt is not JSON-serializable, so convert to Number (safe) or String (unsafe).
function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER ? Number(value) : String(value);
  }
  return value;
}

export function toToolResult({
  payload,
  errors,
  isError,
}: {
  payload: Record<string, unknown>;
  errors: McpToolError[];
  isError?: boolean;
}): CallToolResult {
  // Round-trip through JSON so structuredContent and text contain identical
  // coerced values (BigInt → Number/String). Do not insert logic between these lines.
  const text = JSON.stringify({ payload, errors }, bigIntReplacer);
  const envelope = JSON.parse(text) as ToolResultEnvelope;

  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    structuredContent: envelope,
    isError: isError ?? errors.length > 0,
  };
}
