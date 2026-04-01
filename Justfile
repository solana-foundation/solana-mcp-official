set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
    @just --list

setup:
    pnpm install

fmt: format-check

format:
    pnpm format

format-check:
    pnpm format:check

lint:
    pnpm lint

lint-fix:
    pnpm lint:fix

typecheck:
    pnpm typecheck

test:
    SUPABASE_URL=https://example.com SUPABASE_SERVICE_ROLE_KEY=example pnpm test:ci

ci: format-check lint typecheck test
