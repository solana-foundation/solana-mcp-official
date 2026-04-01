import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
  let client: Client | undefined;

  beforeEach(async () => {
    handler = createMcp();
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      fetch: async (input, init) => {
        if (input instanceof Request) {
          return handler(input);
        }
        return handler(new Request(input, init));
      },
    });
    client = new Client(
      {
        name: "example-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );
    await client.connect(transport);
  });

  afterEach(async () => {
    if (client) {
      await client.close();
      client = undefined;
    }
  });

  it("lists registered tools through the MCP transport", async () => {
    const { tools } = await client!.listTools();
    const toolNames = tools.map(tool => tool.name);

    for (const toolName of registeredToolNames) {
      expect(toolNames).toContain(toolName);
    }
  });
});
