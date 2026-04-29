#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load as parseYaml } from "js-yaml";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const YAML_PATH = resolve(REPO_ROOT, "ingestion/sources.yaml");
const OUT_PATH = resolve(REPO_ROOT, "lib/sources.generated.ts");

const SECTION_IDS = [
  "core",
  "programs",
  "frameworks",
  "clients",
  "tokens",
  "nft",
  "defi",
  "liquid-staking",
  "oracles",
  "infra",
  "data",
  "wallets",
  "mobile",
  "governance",
  "testing",
  "tooling",
  "zk",
  "bridges",
  "identity",
  "examples",
  "vm",
];
const ALLOWED_SECTIONS = new Set(SECTION_IDS);
const ALLOWED_KINDS = new Set(["github", "web", "openapi"]);

function fail(msg) {
  console.error(`[build-sources] ${msg}`);
  process.exit(1);
}

function validateEntry(entry, idx) {
  const where = entry?.id ? `source "${entry.id}"` : `source #${idx}`;

  if (!entry || typeof entry !== "object") fail(`${where}: entry is not an object`);
  if (typeof entry.id !== "string" || !entry.id) fail(`${where}: missing string id`);
  if (typeof entry.name !== "string" || !entry.name) fail(`${where}: missing string name`);
  if (!ALLOWED_KINDS.has(entry.kind)) fail(`${where}: kind must be one of ${[...ALLOWED_KINDS].join(", ")}`);
  if (typeof entry.enabled !== "boolean") fail(`${where}: enabled must be boolean`);
  if (typeof entry.primary_url !== "string" || !entry.primary_url) fail(`${where}: missing primary_url`);

  if (!Array.isArray(entry.sections) || entry.sections.length === 0) {
    fail(`${where}: sections must be a non-empty array`);
  }
  for (const tag of entry.sections) {
    if (!ALLOWED_SECTIONS.has(tag)) {
      fail(`${where}: unknown section tag "${tag}" (allowed: ${SECTION_IDS.join(", ")})`);
    }
  }
  const dupes = entry.sections.filter((t, i) => entry.sections.indexOf(t) !== i);
  if (dupes.length > 0) fail(`${where}: duplicate section tags: ${dupes.join(", ")}`);

  if (typeof entry.use_cases !== "string" || !entry.use_cases.trim()) {
    fail(`${where}: use_cases must be a non-empty string`);
  }
}

function buildExport(sources) {
  const lines = [
    "// AUTO-GENERATED from ingestion/sources.yaml — do not edit by hand.",
    "// Regenerate with `pnpm gen:sources`.",
    "",
    'import type { RawSource } from "./sources.types";',
    "",
    "export const RAW_SOURCES: readonly RawSource[] = [",
  ];
  for (const s of sources) {
    const rec = {
      id: s.id,
      name: s.name,
      kind: s.kind,
      enabled: s.enabled,
      primary_url: s.primary_url,
      sections: s.sections,
      use_cases: s.use_cases,
    };
    lines.push(`  ${JSON.stringify(rec)},`);
  }
  lines.push("] as const;", "");
  return lines.join("\n");
}

function main() {
  const yamlText = readFileSync(YAML_PATH, "utf8");
  const parsed = parseYaml(yamlText);
  if (!parsed || typeof parsed !== "object") fail("sources.yaml did not parse to an object");
  const list = parsed.sources;
  if (!Array.isArray(list)) fail("sources.yaml is missing a top-level `sources:` array");

  list.forEach(validateEntry);

  const ids = list.map(s => s.id);
  const dupeIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupeIds.length > 0) fail(`duplicate source ids: ${[...new Set(dupeIds)].join(", ")}`);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, buildExport(list), "utf8");
  console.warn(`[build-sources] wrote ${list.length} sources → ${OUT_PATH}`);
}

main();
