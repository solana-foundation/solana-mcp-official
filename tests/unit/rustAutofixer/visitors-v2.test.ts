import { describe, expect, it } from "vitest";
import { runRustAutofixer } from "../../../lib/tools/rustAutofixer/handler.js";
import {
  VULNERABLE_UNSAFE_UNWRAP,
  SECURE_UNSAFE_UNWRAP,
  VULNERABLE_EVENT_VIA_CPI,
  SECURE_EVENT_VIA_CPI,
  VULNERABLE_UNCHECKED_DESER,
  SECURE_UNCHECKED_DESER,
  VULNERABLE_DATA_SIZE,
  SECURE_DATA_SIZE,
  VULNERABLE_TYPE_COSPLAY,
  SECURE_TYPE_COSPLAY,
  VULNERABLE_ACCOUNT_CLOSURE,
  SECURE_ACCOUNT_CLOSURE,
  VULNERABLE_REINIT,
  SECURE_REINIT,
  VULNERABLE_RENT_EXEMPT,
  SECURE_RENT_EXEMPT,
  VULNERABLE_AUTHORITY_ESC,
  SECURE_AUTHORITY_ESC,
  VULNERABLE_AUTHORITY_ESC_UNRELATED_SIGNER,
  VULNERABLE_TOKEN_2022,
  SECURE_TOKEN_2022,
  VULNERABLE_INSTR_BOUNDS,
  SECURE_INSTR_BOUNDS,
  VULNERABLE_SEED_COLLISION,
  SECURE_SEED_COLLISION,
  VULNERABLE_BUMP_CANON,
  SECURE_BUMP_CANON,
  VULNERABLE_WRITABLE_MUTATION,
  SECURE_WRITABLE_MUTATION,
  VULNERABLE_ACCOUNT_REL,
  SECURE_ACCOUNT_REL,
  VULNERABLE_ACCOUNT_BORROW,
  SECURE_ACCOUNT_BORROW,
  VULNERABLE_EXISTING_LAMPORTS,
  SECURE_EXISTING_LAMPORTS,
  SECURE_UNWRAP_FIXED_SLICE_LITERAL,
  SECURE_UNWRAP_FIXED_SLICE_OFFSET,
  SECURE_UNWRAP_TO_LE_BYTES,
  VULNERABLE_UNWRAP_FROM_UTF8,
} from "./fixtures-v2.js";

const PAIRS: ReadonlyArray<{
  rule: string;
  vulnerable: string;
  secure: string;
}> = [
  { rule: "unsafe-unwrap", vulnerable: VULNERABLE_UNSAFE_UNWRAP, secure: SECURE_UNSAFE_UNWRAP },
  { rule: "event-via-cpi", vulnerable: VULNERABLE_EVENT_VIA_CPI, secure: SECURE_EVENT_VIA_CPI },
  { rule: "unchecked-deserialization", vulnerable: VULNERABLE_UNCHECKED_DESER, secure: SECURE_UNCHECKED_DESER },
  { rule: "data-size-validation", vulnerable: VULNERABLE_DATA_SIZE, secure: SECURE_DATA_SIZE },
  { rule: "type-cosplay", vulnerable: VULNERABLE_TYPE_COSPLAY, secure: SECURE_TYPE_COSPLAY },
  { rule: "account-closure", vulnerable: VULNERABLE_ACCOUNT_CLOSURE, secure: SECURE_ACCOUNT_CLOSURE },
  { rule: "reinitialization", vulnerable: VULNERABLE_REINIT, secure: SECURE_REINIT },
  { rule: "rent-exempt", vulnerable: VULNERABLE_RENT_EXEMPT, secure: SECURE_RENT_EXEMPT },
  { rule: "authority-escalation", vulnerable: VULNERABLE_AUTHORITY_ESC, secure: SECURE_AUTHORITY_ESC },
  { rule: "token-2022-extensions", vulnerable: VULNERABLE_TOKEN_2022, secure: SECURE_TOKEN_2022 },
  { rule: "instruction-data-bounds", vulnerable: VULNERABLE_INSTR_BOUNDS, secure: SECURE_INSTR_BOUNDS },
  { rule: "pda-seed-collision", vulnerable: VULNERABLE_SEED_COLLISION, secure: SECURE_SEED_COLLISION },
  { rule: "bump-canonicalization", vulnerable: VULNERABLE_BUMP_CANON, secure: SECURE_BUMP_CANON },
  { rule: "writable-mutation", vulnerable: VULNERABLE_WRITABLE_MUTATION, secure: SECURE_WRITABLE_MUTATION },
  { rule: "account-relationship", vulnerable: VULNERABLE_ACCOUNT_REL, secure: SECURE_ACCOUNT_REL },
  { rule: "account-borrow", vulnerable: VULNERABLE_ACCOUNT_BORROW, secure: SECURE_ACCOUNT_BORROW },
  { rule: "existing-lamports", vulnerable: VULNERABLE_EXISTING_LAMPORTS, secure: SECURE_EXISTING_LAMPORTS },
];

