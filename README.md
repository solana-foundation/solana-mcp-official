# Official Solana MCP Server

Try it out at https://mcp.solana.com !

The official Solana Developer MCP. Purpose: serve up-to-date documentation across the Solana ecosystem to AI agents and developer tooling.

## Architecture

- **Ingestion** ([`ingestion/`](ingestion/)): Databricks notebook crawls the sources listed in [`ingestion/sources.yaml`](ingestion/sources.yaml), chunks markdown, and writes embeddings into a Delta-backed Vector Search index.
- **Retrieval** ([`lib/services/databricks/`](lib/services/databricks/)): MCP tools query the index via Databricks Vector Search; an optional cross-encoder Model Serving endpoint reranks results. `get_documentation` falls back to a SQL read of the `docs_chunks` Delta table when a source has no published `llms.txt`.
- **Server** ([`lib/index.ts`](lib/index.ts), [`server/cloudrun.ts`](server/cloudrun.ts)): Exposes five tools over MCP — `Solana_Expert__Ask_For_Help` and `Solana_Documentation_Search` (semantic RAG), `list_sections` and `get_documentation` (canonical-spec retrieval modelled after the Svelte AI server), and `program_autofixer` for Anchor and Pinocchio Solana program Rust checks. Deployed on Cloud Run as a containerised Node service fronting `mcp.solana.com`; calls the Databricks workspace REST API directly for retrieval.
- **Section catalogue** ([`ingestion/sources.yaml`](ingestion/sources.yaml) → [`lib/sources.generated.ts`](lib/sources.generated.ts)): `pnpm gen:sources` emits a typed catalogue of every source, its tags from a closed 21-section taxonomy, and `use_cases` keywords used by `list_sections` to route the agent.
- **Analytics** ([`lib/services/s3/analytics.ts`](lib/services/s3/analytics.ts)): Tool calls + initializations are buffered in memory and uploaded as JSONL objects to the S3 prefix configured by `ANALYTICS_S3_URI`.

## Local Development

```bash
pnpm install
cp .env.example .env  # set DATABRICKS_HOST + DATABRICKS_TOKEN + DATABRICKS_VS_INDEX
pnpm dev:local
pnpm inspector  # connects MCP Inspector at http://127.0.0.1:6274
```

## Deploy

Production runs on Cloud Run (mcp.solana.com → [`server/cloudrun.ts`](server/cloudrun.ts), built via the root [`Dockerfile`](Dockerfile)). Push to `main` triggers [`.github/workflows/deploy-cloudrun.yml`](.github/workflows/deploy-cloudrun.yml), which submits a Cloud Build and rolls the new revision. Runtime env vars (`DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `DATABRICKS_VS_INDEX`, `DATABRICKS_WAREHOUSE_ID`, `DATABRICKS_RERANKER_ENDPOINT`, `REDIS_URL`, `ANALYTICS_S3_*`, `AWS_*`) and deploy config (`GCP_*`, `VPC_CONNECTOR`) are loaded from the Doppler `prd_github` config at deploy time.

The Databricks side ([`databricks.yml`](databricks.yml)) deploys two resources via `just deploy`:

- the daily ingestion job (`crawl_and_index.py` notebook) — crawls sources, MERGEs into Delta, syncs the Vector Search index;
- the Lakeview dashboard. Analytics source files now land in S3 first and need downstream ingestion before dashboard consumption.

Per-environment values (catalog, warehouse, index) live in the gitignored `prod.yml` (see template inline in `databricks.yml`).

```bash
just deploy   # builds, pushes ingestion job + dashboard
```

## Evals

Per-environment values (catalog, warehouse, index) live in the gitignored `prod.yml`; supply each variable listed under `variables:` in [`databricks.yml`](databricks.yml).
