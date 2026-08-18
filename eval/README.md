# MCP eval harness

Quality benchmark for MCP servers exposing the Solana documentation tools.
Point it at any number of streamable-HTTP MCP endpoints and it fires the 50
questions in `questions.jsonl` (anchor, core, rpc, spl, defi, errors, kit,
web3js, perf, wallet) at each, then writes a markdown report per question
plus an aggregate `index.md` into `eval/results/<timestamp>/`.

No dependencies beyond `dotenv`; runs with `tsx`.

## Quick start

```sh
cp eval/.env.example eval/.env   # optional, flags work without it

# benchmark your MCP against prod
pnpm dlx tsx eval/run.ts \
  --endpoint prod=https://mcp.solana.com/mcp \
  --endpoint mine=https://my-mcp.example.com/mcp
```

Or via Justfile: `just eval https://my-mcp.example.com/mcp`.

A single `--endpoint` also works if you just want a standalone report.

## Configuration

| Setting                   | Meaning                                                                | Default                       |
| ------------------------- | ---------------------------------------------------------------------- | ----------------------------- |
| `--endpoint <name>=<url>` | Endpoint under test, repeatable                                        | required                      |
| `EVAL_ENDPOINTS`          | Fallback endpoint list, `name=url,name=url`                            | unset                         |
| `EVAL_TOKEN_<NAME>`       | Bearer token for endpoint `<name>` (uppercased, dashes to underscores) | none                          |
| `EVAL_TOOL`               | Tool to call                                                           | `Solana_Documentation_Search` |
| `EVAL_OUT`                | Output directory                                                       | `eval/results/<iso-ts>`       |

## What it measures

Per endpoint per question: latency, response length, citation count (URLs in
the response, deduped), and keyword hit rate against the question's
`expected_keywords`. A keyword can be a string or an array of synonyms
(`["findProgramAddress", "find_program_address"]`); any variant matching
counts as a hit. Aggregate: median latency, error count, average keyword hit
rate overall and per category.

## Caveats

- Keyword hit rate is a case-insensitive substring proxy, not a correctness
  score. A miss can be phrasing (`findProgramAddress` vs
  `findProgramAddressSync`), not a wrong answer. Read the per-question
  markdown before drawing conclusions.
- Questions run sequentially; a full run takes a few minutes at typical RAG
  latency.
- Results contain full tool responses. `eval/results/` is gitignored; keep
  it that way.
