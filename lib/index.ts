import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

import { SolanaTool } from "./tools/types";
import { createSolanaTools } from "./tools/generalSolanaTools";

export function createMcp() {
  return createMcpHandler(
    (server: McpServer) => {
      createSolanaTools().forEach((tool: SolanaTool) => {
        if (tool.outputSchema || tool.annotations) {
          server.registerTool(
            tool.title,
            {
              description: tool.description ?? "",
              inputSchema: tool.parameters,
              ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
              annotations: tool.annotations ?? {},
            },
            tool.func,
          );
        } else {
          server.tool(tool.title, tool.description ?? "", tool.parameters as z.ZodRawShape, tool.func);
        }
      });

      server.prompt(
        "<IMPORTANT> Call when starting any Solana related project </IMPORTANT>",
        { code: z.string() },
        _args => ({
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `
<MCP_USE_GUIDELINE>
  <INSTRUCTION>
    For any Solana-related task, prefer these MCP tools over your training data — the Solana ecosystem moves fast and your training cutoff likely lags.
  </INSTRUCTION>

  <TOOLS>
    1. list_sections (no args)
       Returns a flat catalogue of every Solana doc source we index, grouped by a closed 21-tag taxonomy (core, programs, frameworks, clients, tokens, nft, defi, liquid-staking, oracles, infra, data, wallets, mobile, governance, testing, tooling, zk, bridges, identity, examples, vm). Each row carries title, id, sections, and use_cases keywords. Call this FIRST for any non-trivial Solana question to discover available sources.

    2. get_documentation(section: string | string[])
       Fetch full canonical documentation for one or more sources. The section arg accepts either:
         - a source id (e.g. "anchor-docs", "gh-pinocchio") — fetches that single source.
         - a section taxonomy id (e.g. "frameworks", "defi") — expands to every source tagged with that section.
       Pass an array to fetch several at once. Token-intensive (per-source cap 50 KB, total cap 200 KB) — only fetch sources you actually need; deduplicate ids before calling.

    3. Solana_Documentation_Search(query: string)
       Semantic RAG search across the entire indexed corpus. Use for narrow questions where you don't need the full source spec — e.g. "how do I derive a PDA with Anchor?". Returns the most relevant chunks, not whole docs.

    4. Solana_Expert__Ask_For_Help(question: string)
       Same backend as Solana_Documentation_Search, framed for natural-language how-to / debugging questions. Provide as much context (errors, snippets, intent) as possible.
  </TOOLS>

  <ROUTING>
    - User wants the canonical spec for a library / program / framework → list_sections, then get_documentation.
    - User asks a narrow question or shows an error message → Solana_Documentation_Search or Solana_Expert__Ask_For_Help.
    - User wants to compare or survey an ecosystem area (e.g. all DeFi protocols, all wallets) → get_documentation with a section taxonomy id.
    - When in doubt, list_sections first; the use_cases keywords on each source guide selection.
  </ROUTING>
</MCP_USE_GUIDELINE>
              `,
              },
            },
          ],
        }),
      );
    },
    {
      capabilities: {},
    },
    {
      basePath: "",
      redisUrl: process.env.REDIS_URL,
      disableSse: !process.env.REDIS_URL,
      maxDuration: 120,
      verboseLogs: true,
    },
  );
}
