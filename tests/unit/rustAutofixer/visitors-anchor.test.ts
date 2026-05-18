import { describe, expect, it } from "vitest";
import { runRustAutofixer } from "../../../lib/tools/rustAutofixer/handler.js";
import {
  VULNERABLE_SEEDS_WITHOUT_BUMP,
  SECURE_SEEDS_WITH_BUMP,
  VULNERABLE_INIT_WITHOUT_SPACE,
  SECURE_INIT_WITH_SPACE,
  SECURE_SPL_MINT_INIT_WITHOUT_SPACE,
  VULNERABLE_INIT_WITHOUT_PAYER,
  SECURE_INIT_WITH_PAYER,
  VULNERABLE_NESTED_INIT_WITHOUT_PAYER,
  VULNERABLE_REALLOC_INCOMPLETE,
  SECURE_REALLOC_COMPLETE,
  VULNERABLE_UNCHECKED_ACCOUNT,
  SECURE_TYPED_ACCOUNT,
  VULNERABLE_ACCOUNT_NOT_INTERFACE,
  SECURE_ACCOUNT_INTERFACE,
  VULNERABLE_MANUAL_SIGNER_CHECK,
  SECURE_TYPED_SIGNER,
  VULNERABLE_MANUAL_KEY_EQ,
  SECURE_HAS_ONE,
  VULNERABLE_EMIT_VIA_MSG,
  SECURE_EMIT,
  VULNERABLE_MISSING_MUT,
  SECURE_MUT_CONSTRAINT,
  VULNERABLE_MISSING_MUT_DUPLICATE_FIELD,
  VULNERABLE_MISSING_MUT_TO_ACCOUNT_INFO,
  SECURE_LOCAL_FIELD_MUTATION,
  VULNERABLE_CPI_UNVERIFIED,
  VULNERABLE_CPI_UNVERIFIED_ALIAS,
  SECURE_CPI_TYPED_PROGRAM,
  VULNERABLE_CPI_UNVERIFIED_DUPLICATE_FIELD,
  VULNERABLE_CLOSE_MANUAL,
  SECURE_CLOSE_CONSTRAINT,
  VULNERABLE_CLOSE_MANUAL_DUPLICATE_FIELD,
} from "./fixtures-anchor.js";

const PAIRS: ReadonlyArray<{
  rule: string;
  vulnerable: string;
  secure: string;
}> = [
  { rule: "anchor-seeds-without-bump", vulnerable: VULNERABLE_SEEDS_WITHOUT_BUMP, secure: SECURE_SEEDS_WITH_BUMP },
  { rule: "anchor-init-without-space", vulnerable: VULNERABLE_INIT_WITHOUT_SPACE, secure: SECURE_INIT_WITH_SPACE },
  { rule: "anchor-init-without-payer", vulnerable: VULNERABLE_INIT_WITHOUT_PAYER, secure: SECURE_INIT_WITH_PAYER },
  { rule: "anchor-realloc-incomplete", vulnerable: VULNERABLE_REALLOC_INCOMPLETE, secure: SECURE_REALLOC_COMPLETE },
  { rule: "anchor-unchecked-account", vulnerable: VULNERABLE_UNCHECKED_ACCOUNT, secure: SECURE_TYPED_ACCOUNT },
  {
    rule: "anchor-account-not-interface",
    vulnerable: VULNERABLE_ACCOUNT_NOT_INTERFACE,
    secure: SECURE_ACCOUNT_INTERFACE,
  },
  {
    rule: "anchor-manual-signer-check",
    vulnerable: VULNERABLE_MANUAL_SIGNER_CHECK,
    secure: SECURE_TYPED_SIGNER,
  },
  { rule: "anchor-manual-key-eq", vulnerable: VULNERABLE_MANUAL_KEY_EQ, secure: SECURE_HAS_ONE },
  { rule: "anchor-emit-via-msg", vulnerable: VULNERABLE_EMIT_VIA_MSG, secure: SECURE_EMIT },
  { rule: "anchor-missing-mut", vulnerable: VULNERABLE_MISSING_MUT, secure: SECURE_MUT_CONSTRAINT },
  {
    rule: "anchor-cpi-context-unverified",
    vulnerable: VULNERABLE_CPI_UNVERIFIED,
    secure: SECURE_CPI_TYPED_PROGRAM,
  },
  {
    rule: "anchor-close-without-receiver",
    vulnerable: VULNERABLE_CLOSE_MANUAL,
    secure: SECURE_CLOSE_CONSTRAINT,
  },
];

