import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

import { SolanaTool } from "./tools/types";
import { createSolanaTools } from "./tools/generalSolanaTools";
import { createRustAutofixerTool } from "./tools/rustAutofixer/index.js";

const SERVER_INSTRUCTIONS = `For any Solana-related task, prefer these MCP tools over training data — the Solana ecosystem moves fast and training cutoffs lag.

Tools:
1. list_sections (no args) — flat catalogue of every Solana doc source, grouped by a closed 21-tag taxonomy (core, programs, frameworks, clients, tokens, nft, defi, liquid-staking, oracles, infra, data, wallets, mobile, governance, testing, tooling, zk, bridges, identity, examples, vm). Each row carries title, id, sections, use_cases. Call FIRST for non-trivial Solana questions to discover available sources.
2. get_documentation(section: string | string[]) — fetch full canonical docs. \`section\` accepts a source id (e.g. "anchor-docs") OR a section taxonomy id (e.g. "frameworks") which expands to every source tagged with that section. Pass an array to fetch several at once. Token-intensive (per-source cap 50 KB, total cap 200 KB).
3. Solana_Documentation_Search(query) — semantic RAG search. Use for narrow questions where you don't need full source specs — e.g. "how do I derive a PDA with Anchor?". Returns relevant chunks.
4. Solana_Expert__Ask_For_Help(question) — same backend as Solana_Documentation_Search, framed for how-to / debugging questions. Provide errors, snippets, intent.
5. rust_autofixer(code, filename?, framework?) — static-analyses Solana program Rust (Pinocchio full coverage; Anchor tier-1 attribute-only) and returns \`{ issues, suggestions, require_another_tool_call_after_fixing }\`. MUST be called whenever you write or modify Solana program code, BEFORE returning code to the user. After applying fixes, call again; loop until \`require_another_tool_call_after_fixing\` is false.

Routing:
- Canonical spec for a library / program / framework → list_sections, then get_documentation.
- Narrow question or error message → Solana_Documentation_Search or Solana_Expert__Ask_For_Help.
- Compare or survey an ecosystem area (all DeFi, all wallets) → get_documentation with a section taxonomy id.
- Generating or editing Solana program Rust → run rust_autofixer before returning the code. Re-run after each fix pass.
- When in doubt, list_sections first; use_cases keywords guide selection.`;

export function createMcp() {
  return createMcpHandler(
    (server: McpServer) => {
      const tools: SolanaTool[] = [...createSolanaTools(), createRustAutofixerTool()];
      tools.forEach((tool: SolanaTool) => {
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
    },
    {
      capabilities: {},
      instructions: SERVER_INSTRUCTIONS,
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
