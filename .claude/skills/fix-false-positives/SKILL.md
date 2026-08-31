---
name: fix-false-positives
description: Use when the user asks to "fix false positives", "check FP stats", "triage autofixer false positives", "why is rule X getting dismissed", or wants to reduce dismissal rates in the program_autofixer. Queries live dismissal telemetry from Databricks, ranks rules by false-positive burden, diagnoses the root cause in the rule's visitor, and implements a fix with the user approving each step.
user-invocable: true
---

# Fix autofixer false positives

Reduce `program_autofixer` false positives using real dismissal telemetry. The model dismisses an issue when it verifies a `false_positive_hints` condition holds, so a high dismissal rate on a rule means that rule's analysis is missing something the model can see.

This skill is a conversation, not a batch job. Never implement a fix the user has not approved, and never claim a root cause you have not confirmed by reading the rule source.

## 1. Fetch the stats

Rank rules by dismissal burden over the last 90 days:

```sql
WITH parsed AS (
  SELECT from_json(response_text, 'rules array<string>, dismissed_rules array<string>') AS j
  FROM ${catalog}.${schema}.mcp_tool_calls
  WHERE tool_name = 'program_autofixer' AND row_type = 'response'
    AND timestamp >= current_timestamp() - INTERVAL 90 DAYS
),
fires AS (
  SELECT explode(j.rules) AS rule, 1 AS fired, 0 AS dismissed FROM parsed
  UNION ALL
  SELECT explode(j.dismissed_rules) AS rule, 0 AS fired, 1 AS dismissed FROM parsed
)
SELECT rule, sum(fired) AS fires, sum(dismissed) AS dismissals,
       round(100.0 * sum(dismissed) / nullif(sum(fired), 0), 1) AS dismissal_pct
FROM fires
GROUP BY rule
HAVING sum(fired) > 0
ORDER BY dismissals DESC
LIMIT 20
```

Use `mcp__databricks__execute_sql_read_only`. Substitute `${catalog}` and `${schema}` from the deployed bundle values for the `catalog` and `schema` variables declared in `databricks.yml`; they are intentionally not committed, so ask the user if you cannot resolve them. Note that `rules` is a distinct set per tool call, so `fires` counts calls where the rule appeared, not individual issues.

Rank by absolute `dismissals`, not by percentage: a rule at 50% of 4 fires is noise, a rule at 20% of 800 fires is the real cost. Ignore rules under ~20 fires.

The 90-day window spans past fixes. Check `git log --oneline -20 -- lib/tools/programAutofixer/visitors/` for rules already fixed; for those, re-run the query with a window starting after the fix deployed to see whether it actually worked, and tell the user the before/after. That is how the loop closes: a previous run's fix is graded at the start of the next run, not at the end of its own.

Present the top rules to the user as a short table and ask which one to work on. Recommend one and say why.

## 2. Find which blind spot

For the chosen rule, break dismissals down by which `false_positive_hints` index the model matched:

```sql
WITH parsed AS (
  SELECT from_json(response_text, 'dismissed_hint_counts map<string, map<string, int>>') AS j
  FROM ${catalog}.${schema}.mcp_tool_calls
  WHERE tool_name = 'program_autofixer' AND row_type = 'response'
    AND timestamp >= current_timestamp() - INTERVAL 90 DAYS
),
hits AS (SELECT explode(j.dismissed_hint_counts) AS (rule, buckets) FROM parsed)
SELECT rule, bucket, sum(n) AS dismissals
FROM hits LATERAL VIEW explode(buckets) AS bucket, n
WHERE rule = '<RULE>'
GROUP BY rule, bucket
ORDER BY dismissals DESC
```

Bucket keys are the hint index as a string, `'other'` when no listed hint matched, or `'unspecified'` when the caller omitted `matched_hint`. Map each index back to the hint text in the rule's visitor.

These counts are per dismissed issue, while step 1 counts calls, so the buckets sum higher than the step 1 dismissal count. Compare buckets against each other, not against step 1.

A large `other` bucket means the hints themselves are incomplete: the model is finding a blind spot nobody has written down. That is a different fix from a hint index dominating.

Dismissal `reason` text and fingerprints are deliberately not logged, so the telemetry tells you *which* condition, never the specific code. Do not go looking for a raw reason column.

## 3. Diagnose

Read the rule at `lib/tools/programAutofixer/visitors/<rule>.ts` and its `false_positive_hints`. Shared analysis lives in `_helpers.ts` and `_anchor-helpers.ts`; the walker and visitor context are in `walk.ts` and `handler.ts`.

Common root causes seen so far:

- **Scope too narrow.** Rule checks only the current function, but the verification lives in a caller, a helper, or elsewhere in the file. This was the `arbitrary-cpi` case (commit `9bbf0be`).
- **Pattern too literal.** Rule matches one spelling of a safe construct and misses equivalent ones (builder chains, qualified paths, aliases).
- **Missing framework knowledge.** Anchor constraint or macro already enforces the property, rule does not know about it.

State the root cause to the user in a couple of sentences with the file:line evidence. If the telemetry and the source disagree, say so and stop rather than guessing.

## 4. Propose, then confirm

Propose the narrowest fix that kills the identified bucket. Give the user:

- what changes, in which file
- roughly how many of the observed dismissals it should eliminate
- what it deliberately does not cover
- the false-negative risk: every FP fix widens what the rule accepts as safe, so name what a real attacker could now slip past

Ask the user to approve, adjust, or reject before writing any code. If the fix would suppress a genuine vulnerability class, say that plainly and prefer rewording the hint over loosening the check.

## 5. Implement

- Edit the rule (and helpers, if the analysis is shared).
- Add fixtures to `tests/unit/programAutofixer/fixtures-anchor.ts` or `fixtures-pinocchio.ts` covering both directions: the FP pattern must stop firing, and a near-miss unsafe variant must still fire.
- Run `pnpm test`. Report the real result; if anything fails, say so and fix it before continuing.
- Update `false_positive_hints` if the fix makes a listed condition obsolete or reveals a new one.

Commit with a `fix(autofixer):` message describing the behavior change. Do not push or open a PR unless the user asks.

Passing tests are not proof the fix worked; only telemetry is, and that arrives weeks later. Step 1 of the next run grades this one.
