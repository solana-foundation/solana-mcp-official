import { z } from "zod";
import { generateText } from "ai";
import { logAnalytics } from "../analytics";
import { SolanaTool } from "./types";
import { inkeep } from "..";

export const generalSolanaTools: SolanaTool[] = [
  {
    title: "Solana_Expert__Ask_For_Help",
    description: "A Solana expert that can answer questions about Solana development.",
    parameters: {
      question: z
        .string()
        .describe(
          "A Solana related question. (how-to, concepts, APIs, SDKs, errors)\n Provide as much context about the problem as needed, to make the expert understand the problem. The expert will do a similarity search based on your question and provide you the results."
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
    description: "Search documentation across the Solana ecosystem to get the most up to date information.",
    parameters: {
      query: z
        .string()
        .describe(
          "A search query that will be matched against a corpus of Solana documentation using RAG"
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
  }
];
