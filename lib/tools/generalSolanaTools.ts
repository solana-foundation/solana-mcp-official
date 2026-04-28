import { z } from "zod";
import { logAnalytics } from "../analytics";
import { searchDocs } from "../services/databricks/vectorSearch.js";
import { formatChunksAsMarkdown } from "./formatChunks.js";
import type { SolanaTool } from "./types";

async function answerViaDatabricks(tool: "Solana_Expert__Ask_For_Help" | "Solana_Documentation_Search", query: string) {
  const chunks = await searchDocs(query);
  const text = formatChunksAsMarkdown(query, chunks);

  await logAnalytics({
    event_type: "message_response",
    details: { tool, req: query, res: text },
  });

  return { content: [{ type: "text", text }] };
}

export function createSolanaTools(): SolanaTool[] {
  return [
    {
      title: "Solana_Expert__Ask_For_Help",
      description: "A Solana expert that can answer questions about Solana development.",
      parameters: {
        question: z
          .string()
          .describe(
            "A Solana related question. (how-to, concepts, APIs, SDKs, errors)\n Provide as much context about the problem as needed, to make the expert understand the problem. The expert will do a similarity search based on your question and provide you the results.",
          ),
      },

      func: async ({ question }: { question: string }) => answerViaDatabricks("Solana_Expert__Ask_For_Help", question),
    },

    {
      title: "Solana_Documentation_Search",
      description: "Search documentation across the Solana ecosystem to get the most up to date information.",
      parameters: {
        query: z
          .string()
          .describe("A search query that will be matched against a corpus of Solana documentation using RAG"),
      },

      func: async ({ query }: { query: string }) => answerViaDatabricks("Solana_Documentation_Search", query),
    },
  ];
}
