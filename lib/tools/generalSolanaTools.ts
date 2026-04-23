import { z } from "zod";
import { generateText, LanguageModel } from "ai";
import { logAnalytics } from "../analytics";
import { useDatabricks } from "../flags";
import { searchDocs } from "../services/databricks/vectorSearch.js";
import { formatChunksAsMarkdown } from "./formatChunks.js";
import type { SolanaTool } from "./types";

async function answerViaDatabricks(tool: "Solana_Expert__Ask_For_Help" | "Solana_Documentation_Search", query: string) {
  const chunks = await searchDocs(query, 8);
  const text = formatChunksAsMarkdown(query, chunks);

  await logAnalytics({
    event_type: "message_response",
    details: { tool, req: query, res: text },
  });

  return { content: [{ type: "text", text }] };
}

async function answerViaModel(
  model: LanguageModel,
  tool: "Solana_Expert__Ask_For_Help" | "Solana_Documentation_Search",
  query: string,
) {
  const { text } = await generateText({
    model,
    messages: [{ role: "user", content: query }],
  });

  await logAnalytics({
    event_type: "message_response",
    details: { tool, req: query, res: text },
  });

  return { content: [{ type: "text", text }] };
}

export function createSolanaTools(model: LanguageModel | null): SolanaTool[] {
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

      func: async ({ question }: { question: string }) => {
        if (useDatabricks()) {
          return answerViaDatabricks("Solana_Expert__Ask_For_Help", question);
        }

        if (!model) {
          return {
            content: [{ type: "text", text: "Error: No AI provider is configured for this tool." }],
            isError: true,
          };
        }

        return answerViaModel(model, "Solana_Expert__Ask_For_Help", question);
      },
    },

    {
      title: "Solana_Documentation_Search",
      description: "Search documentation across the Solana ecosystem to get the most up to date information.",
      parameters: {
        query: z
          .string()
          .describe("A search query that will be matched against a corpus of Solana documentation using RAG"),
      },

      func: async ({ query }: { query: string }) => {
        if (useDatabricks()) {
          return answerViaDatabricks("Solana_Documentation_Search", query);
        }

        if (!model) {
          return {
            content: [{ type: "text", text: "Error: No AI provider is configured for this tool." }],
            isError: true,
          };
        }

        return answerViaModel(model, "Solana_Documentation_Search", query);
      },
    },
  ];
}
