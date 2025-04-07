import { initializeMcpApiHandler } from "../lib/mcp-api-handler";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { generalSolanaTools, SolanaTool } from "./tools/general_solana_tools";
import { geminiSolanaTools } from "./tools/gemini_solana_tools";
import { resources } from "./resources";
import { z } from "zod";

const handler = initializeMcpApiHandler(
  (server: McpServer) => {
    generalSolanaTools.forEach((tool: SolanaTool) => {
      server.tool(tool.title, tool.parameters, tool.func);
    });

    geminiSolanaTools.forEach((tool: SolanaTool) => {
      server.tool(tool.title, tool.parameters, tool.func);
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
  }
);

export default handler;
