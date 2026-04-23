import { createOpenAI } from "@ai-sdk/openai";

const inkeep = process.env.INKEEP_API_KEY
  ? createOpenAI({
      apiKey: process.env.INKEEP_API_KEY,
      baseURL: "https://api.inkeep.com/v1",
    })
  : null;

// Force chat completions endpoint — @ai-sdk/openai v3 defaults to /v1/responses
// (OpenAI's Responses API) which Inkeep does not implement.
export const inkeepRagModel = inkeep?.chat("inkeep-rag") ?? null;