describe("rust_autofixer Anchor visitors", () => {
  it.each(PAIRS)(
    "$rule fires on vulnerable Anchor fixture",
    async ({ rule, vulnerable }) => {
      const out = await runRustAutofixer({ code: vulnerable, framework: "anchor" });
      const hit = out.issues.find(i => i.rule === rule);
      expect(hit, `expected ${rule} to fire; got: ${JSON.stringify(out.issues.map(i => i.rule))}`).toBeDefined();
    },
    20_000,
  );

  it.each(PAIRS)(
    "$rule silent on secure Anchor fixture",
    async ({ rule, secure }) => {
      const out = await runRustAutofixer({ code: secure, framework: "anchor" });
      const hit = out.issues.find(i => i.rule === rule);
      expect(hit, `${rule} fired on secure fixture: ${hit?.title}`).toBeUndefined();
    },
    20_000,
  );

  it("auto-detects Anchor and runs Anchor visitors", async () => {
    const out = await runRustAutofixer({ code: VULNERABLE_INIT_WITHOUT_PAYER, framework: "auto" });
    const hit = out.issues.find(i => i.rule === "anchor-init-without-payer");
    expect(hit, "auto-detect failed to identify Anchor + run Anchor visitors").toBeDefined();
  }, 20_000);

  it("collects Accounts derives nested inside modules", async () => {
    const out = await runRustAutofixer({ code: VULNERABLE_NESTED_INIT_WITHOUT_PAYER, framework: "anchor" });
    const hit = out.issues.find(i => i.rule === "anchor-init-without-payer");
    expect(hit, "nested #[derive(Accounts)] struct was not analyzed").toBeDefined();
  }, 20_000);

  it.each([
    {
      rule: "anchor-missing-mut",
      code: VULNERABLE_MISSING_MUT_DUPLICATE_FIELD,
    },
    {
      rule: "anchor-cpi-context-unverified",
      code: VULNERABLE_CPI_UNVERIFIED_DUPLICATE_FIELD,
    },
    {
      rule: "anchor-close-without-receiver",
      code: VULNERABLE_CLOSE_MANUAL_DUPLICATE_FIELD,
    },
  ])(
    "resolves duplicate account field names through handler Context<T> for $rule",
    async ({ rule, code }) => {
      const out = await runRustAutofixer({ code, framework: "anchor" });
      const hit = out.issues.find(i => i.rule === rule);
      expect(hit, `${rule} was masked by another Accounts struct with the same field name`).toBeDefined();
    },
    20_000,
  );

  it("does not treat local field mutations as ctx.accounts mutations", async () => {
    const out = await runRustAutofixer({ code: SECURE_LOCAL_FIELD_MUTATION, framework: "anchor" });
    const hit = out.issues.find(i => i.rule === "anchor-missing-mut");
    expect(hit, `local field mutation was reported as an account mutation: ${hit?.title}`).toBeUndefined();
  }, 20_000);

  it("flags missing mut when mutation goes through to_account_info()", async () => {
    const out = await runRustAutofixer({ code: VULNERABLE_MISSING_MUT_TO_ACCOUNT_INFO, framework: "anchor" });
    const hit = out.issues.find(i => i.rule === "anchor-missing-mut");
    expect(hit, "anchor-missing-mut missed a to_account_info() mutable borrow").toBeDefined();
  }, 20_000);

  it("resolves local program aliases before CpiContext::new", async () => {
    const out = await runRustAutofixer({ code: VULNERABLE_CPI_UNVERIFIED_ALIAS, framework: "anchor" });
    const hit = out.issues.find(i => i.rule === "anchor-cpi-context-unverified");
    expect(hit, "anchor-cpi-context-unverified missed an aliased program account").toBeDefined();
  }, 20_000);

  it("does not require `space` for Anchor SPL mint initialization", async () => {
    const out = await runRustAutofixer({ code: SECURE_SPL_MINT_INIT_WITHOUT_SPACE, framework: "anchor" });
    const hit = out.issues.find(i => i.rule === "anchor-init-without-space");
    expect(hit, `anchor-init-without-space flagged SPL init: ${hit?.title}`).toBeUndefined();
  }, 20_000);
});
