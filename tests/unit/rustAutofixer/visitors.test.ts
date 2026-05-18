import { describe, expect, it } from "vitest";
import { runRustAutofixer } from "../../../lib/tools/rustAutofixer/handler.js";
import {
  VULNERABLE_MISSING_SIGNER,
  SECURE_MISSING_SIGNER,
  VULNERABLE_MISSING_OWNER,
  SECURE_MISSING_OWNER,
  VULNERABLE_PROGRAM_ID,
  SECURE_PROGRAM_ID,
  VULNERABLE_ARITHMETIC,
  SECURE_ARITHMETIC,
  VULNERABLE_CPI,
  SECURE_CPI,
  VULNERABLE_CPI_MISMATCHED_VERIFY,
  VULNERABLE_CPI_PARTIAL_VERIFY,
  VULNERABLE_PDA,
  SECURE_PDA,
  VULNERABLE_SYSVAR,
  SECURE_SYSVAR,
  SECURE_PDA_NE_METHOD,
  VULNERABLE_PDA_ASSERT_NE,
  SECURE_ARITHMETIC_LEN_MATH,
  VULNERABLE_ARITHMETIC_LAMPORTS,
} from "./fixtures.js";

const RULE_FIXTURES: ReadonlyArray<{
  rule: string;
  vulnerable: string;
  secure: string;
}> = [
  { rule: "missing-signer", vulnerable: VULNERABLE_MISSING_SIGNER, secure: SECURE_MISSING_SIGNER },
  { rule: "missing-owner", vulnerable: VULNERABLE_MISSING_OWNER, secure: SECURE_MISSING_OWNER },
  { rule: "program-id-verification", vulnerable: VULNERABLE_PROGRAM_ID, secure: SECURE_PROGRAM_ID },
  { rule: "unchecked-arithmetic", vulnerable: VULNERABLE_ARITHMETIC, secure: SECURE_ARITHMETIC },
  { rule: "arbitrary-cpi", vulnerable: VULNERABLE_CPI, secure: SECURE_CPI },
  { rule: "pda-validation", vulnerable: VULNERABLE_PDA, secure: SECURE_PDA },
  { rule: "sysvar-spoofing", vulnerable: VULNERABLE_SYSVAR, secure: SECURE_SYSVAR },
];

describe("rust_autofixer visitors", () => {
  it.each(RULE_FIXTURES)(
    "$rule flags the vulnerable fixture",
    async ({ rule, vulnerable }) => {
      const out = await runRustAutofixer({ code: vulnerable, framework: "pinocchio" });
      const hit = out.issues.find(i => i.rule === rule);
      expect(hit, `expected ${rule} to fire on vulnerable fixture`).toBeDefined();
      expect(out.require_another_tool_call_after_fixing).toBe(true);
    },
    20_000,
  );

  it.each(RULE_FIXTURES)(
    "$rule stays silent on the secure fixture",
    async ({ rule, secure }) => {
      const out = await runRustAutofixer({ code: secure, framework: "pinocchio" });
      const hit = out.issues.find(i => i.rule === rule);
      expect(hit, `${rule} fired on secure fixture: ${hit?.title}`).toBeUndefined();
    },
    20_000,
  );

  it("sets require_another_tool_call_after_fixing to false on clean code", async () => {
    const clean = `pub fn add(a: u64, b: u64) -> u64 { a.checked_add(b).unwrap_or(0) }`;
    const out = await runRustAutofixer({ code: clean, framework: "pinocchio" });
    expect(out.issues).toEqual([]);
    expect(out.suggestions).toEqual([]);
    expect(out.require_another_tool_call_after_fixing).toBe(false);
  });

  it("reports parse-error issue for non-Rust input gracefully", async () => {
    const out = await runRustAutofixer({ code: "this is not rust @#$%^&", framework: "pinocchio" });
    expect(out.require_another_tool_call_after_fixing).toBe(true);
  });
});

describe("rust_autofixer framework detection", () => {
  it("auto-detects pinocchio from imports", async () => {
    const out = await runRustAutofixer({ code: VULNERABLE_MISSING_SIGNER, framework: "auto" });
    expect(out.issues.some(i => i.rule === "missing-signer")).toBe(true);
  });
});

describe("rust_autofixer regression cases (no regex fallbacks)", () => {
  it("does not flag pda-validation when validation uses `.ne()` method", async () => {
    const out = await runRustAutofixer({ code: SECURE_PDA_NE_METHOD, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "pda-validation");
    expect(hit, `pda-validation fired on .ne() validation: ${hit?.title}`).toBeUndefined();
  }, 20_000);

  it("flags pda-validation when validation uses `assert_ne!`", async () => {
    const out = await runRustAutofixer({ code: VULNERABLE_PDA_ASSERT_NE, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "pda-validation");
    expect(hit, "pda-validation missed assert_ne! rejecting the real PDA").toBeDefined();
  }, 20_000);

  it("flags arbitrary-cpi when a different program account was verified", async () => {
    const out = await runRustAutofixer({ code: VULNERABLE_CPI_MISMATCHED_VERIFY, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "arbitrary-cpi");
    expect(hit, "arbitrary-cpi missed invoke using an unverified program account").toBeDefined();
  }, 20_000);

  it("flags arbitrary-cpi when only one program-shaped account was verified", async () => {
    const out = await runRustAutofixer({ code: VULNERABLE_CPI_PARTIAL_VERIFY, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "arbitrary-cpi");
    expect(hit, "arbitrary-cpi missed invoke with a partially verified program account list").toBeDefined();
  }, 20_000);

  it("does not flag unchecked-arithmetic on account-layout `len()` math", async () => {
    const out = await runRustAutofixer({ code: SECURE_ARITHMETIC_LEN_MATH, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "unchecked-arithmetic");
    expect(hit, `unchecked-arithmetic fired on len() math: ${hit?.code_snippet}`).toBeUndefined();
  }, 20_000);

  it("does flag unchecked-arithmetic on lamport math", async () => {
    const out = await runRustAutofixer({
      code: VULNERABLE_ARITHMETIC_LAMPORTS,
      framework: "pinocchio",
    });
    const hit = out.issues.find(i => i.rule === "unchecked-arithmetic");
    expect(hit, `unchecked-arithmetic missed lamport math`).toBeDefined();
  }, 20_000);
});
