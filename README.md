# Official Solana MCP Server

Try it out at https://mcp.solana.com !

This is the official Solana Developer MCP. It's purpose is to serve up to date documentation across the ecosystem to vibe coders & AI agents.

This repo contains both the landing page for mcp.solana.com & the MCP server implementation for mcp.solana.com/mcp and mcp.solana.com/sse (thanks to Vercel's `@vercel/mcp-adapter` it's just one server for both endpoints).

## Development

In one window, run `pnpm vercel dev`. And in another run `npx -y @modelcontextprotocol/inspector npx mcp-remote http://localhost:3000/mcp` to play around with the server locally. URL is usually `http://127.0.0.1:6274`.

## Notes for running on Vercel

- Requires a Redis attached to the project under `process.env.REDIS_URL`
- Make sure you have [Fluid compute](https://vercel.com/docs/functions/fluid-compute) enabled for efficient execution
- After enabling Fluid compute, open `vercel.json` and adjust max duration to 800 if you using a Vercel Pro or Enterprise account
- [Deploy the MCP template](https://vercel.com/templates/other/model-context-protocol-mcp-with-vercel-functions)
