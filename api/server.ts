import { initializeMcpApiHandler } from "../lib/mcp-api-handler";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { generalSolanaTools, SolanaTool } from "./tools/general_solana_tools";
import { geminiSolanaTools } from "./tools/gemini_solana_tools";
import { resources } from "./resources";

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
  },
  {
    capabilities: {},
  }
);

export default handler;
