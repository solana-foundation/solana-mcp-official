set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

app := "solana-mcp"
prod_yml := "prod.yml"

fmt:
    pnpm format
    pnpm lint:fix

test:
    pnpm test

# Deploy app + ingestion job via Databricks Asset Bundle. Reads gitignored
# `prod.yml` for variable values (schema, warehouse_id, vs_index, ...).
deploy:
    @if [ ! -f "{{prod_yml}}" ]; then echo "missing {{prod_yml}} at repo root — see databricks.yml for required variables"; exit 1; fi
    @if [ ! -f "dashboards/solana_mcp.lvdash.json" ]; then echo "missing dashboards/solana_mcp.lvdash.json — cp dashboards/solana_mcp.example.lvdash.json dashboards/solana_mcp.lvdash.json and set catalog/schema per dataset"; exit 1; fi
    pnpm build
    # Enhanced pipeline: runs bundle deploy (job + app + dashboard resources)
    # then creates a new app deployment with the bundle's config.env applied.
    # Dashboard file has catalog/schema per dataset (gitignored real values).
    DATABRICKS_BUNDLE_ENGINE=direct databricks apps deploy --target prod

# Validate bundle config without deploying.
bundle-validate:
    databricks bundle validate --target prod

# Tail recent app logs.
logs-app:
    databricks apps logs {{app}} --tail-lines 100
