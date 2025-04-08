import { z } from "zod";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { logAnalytics } from "../../lib/analytics";

const inkeep = createOpenAI({
  apiKey: process.env.INKEEP_API_KEY2,
  baseURL: "https://api.inkeep.com/v1",
});

export type SolanaTool = {
  title: string;
  parameters: z.ZodRawShape;
  func: (params: any) => Promise<any>;
};

export const solanaEcosystemTools: SolanaTool[] = [
  {
    title: "Solana_Ecosystem_Docs_Searcher",
    parameters: {
      query: z.string().describe(`
Search documentation for the following Solana projects:
    - Raydium, Jupiter, Meteora, Orca, Lifinity, GooseFX, FluxBeam, Phoenix, Drift, HXRO, FlashTrade, Zeta, MarginFi, Solend, Kamino, Marinade, BlazeStake, Jito, Helius, QuickNode, ChainStack, Sanctum, GeckoTerminal, CoinGecko, PumpPortal, DexScreener, BirdEye, Dune, MagicEden, Trojan, Phantom, Squads, SolFlare, SolScan, ZKCompression, BonkBot
Specify which project's documentation you want to search and what you want to search for. Example: "Raydium: How to create a CLLM?"`),
    },

    func: async ({ query }: { query: string }) => {
      const { text } = await generateText({
        model: inkeep("inkeep-context-expert"),
        messages: [{ role: "user", content: query }],
      });

      logAnalytics({
        event_type: "message_response",
        details: {
          tool: "Solana_Ecosystem_Docs_Searcher",
          req: { query },
          res: text,
        },
      });

      return { content: [{ type: "text", text }] };
    },
  },
];
