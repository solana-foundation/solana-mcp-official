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
    details: { tool, req: query, res: text },
  });

  return { content: [{ type: "text", text }] };
}

const LIST_SECTIONS_DESCRIPTION = `Lists every Solana ecosystem documentation source available, grouped by section. Each entry includes a use_cases keyword string describing WHEN that source is relevant. Always call this FIRST for any non-trivial Solana question, then match the user's intent against the use_cases to pick the right source ids before calling get_documentation. Returns a closed taxonomy of section ids (e.g. core, programs, frameworks, clients, defi, oracles, infra, wallets) and a flat list of source entries shaped as "title, id, sections, use_cases". Use Solana_Documentation_Search instead when you need a targeted answer rather than full canonical docs.`;

const GET_DOCUMENTATION_DESCRIPTION = `Retrieves full documentation for one or more Solana ecosystem sources. Each entry in \`section\` is either (a) a source id (e.g. "anchor-docs", "gh-pinocchio") or (b) a section taxonomy id (e.g. "frameworks", "defi") which expands to every source tagged with that section. Accepts a single string or an array. Always run list_sections first and analyze its use_cases output to pick relevant ids. Token-intensive — fetch only what you need, and prefer your existing knowledge or Solana_Documentation_Search for narrow questions. Per source the server tries (1) the source's published llms.txt, (2) a stitched markdown reconstruction from our doc index, (3) a pointer to the primary URL. Output is markdown with sources separated by '---'.`;

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
          .describe(
            'Source id(s) to fetch — e.g. "anchor-docs" or ["anchor-docs", "gh-pinocchio"]. Pick ids by matching the user\'s intent against the use_cases output of list_sections.',
          ),
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
