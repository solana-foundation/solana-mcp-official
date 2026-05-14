set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

prod_yml := "prod.yml"

fmt:
    pnpm format
    pnpm lint:fix

test:
    pnpm test

# Deploy ingestion job + dashboard via Databricks Asset Bundle. Reads
# gitignored `prod.yml` for variable values (schema, warehouse_id, vs_index,
# ...). The MCP server itself runs on Cloud Run and is deployed automatically
# on push to main via .github/workflows/deploy-cloudrun.yml; the Databricks
# side only owns retrieval + analytics.
deploy:
    @if [ ! -f "{{prod_yml}}" ]; then echo "missing {{prod_yml}} at repo root — see databricks.yml for required variables"; exit 1; fi
    @if [ ! -f "dashboards/solana_mcp.lvdash.json" ]; then echo "missing dashboards/solana_mcp.lvdash.json — cp dashboards/solana_mcp.example.lvdash.json dashboards/solana_mcp.lvdash.json and set catalog/schema per dataset"; exit 1; fi
    databricks bundle deploy --target prod

# Validate bundle config without deploying.
bundle-validate:
    databricks bundle validate --target prod
