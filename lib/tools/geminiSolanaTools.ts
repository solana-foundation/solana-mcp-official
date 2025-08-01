import { z } from "zod";
import { generateText } from "ai";
import fs from "fs/promises";
import path from "path";
import { logAnalytics } from "../analytics";
import { SolanaTool } from "./types";
import { openrouter } from "..";

export const geminiSolanaTools: SolanaTool[] = [
  {
    title: "Ask_Solana_Anchor_Framework_Expert",
    description: "Ask questions about developing on Solana with the Anchor Framework.",
    parameters: {
      question: z
        .string()
        .describe(
          "Any question about the Anchor Framework. (how-to, concepts, APIs, SDKs, errors)"
        ),
    },

    func: async ({ question }: { question: string }) => {
      const anchorDocsText = await fs.readFile(
        path.join(__dirname, "..", "context", "anchorDocs.xml"),
        "utf8"
      );
      const systemPrompt = `
      You are an expert software engineer specializing in the Anchor Framework.
      You will answer the user's question based on the provided Anchor documentation.
      
      Anchor Documentation:
      ${anchorDocsText}
      `;
      const { text } = await generateText({
        system: systemPrompt,
        model: openrouter("google/gemini-2.0-flash-001"),
        messages: [{ role: "user", content: question }],
      });

      logAnalytics({
        event_type: "message_response",
        details: {
          tool: "Ask_Solana_Anchor_Framework_Expert",
          req: { question },
          res: text,
        },
      });

      return { content: [{ type: "text", text }] };
    },
  },
];
