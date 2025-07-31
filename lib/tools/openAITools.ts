
import { z } from "zod";
import { generateText } from "ai";
import { logAnalytics } from "../analytics";
import { InkeepResource, mapInkeepToOpenAI, SolanaTool } from "./types";
import { inkeep } from "..";

export const openAITools: SolanaTool[] = [
    // OpenAI DeepResearch `search` tool
    // {
    //     title: "search",
    //     description: "Purpose: search docs across the Solana ecosystem to get the most up to date information. Think of the query as a search query for a search engine. No special syntax is needed.",
    //     parameters: {
    //         query: z.string().describe(`A search query that will be matched against a corpus of Solana documentation using RAG`),
    //     },
    //     outputSchema: {
    //         results: z.array(z.object({
    //             id: z.string(),
    //             title: z.string(),
    //             text: z.string(),
    //             url: z.string().nullable().optional(),
    //         })),
    //     },

    //     func: async ({ query }: { query: string }) => {
    //         const { text } = await generateText({
    //             model: inkeep("inkeep-rag"),
    //             messages: [{ role: "user", content: query }],
    //         });

    //         logAnalytics({
    //             event_type: "message_response",
    //             details: {
    //                 tool: "search",
    //                 req: { query },
    //                 res: text,
    //             },
    //         });
    //         const resources = JSON.parse(text).content as InkeepResource[];
    //         const mapped = resources.flatMap(mapInkeepToOpenAI);
    //         return { structuredContent: { results: mapped } };
    //     },
    // },

    // OpenAI DeepResearch `fetch` tool
    // {
    //     title: "fetch",
    //     description: "Retrieves detailed content for a specific resource identified by the given ID.",
    //     parameters: {
    //         id: z.string().describe(`The ID of the resource to fetch.`),
    //     },
    //     outputSchema: {
    //         id: z.string(),
    //         title: z.string(),
    //         text: z.string(),
    //         url: z.string().nullable().optional(),
    //         metadata: z.object({
    //             type: z.string().nullable(),
    //             additionalProperties: z.string(),
    //         }).nullable().optional(),
    //     },

    //     func: async ({ id }: { id: string }) => {
    //         logAnalytics({
    //             event_type: "message_response",
    //             details: {
    //                 tool: "fetch",
    //                 req: { id },
    //                 res: "Not implemented",
    //             },
    //         });
    //         return { structuredContent: { id, title: "Not implemented", text: "Not implemented", url: null, metadata: null } };
    //     },
    // }
];