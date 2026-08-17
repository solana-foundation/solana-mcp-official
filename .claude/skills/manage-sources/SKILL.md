---
name: manage-sources
description: Use when user asks to "add a source", "add docs", "ingest a site", "add this repo to the corpus", "remove a source", "disable a source", or gives a documentation URL to include in the Solana MCP index. Edits ingestion/sources.yaml, validates with pnpm gen:sources, and opens a PR.
user-invocable: true
---

# Manage ingestion sources

Add, remove, or disable entries in `ingestion/sources.yaml`, the single source of truth for what the Databricks ingestion job crawls and what `list_sections` exposes. `lib/sources.generated.ts` is gitignored and rebuilt at build time, so a PR only ever touches the yaml.

## Operating procedure

### 1. Dedup check (always first)

Search `ingestion/sources.yaml` for the requested URL's domain and any plausible id. A source counts as already present when its `primary_url` shares the domain/path or an existing entry clearly covers the same docs. If found: report the existing entry (id, enabled state, sections) and stop. If it exists but `enabled: false`, ask whether to re-enable instead of adding.

For removals: find the entry by id or url. If nothing matches, list the closest candidates and stop.

### 2. Author the entry (add) or delete it (remove)

Read the header comment of `ingestion/sources.yaml` before writing — it defines the schema, the closed section taxonomy, and the tagging guidance. Key decisions:

- **kind**: `github` for a GitHub repo (docs live in .md/.mdx), `web` for a docs site, `openapi` for a JSON spec.
- **id**: kebab-case, unique. GitHub sources use the `gh-` prefix (`gh-anchor`), web sources typically `<project>-docs`.
- **sections**: 1–3 tags from the closed taxonomy in the file header. Do not invent tags; the server boot check rejects unknown ones.
- **use_cases**: comma-separated routing keywords, strongest hooks first. Written for an agent deciding whether this source answers a query.
- Fetch the URL to confirm it resolves and to inform `use_cases`/`sections`. Prefer `sitemaps` when the site publishes one, otherwise `start_urls`. Add `url_include` filters for multi-chain doc sites so only Solana pages are kept.

Insert the entry into the matching `# --- ... ---` group in the file, not at the end. Follow the exact field order and style of neighboring entries.

Entry shapes to copy:

```yaml
  - id: example-docs
    name: Example Docs
    kind: web
    enabled: true
    sections: [defi]
    use_cases: "Example AMM, swap API, liquidity pools"
    primary_url: https://docs.example.xyz
    start_urls:
      - https://docs.example.xyz

  - id: gh-example
    name: GitHub example-org/example
    kind: github
    enabled: true
    sections: [clients]
    use_cases: "Example SDK source, TypeScript client"
    primary_url: https://github.com/example-org/example
    github: { owner: example-org, repo: example, include_readmes: true, include_source_code: true }

  - id: example-api
    name: Example API (OpenAPI)
    kind: openapi
    enabled: true
    sections: [data]
    use_cases: "Example REST API spec, historical data"
    primary_url: https://api.example.xyz/docs
    spec_url: https://api.example.xyz/openapi.json
```

To take a source out of rotation without losing its config, prefer `enabled: false` over deletion; delete only when the source is gone for good or was added in error.

### 3. Validate

```bash
pnpm install
pnpm gen:sources
pnpm typecheck
```

`gen:sources` enforces structure (unique ids, kinds, non-empty sections/use_cases); the typecheck's `freezeSources` boot check rejects unknown section tags. All three must pass before committing.

### 4. PR

- Branch from `main`: `feat/sources-<id>` (or `chore/sources-remove-<id>`).
- Conventional Commit, e.g. `feat(sources): add Example docs` / `chore(sources): remove example-docs`.
- `.claude/*` is commonly globally gitignored; when editing this skill itself use `git add -f`.
- Open the PR with a body noting: source id, kind, sections, why it belongs in the corpus, and the validation commands run.
- Do not merge; a human reviews.

## After merge (mention in the PR body)

The Databricks copy of `sources.yaml` refreshes on the next `just deploy` (asset bundle). The daily 09:00 UTC crawl only picks the source up after that deploy. The Cloud Run server side needs nothing extra: push to `main` redeploys and regenerates the catalogue.
