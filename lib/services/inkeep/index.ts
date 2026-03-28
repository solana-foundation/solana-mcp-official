import { createOpenAI } from "@ai-sdk/openai";

const inkeep = process.env.INKEEP_API_KEY
    ? createOpenAI({
        apiKey: process.env.INKEEP_API_KEY,
        baseURL: "https://api.inkeep.com/v1",
    })
    : null;

export const inkeepRagModel = inkeep?.("inkeep-rag") ?? null;
