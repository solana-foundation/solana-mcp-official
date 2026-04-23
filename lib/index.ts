import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

import { resources } from "./resources";
import { solanaEcosystemTools } from "./tools/ecosystemSolanaTools";
import { SolanaTool } from "./tools/types";
import { createSolanaTools } from "./tools/generalSolanaTools";
import { inspectEntityTools } from "./tools/inspectEntityTools";
import { inkeepRagModel } from "./services/inkeep";

export function createMcp() {
  return createMcpHandler(
    (server: McpServer) => {
      ([] as SolanaTool[])
        .concat(createSolanaTools(inkeepRagModel), solanaEcosystemTools, inspectEntityTools)
        .forEach((tool: SolanaTool) => {
          if (tool.outputSchema || tool.annotations) {
            server.registerTool(
              tool.title,
              {
                description: tool.description ?? "",
                inputSchema: tool.parameters,
                ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
                annotations: tool.annotations ?? {},
              },
              tool.func,
            );
          } else {
            server.tool(tool.title, tool.description ?? "", tool.parameters as z.ZodRawShape, tool.func);
          }
        });

      resources.forEach(resource => {
        server.resource(resource.name, resource.template, resource.func);
      });

      server.prompt(
        "<IMPORTANT> Call when starting any Solana related project </IMPORTANT>",
        { code: z.string() },
        _args => ({
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `
                <MCP_USE_GUIDELINE>
                  <INSTRUCTION>
                    If you are working on a Solana-related project. Make frequent use of the following MCP tools to accomplish your goals.
                  </INSTRUCTION>
                  <TOOLS>
                    The following Solana tools are at your disposal:
                    - "Solana Expert: Ask For Help": Use this tool to ask detailed questions about Solana (how-to, concepts, APIs, SDKs, errors). Provide as much context as possible when using it.
                    - "Solana Documentation Search": Use this tool to search the Solana documentation corpus for relevant information based on a query.
                  </TOOLS>
              
                </MCP_USE_GUIDELINE>
              `,
              },
            },
          ],
        }),
      );
    },
    {
      capabilities: {},
    },
    {
      basePath: "",
      redisUrl: process.env.REDIS_URL,
      disableSse: !process.env.REDIS_URL,
      maxDuration: 120,
      verboseLogs: true,
    },
  );
}
