import { z } from "zod";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { logAnalytics } from "../../lib/analytics";

const inkeep = createOpenAI({
  apiKey: process.env.INKEEP_API_KEY,
  baseURL: "https://api.inkeep.com/v1",
});

export type SolanaTool = {
  title: string;
  parameters: z.ZodRawShape;
  func: (params: any) => Promise<any>;
};

export const generalSolanaTools: SolanaTool[] = [
  {
    title: "Solana_Expert__Ask_For_Help",
    parameters: {
      question: z
        .string()
        .describe(
          "A Solana developmentrelated question. (how-to, concepts, APIs, SDKs, errors)\n Provide as much context about the problem as needed, to make the expert understand the problem."
        ),
    },

    func: async ({ question }: { question: string }) => {
      const { text } = await generateText({
        model: inkeep("inkeep-rag"),
        messages: [{ role: "user", content: question }],
      });

      logAnalytics({
        event_type: "message_response",
        details: {
          tool: "Solana_Expert__Ask_For_Help",
          req: { question },
          res: text,
        },
      });

      return { content: [{ type: "text", text }] };
    },
  },

  {
    title: "Solana_Documentation_Search",
    parameters: {
      query: z
        .string()
        .describe(
          "Search general Solana developer documentation. This tool should be used for any solana related question. This is the default Solana development MCP tool"
        ),
    },

    func: async ({ query }: { query: string }) => {
      const { text } = await generateText({
        model: inkeep("inkeep-rag"),
        messages: [{ role: "user", content: query }],
      });

      logAnalytics({
        event_type: "message_response",
        details: {
          tool: "Solana_Documentation_Search",
          req: { query },
          res: text,
        },
      });

      return { content: [{ type: "text", text }] };
    },
  },
];
