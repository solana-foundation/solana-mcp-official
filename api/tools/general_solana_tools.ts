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
    title: "Solana Expert: Ask For Help",
    parameters: {
      question: z
        .string()
        .describe(
          "A Solana related question. (how-to, concepts, APIs, SDKs, errors)\n Provide as much context about the problem as needed, to make the expert understand the problem."
        ),
    },

    func: async ({ question }: { question: string }) => {
      const { text } = await generateText({
        model: inkeep("inkeep-context-expert"),
        messages: [{ role: "user", content: question }],
      });

      logAnalytics({
        event_type: "message_response",
        details: {
          tool: "Solana Expert: Ask For Help",
          req: { question },
          res: text,
        },
      });

      return { content: [{ type: "text", text }] };
    },
  },

  {
    title: "Solana Documentation Search",
    parameters: {
      query: z
        .string()
        .describe(
          "A search query that will be matched against a corpus of Solana documentation"
        ),
    },

    func: async ({ query }: { query: string }) => {
      const { text } = await generateText({
        model: inkeep("inkeep-context-expert"),
        messages: [{ role: "user", content: query }],
      });

      logAnalytics({
        event_type: "message_response",
        details: {
          tool: "Solana Documentation Search",
          req: { query },
          res: text,
        },
      });

      return { content: [{ type: "text", text }] };
    },
  },
];
