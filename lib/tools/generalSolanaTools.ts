import { z } from "zod";
import { logAnalytics } from "../analytics";
import { searchDocs } from "../services/databricks/vectorSearch.js";
import { formatChunksAsMarkdown } from "./formatChunks.js";
import { formatListSections } from "./listSections.js";
import { fetchDocumentation } from "./getDocumentation.js";
import type { SolanaTool } from "./types";

const ANALYTICS_RES_SNIPPET_CHARS = 500;

function snippet(text: string): string {
  return text.length <= ANALYTICS_RES_SNIPPET_CHARS ? text : `${text.slice(0, ANALYTICS_RES_SNIPPET_CHARS)}…`;
}

async function answerViaDatabricks(tool: "Solana_Expert__Ask_For_Help" | "Solana_Documentation_Search", query: string) {
  const chunks = await searchDocs(query);
  const text = formatChunksAsMarkdown(query, chunks);

  await logAnalytics({
    event_type: "message_response",
    details: { tool, req: query, res: snippet(text) },
  });

  return { content: [{ type: "text", text }] };
}

const LIST_SECTIONS_DESCRIPTION = `Lists Solana doc sources tagged by section + use_cases. Call before get_documentation to pick relevant ids.`;

const GET_DOCUMENTATION_DESCRIPTION = `Fetch full docs for source id(s) or section id(s). Token-intensive — pick from list_sections first; prefer Solana_Documentation_Search for narrow questions.`;

export function createSolanaTools(): SolanaTool[] {
  return [
    {
      title: "Solana_Expert__Ask_For_Help",
      description:
        "Ask a Solana expert (RAG over docs). Use for narrow how-to / debugging Qs; prefer get_documentation for full canonical docs.",
      parameters: {
        question: z.string().describe("Solana question with as much context as possible. Used for similarity search."),
      },

      func: async ({ question }: { question: string }) => answerViaDatabricks("Solana_Expert__Ask_For_Help", question),
    },

    {
      title: "Solana_Documentation_Search",
      description:
        "Semantic search over the Solana docs corpus (RAG). Use for narrow queries; prefer get_documentation for full canonical docs.",
      parameters: {
        query: z.string().describe("Search query matched against the corpus."),
      },

      func: async ({ query }: { query: string }) => answerViaDatabricks("Solana_Documentation_Search", query),
    },

    {
      title: "list_sections",
      description: LIST_SECTIONS_DESCRIPTION,
      parameters: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      func: async () => {
        const text = formatListSections();
        await logAnalytics({
          event_type: "message_response",
          details: { tool: "list_sections", req: "", res: snippet(text) },
        });
        return { content: [{ type: "text", text }] };
      },
    },

    {
      title: "get_documentation",
      description: GET_DOCUMENTATION_DESCRIPTION,
      parameters: {
        section: z
          .union([z.string(), z.array(z.string())])
          .describe('Source id (e.g. "anchor-docs") or section id (e.g. "frameworks"). Single string or array.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      func: async ({ section }: { section: string | string[] }) => {
        const text = await fetchDocumentation(section);
        await logAnalytics({
          event_type: "message_response",
          details: { tool: "get_documentation", req: JSON.stringify(section), res: snippet(text) },
        });
        return { content: [{ type: "text", text }] };
      },
    },
  ];
}
