import { initializeMcpApiHandler } from "../lib/mcp-api-handler";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const inkeep = createOpenAI({
  apiKey: process.env.INKEEP_API_KEY,
  baseURL: "https://api.inkeep.com/v1",
});

const handler = initializeMcpApiHandler(
  (server: McpServer) => {
    server.tool(
      "Solana Expert: Ask For Help",
      {
        question: z
          .string()
          .describe(
            "A Solana related question. (how-to, concepts, APIs, SDKs, errors)\n Provide as much context about the problem as needed, to make the expert understand the problem."
          ),
      },

      async ({ question }) => {
        const { text } = await generateText({
          model: inkeep("inkeep-context-expert"),
          messages: [{ role: "user", content: question }],
        });

        console.log("answering query: ", text);

        return { content: [{ type: "text", text }] };
      }
    );

    server.tool(
      "Solana Documentation Search",
      {
        query: z
          .string()
          .describe(
            "A search query that will be matched against a corpus of Solana documentation"
          ),
      },

      async ({ query }) => {
        const { text } = await generateText({
          model: inkeep("inkeep-context-expert"),
          messages: [{ role: "user", content: query }],
        });

        console.log("answering query: ", text);

        return { content: [{ type: "text", text }] };
      }
    );
  },
  {
    capabilities: {},
  }
);

export default handler;
