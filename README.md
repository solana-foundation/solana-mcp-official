# Official Solana MCP Server

Try it out at https://mcp.solana.com !

The official Solana Developer MCP. Purpose: serve up-to-date documentation across the Solana ecosystem to AI agents and developer tooling.

## Architecture

- **Ingestion** ([`ingestion/`](ingestion/)): Databricks notebook crawls the sources listed in [`ingestion/sources.yaml`](ingestion/sources.yaml), chunks markdown, and writes embeddings into a Delta-backed Vector Search index.
- **Retrieval** ([`lib/services/databricks/`](lib/services/databricks/)): MCP tools query the index via Databricks Vector Search; an optional cross-encoder Model Serving endpoint reranks results.
- **Server** ([`lib/index.ts`](lib/index.ts), [`api/start.ts`](api/start.ts)): Exposes two tools (`Solana_Expert__Ask_For_Help`, `Solana_Documentation_Search`) and two resources (`solana://clusters`, `solana://installation`) over MCP, deployed as a Databricks App.
- **Analytics** ([`lib/services/databricks/analytics.ts`](lib/services/databricks/analytics.ts)): Tool calls + initializations land in the Databricks SQL warehouse for dashboards.

## Local Development

```bash
pnpm install
cp .env.example .env  # set DATABRICKS_HOST + DATABRICKS_TOKEN + DATABRICKS_VS_INDEX
pnpm dev:local
pnpm inspector  # connects MCP Inspector at http://127.0.0.1:6274
```

## Deploy

Production runs as a Databricks App. The bundle config is in [`databricks.yml`](databricks.yml); per-environment values (catalog, warehouse, index) live in the gitignored `prod.yml` (see template inline in `databricks.yml`).

```bash
just deploy   # builds, pushes the bundle, and deploys the app to prod
```

## Evals

A/B harness comparing the deployed Databricks MCP against the legacy hosted MCP lives in [`eval/`](eval/). See [`eval/run.ts`](eval/run.ts) and [`eval/questions.jsonl`](eval/questions.jsonl).
