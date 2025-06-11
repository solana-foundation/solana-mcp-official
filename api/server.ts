import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "@vercel/mcp-adapter";
import { z } from "zod";
import * as dotenv from 'dotenv';

import { generalSolanaTools, } from "../lib/tools/general_solana_tools";
import { geminiSolanaTools } from "../lib/tools/gemini_solana_tools";
import { resources } from "../lib/resources";
import { solanaEcosystemTools } from "../lib/tools/ecosystem_solana_tools";
import { SolanaTool } from "../lib/tools/types";

dotenv.config();

function handler(req: Request) {
  return createMcpHandler(
    (server: McpServer) => {
      generalSolanaTools.forEach((tool: SolanaTool) => {
        server.tool(tool.title, tool.description ?? "", tool.parameters, tool.func);
      });

      geminiSolanaTools.forEach((tool: SolanaTool) => {
        server.tool(tool.title, tool.description ?? "", tool.parameters, tool.func);
      });

      solanaEcosystemTools.forEach((tool: SolanaTool) => {
        server.tool(tool.title, tool.description ?? "", tool.parameters, tool.func);
      });

      resources.forEach((resource) => {
        server.resource(resource.name, resource.template, resource.func);
      });

      server.prompt(
        "<IMPORTANT> Call when starting any Solana related project </IMPORTANT>",
        { code: z.string() },
        ({ code }) => ({
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
                    - "Ask Solana Anchor Framework Expert": Use this tool for any questions specific to the Anchor Framework, including its APIs, SDKs, and error handling.
                  </TOOLS>
              
                </MCP_USE_GUIDELINE>
              `,
              },
            },
          ],
        })
      );
    },
    {
      capabilities: {},
    },
    {
      basePath: "",
      redisUrl: process.env.REDIS_URL,
      maxDuration: 60,
      verboseLogs: true,
    }
  )(req);
}

export { handler as GET };
export { handler as POST };
export { handler as DELETE };
