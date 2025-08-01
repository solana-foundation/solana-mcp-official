
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "@vercel/mcp-adapter";
import { z } from "zod";

import { generalSolanaTools, } from "./tools/generalSolanaTools";
import { geminiSolanaTools } from "./tools/geminiSolanaTools";
import { resources } from "./resources";
import { solanaEcosystemTools } from "./tools/ecosystemSolanaTools";
import { SolanaTool } from "./tools/types";
import { createOpenAI } from "@ai-sdk/openai";
import { openAITools } from "./tools/openAITools";

export const inkeep = createOpenAI({
    apiKey: process.env.INKEEP_API_KEY,
    baseURL: "https://api.inkeep.com/v1",
});

export const openrouter = createOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
});

export function createMcp() {
    console.log("Creating MCP");
    console.log("INKEEP_API_KEY", process.env.INKEEP_API_KEY);
    return createMcpHandler(
        (server: McpServer) => {
            ([] as SolanaTool[])
                .concat(generalSolanaTools, geminiSolanaTools, solanaEcosystemTools, openAITools)
                .forEach((tool: SolanaTool) => {
                    if (tool.outputSchema) {
                        server.registerTool(tool.title, {
                            description: tool.description ?? "",
                            inputSchema: tool.parameters,
                            outputSchema: tool.outputSchema,
                            annotations: {},
                        }, tool.func);
                    } else {
                        server.tool(tool.title, tool.description ?? "", tool.parameters, tool.func);
                    }
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
    )
}