describe("rust_autofixer v1.1 visitors (Checks 5, 9, 10, 12-17, 19, 21-27)", () => {
  it.each(PAIRS)(
    "$rule fires on vulnerable fixture",
    async ({ rule, vulnerable }) => {
      const out = await runRustAutofixer({ code: vulnerable, framework: "pinocchio" });
      const hit = out.issues.find(i => i.rule === rule);
      expect(
        hit,
        `expected ${rule} to fire on vulnerable fixture; got: ${JSON.stringify(out.issues.map(i => i.rule))}`,
      ).toBeDefined();
    },
    20_000,
  );

  it.each(PAIRS)(
    "$rule silent on secure fixture",
    async ({ rule, secure }) => {
      const out = await runRustAutofixer({ code: secure, framework: "pinocchio" });
      const hit = out.issues.find(i => i.rule === rule);
      expect(hit, `${rule} fired on secure fixture: ${hit?.title}`).toBeUndefined();
    },
    20_000,
  );
});

describe("unsafe-unwrap noise suppression (infallible try_into patterns)", () => {
  it("suppresses `data[0..N].try_into().unwrap()` with literal range", async () => {
    const out = await runRustAutofixer({ code: SECURE_UNWRAP_FIXED_SLICE_LITERAL, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "unsafe-unwrap");
    expect(hit, `unsafe-unwrap fired on literal fixed slice: ${hit?.code_snippet}`).toBeUndefined();
  }, 20_000);

  it("suppresses `data[offset..offset + N].try_into().unwrap()`", async () => {
    const out = await runRustAutofixer({ code: SECURE_UNWRAP_FIXED_SLICE_OFFSET, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "unsafe-unwrap");
    expect(hit, `unsafe-unwrap fired on offset+literal slice: ${hit?.code_snippet}`).toBeUndefined();
  }, 20_000);

  it("suppresses `value.to_le_bytes().try_into().unwrap()`", async () => {
    const out = await runRustAutofixer({ code: SECURE_UNWRAP_TO_LE_BYTES, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "unsafe-unwrap");
    expect(hit, `unsafe-unwrap fired on to_le_bytes round-trip: ${hit?.code_snippet}`).toBeUndefined();
  }, 20_000);

  it("still flags `from_utf8(attacker_bytes).unwrap()`", async () => {
    const out = await runRustAutofixer({ code: VULNERABLE_UNWRAP_FROM_UTF8, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "unsafe-unwrap");
    expect(hit, "unsafe-unwrap missed from_utf8 panic site").toBeDefined();
  }, 20_000);
});

describe("authority-escalation signer matching", () => {
  it("flags authority writes when only an unrelated signer was verified", async () => {
    const out = await runRustAutofixer({
      code: VULNERABLE_AUTHORITY_ESC_UNRELATED_SIGNER,
      framework: "pinocchio",
    });
    const hit = out.issues.find(i => i.rule === "authority-escalation");
    expect(hit, "authority-escalation missed an unrelated verified signer").toBeDefined();
  }, 20_000);
});
