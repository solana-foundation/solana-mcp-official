import { describe, it, expect, beforeEach } from "vitest";
import { createMcp } from "../lib";
import type { SolanaTool } from "../lib/tools/types";
import * as generalSolanaToolsModule from "../lib/tools/generalSolanaTools";
import { geminiSolanaTools } from "../lib/tools/geminiSolanaTools";
import { solanaEcosystemTools } from "../lib/tools/ecosystemSolanaTools";
import { openAITools } from "../lib/tools/openAITools";

const hasRequiredEnv = !!process.env.REDIS_URL;
const describeE2e = hasRequiredEnv ? describe : describe.skip;

if (!hasRequiredEnv) {
  console.warn("[e2e] Skipping E2E tests — missing required env var (REDIS_URL)");
}

function resolveGeneralSolanaTools(): SolanaTool[] {
  const moduleExports = generalSolanaToolsModule as Record<string, unknown>;

  if (Array.isArray(moduleExports.generalSolanaTools)) {
    return moduleExports.generalSolanaTools as SolanaTool[];
  }

  const createSolanaTools = moduleExports.createSolanaTools;
  if (typeof createSolanaTools === "function") {
    const createdTools = (createSolanaTools as (model: unknown | null) => unknown)(null);
    if (Array.isArray(createdTools)) {
      return createdTools as SolanaTool[];
    }
  }

  return [];
}

const registeredToolNames = ([] as SolanaTool[])
  .concat(resolveGeneralSolanaTools(), geminiSolanaTools, solanaEcosystemTools, openAITools)
  .map(tool => tool.title);

describeE2e("e2e", () => {
  let handler: (req: Request) => Promise<Response>;

  beforeEach(() => {
    handler = createMcp();
  });

  it("lists registered tools through the MCP transport", async () => {
    const initializeResponse = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: {
              name: "example-client",
              version: "1.0.0",
            },
          },
        }),
      }),
    );
    const initializePayload = await parseJsonRpcResponse(initializeResponse);
    expect(initializePayload.error).toBeUndefined();
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    const listHeaders = new Headers({
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    });
    if (sessionId) {
      listHeaders.set("mcp-session-id", sessionId);
    }

    const listResponse = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: listHeaders,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      }),
    );
    const listPayload = await parseJsonRpcResponse(listResponse);
    expect(listPayload.error).toBeUndefined();
    const tools = Array.isArray(listPayload.result?.tools) ? listPayload.result.tools : [];
    const toolNames = tools
      .map(tool => (typeof tool?.name === "string" ? tool.name : ""))
      .filter((name): name is string => name.length > 0);

    for (const toolName of registeredToolNames) {
      expect(toolNames).toContain(toolName);
    }
  });
});

type JsonRpcResponse = {
  error?: unknown;
  result?: {
    tools?: Array<{
      name?: string;
    }>;
  };
};

async function parseJsonRpcResponse(response: Response): Promise<JsonRpcResponse> {
  const responseText = await response.text();

  try {
    return JSON.parse(responseText) as JsonRpcResponse;
  } catch {
    const sseDataLines = responseText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.startsWith("data: "))
      .map(line => line.slice("data: ".length))
      .filter(line => line.length > 0);

    for (const sseDataLine of sseDataLines) {
      try {
        return JSON.parse(sseDataLine) as JsonRpcResponse;
      } catch {
        continue;
      }
    }

    throw new Error(`Expected JSON-RPC response but received: ${responseText}`);
  }
}
