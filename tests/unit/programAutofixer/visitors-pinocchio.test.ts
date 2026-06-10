import { describe, expect, it } from "vitest";
import { runProgramAutofixer } from "../../../lib/tools/programAutofixer/handler.js";
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
  VULNERABLE_PDA_ASSERT_EQ_UNRELATED,
  SECURE_ARITHMETIC_LEN_MATH,
  VULNERABLE_ARITHMETIC_LAMPORTS,
  VULNERABLE_UNSAFE_UNWRAP,
  SECURE_UNSAFE_UNWRAP,
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
  VULNERABLE_AUTHORITY_ESC_PASSIVE_COMPARE,
  VULNERABLE_TOKEN_2022,
  SECURE_TOKEN_2022,
  VULNERABLE_INSTR_BOUNDS,
  SECURE_INSTR_BOUNDS,
  VULNERABLE_SEED_COLLISION,
  SECURE_SEED_COLLISION,
  VULNERABLE_ACCOUNT_REL,
  SECURE_ACCOUNT_REL,
  VULNERABLE_ACCOUNT_BORROW,
  SECURE_ACCOUNT_BORROW,
  SECURE_ACCOUNT_BORROW_NESTED_FN,
  VULNERABLE_EXISTING_LAMPORTS,
  SECURE_EXISTING_LAMPORTS,
  SECURE_UNWRAP_FIXED_SLICE_LITERAL,
  SECURE_UNWRAP_FIXED_SLICE_OFFSET,
  SECURE_UNWRAP_TO_LE_BYTES,
  VULNERABLE_UNWRAP_FROM_UTF8,
  VULNERABLE_REINIT_UNRELATED_LAMPORTS,
  SECURE_EXISTING_LAMPORTS_REJECTS,
  SECURE_EXISTING_LAMPORTS_ZERO_BRANCH,
} from "./fixtures-pinocchio.js";

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

const EXTENDED_RULE_FIXTURES: ReadonlyArray<{
  rule: string;
  vulnerable: string;
  secure: string;
}> = [
  { rule: "unsafe-unwrap", vulnerable: VULNERABLE_UNSAFE_UNWRAP, secure: SECURE_UNSAFE_UNWRAP },
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
  { rule: "account-relationship", vulnerable: VULNERABLE_ACCOUNT_REL, secure: SECURE_ACCOUNT_REL },
  { rule: "account-borrow", vulnerable: VULNERABLE_ACCOUNT_BORROW, secure: SECURE_ACCOUNT_BORROW },
  { rule: "existing-lamports", vulnerable: VULNERABLE_EXISTING_LAMPORTS, secure: SECURE_EXISTING_LAMPORTS },
];

describe("program_autofixer Pinocchio visitors", () => {
  it.each(RULE_FIXTURES)(
    "$rule flags the vulnerable fixture",
    async ({ rule, vulnerable }) => {
      const out = await runProgramAutofixer({ code: vulnerable, framework: "pinocchio" });
      const hit = out.issues.find(i => i.rule === rule);
      expect(hit, `expected ${rule} to fire on vulnerable fixture`).toBeDefined();
      const hasBlocking = out.issues.some(i => i.severity === "critical" || i.severity === "high");
      expect(out.require_another_tool_call_after_fixing).toBe(hasBlocking);
    },
    20_000,
  );

  it.each(RULE_FIXTURES)(
    "$rule stays silent on the secure fixture",
    async ({ rule, secure }) => {
      const out = await runProgramAutofixer({ code: secure, framework: "pinocchio" });
      const hit = out.issues.find(i => i.rule === rule);
      expect(hit, `${rule} fired on secure fixture: ${hit?.title}`).toBeUndefined();
    },
    20_000,
  );

  it("sets require_another_tool_call_after_fixing to false on clean code", async () => {
    const clean = `pub fn add(a: u64, b: u64) -> u64 { a.checked_add(b).unwrap_or(0) }`;
    const out = await runProgramAutofixer({ code: clean, framework: "pinocchio" });
    expect(out.issues).toEqual([]);
    expect(out.suggestions).toEqual([]);
    expect(out.require_another_tool_call_after_fixing).toBe(false);
  });

  it("reports parse-error issue for non-Rust input gracefully", async () => {
    const out = await runProgramAutofixer({ code: "this is not rust @#$%^&", framework: "pinocchio" });
    expect(out.require_another_tool_call_after_fixing).toBe(true);
  });

  it("does not force another tool call for low-severity-only findings", async () => {
    const out = await runProgramAutofixer({ code: VULNERABLE_PROGRAM_ID, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "program-id-verification");
    expect(hit, "program-id-verification should fire on vulnerable fixture").toBeDefined();
    expect(hit?.severity).toBe("low");
    expect(out.issues.every(i => i.severity !== "critical" && i.severity !== "high")).toBe(true);
    expect(out.require_another_tool_call_after_fixing).toBe(false);
  }, 20_000);
});

describe("program_autofixer Pinocchio additional visitors", () => {
  it.each(EXTENDED_RULE_FIXTURES)(
    "$rule fires on vulnerable fixture",
    async ({ rule, vulnerable }) => {
      const out = await runProgramAutofixer({ code: vulnerable, framework: "pinocchio" });
      const hit = out.issues.find(i => i.rule === rule);
      expect(
        hit,
        `expected ${rule} to fire on vulnerable fixture; got: ${JSON.stringify(out.issues.map(i => i.rule))}`,
      ).toBeDefined();
    },
    20_000,
  );

  it.each(EXTENDED_RULE_FIXTURES)(
    "$rule stays silent on the secure fixture",
    async ({ rule, secure }) => {
      const out = await runProgramAutofixer({ code: secure, framework: "pinocchio" });
      const hit = out.issues.find(i => i.rule === rule);
      expect(hit, `${rule} fired on secure fixture: ${hit?.title}`).toBeUndefined();
    },
    20_000,
  );
});

describe("program_autofixer Pinocchio suggestions", () => {
  it("accepts inline is_signer guards for missing-signer", async () => {
    const code = `use pinocchio::account_view::AccountView;
use pinocchio::program_error::ProgramError;
pub struct InitAccounts<'a> {
  pub admin: &'a AccountView,
  pub escrow: &'a AccountView,
}
impl<'a> InitAccounts<'a> {
  pub fn try_from(accounts: &'a [AccountView]) -> Result<Self, ProgramError> {
    let [admin, escrow] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    if !admin.is_signer() {
      return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(Self { admin, escrow })
  }
}
`;
    const out = await runProgramAutofixer({ code, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "missing-signer");
    expect(hit, `missing-signer fired after inline signer guard: ${hit?.title}`).toBeUndefined();
  }, 20_000);

  it("accepts inline is_signer guards before authority mutation", async () => {
    const code = `use pinocchio::account_view::AccountView;
use pinocchio::program_error::ProgramError;
struct State { admin: [u8; 32] }
pub fn rotate(
  state: &mut State,
  current_authority: &AccountView,
  new_admin: [u8; 32],
) -> Result<(), ProgramError> {
  if !current_authority.is_signer() {
    return Err(ProgramError::MissingRequiredSignature);
  }
  if current_authority.address() != &state.admin {
    return Err(ProgramError::MissingRequiredSignature);
  }
  state.admin = new_admin;
  Ok(())
}
`;
    const out = await runProgramAutofixer({ code, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "authority-escalation");
    expect(hit, `authority-escalation fired after inline signer guard: ${hit?.title}`).toBeUndefined();
  }, 20_000);

  it("does not imply a writable flag in missing-signer guidance", async () => {
    const out = await runProgramAutofixer({ code: VULNERABLE_MISSING_SIGNER, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "missing-signer");
    expect(hit, "missing-signer should fire on vulnerable fixture").toBeDefined();

    const suggestion = hit?.suggestion ?? "";
    expect(suggestion).toContain(".is_signer()");
    expect(suggestion).not.toMatch(/verify_signer\([^)]*,\s*false\)/);
  }, 20_000);

  it("uses real Pinocchio rent sysvar guidance without unwraps or local shims", async () => {
    const out = await runProgramAutofixer({ code: VULNERABLE_RENT_EXEMPT, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "rent-exempt");
    expect(hit, "rent-exempt should fire on vulnerable fixture").toBeDefined();

    const suggestion = hit?.suggestion ?? "";
    expect(suggestion).toContain("pinocchio::sysvars::{rent::Rent, Sysvar}");
    expect(suggestion).toContain("Rent::get()?.try_minimum_balance(space as usize)?");
    expect(suggestion).not.toContain("unwrap");
  }, 20_000);

  it("does not imply a writable flag in authority-escalation guidance", async () => {
    const out = await runProgramAutofixer({ code: VULNERABLE_AUTHORITY_ESC, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "authority-escalation");
    expect(hit, "authority-escalation should fire on vulnerable fixture").toBeDefined();

    const suggestion = hit?.suggestion ?? "";
    expect(suggestion).toContain("verify_signer(<current_authority>)?");
    expect(suggestion).not.toContain("verify_signer(<current_authority>, false)");
  }, 20_000);
});

describe("program_autofixer framework detection", () => {
  it("auto-detects pinocchio from imports", async () => {
    const out = await runProgramAutofixer({ code: VULNERABLE_MISSING_SIGNER, framework: "auto" });
    expect(out.issues.some(i => i.rule === "missing-signer")).toBe(true);
  });
});

describe("program_autofixer regression cases (no regex fallbacks)", () => {
  it("does not flag pda-validation when validation uses `.ne()` method", async () => {
    const out = await runProgramAutofixer({ code: SECURE_PDA_NE_METHOD, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "pda-validation");
    expect(hit, `pda-validation fired on .ne() validation: ${hit?.title}`).toBeUndefined();
  }, 20_000);

  it("flags pda-validation when validation uses `assert_ne!`", async () => {
    const out = await runProgramAutofixer({ code: VULNERABLE_PDA_ASSERT_NE, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "pda-validation");
    expect(hit, "pda-validation missed assert_ne! rejecting the real PDA").toBeDefined();
  }, 20_000);

  it("flags pda-validation when the PDA is compared to an unrelated key", async () => {
    const out = await runProgramAutofixer({ code: VULNERABLE_PDA_ASSERT_EQ_UNRELATED, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "pda-validation");
    expect(hit, "pda-validation accepted an unrelated Pubkey comparison").toBeDefined();
  }, 20_000);

  it("flags arbitrary-cpi when a different program account was verified", async () => {
    const out = await runProgramAutofixer({ code: VULNERABLE_CPI_MISMATCHED_VERIFY, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "arbitrary-cpi");
    expect(hit, "arbitrary-cpi missed invoke using an unverified program account").toBeDefined();
  }, 20_000);

  it("flags arbitrary-cpi when only one program-shaped account was verified", async () => {
    const out = await runProgramAutofixer({ code: VULNERABLE_CPI_PARTIAL_VERIFY, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "arbitrary-cpi");
    expect(hit, "arbitrary-cpi missed invoke with a partially verified program account list").toBeDefined();
  }, 20_000);

  it("does not flag unchecked-arithmetic on account-layout `len()` math", async () => {
    const out = await runProgramAutofixer({ code: SECURE_ARITHMETIC_LEN_MATH, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "unchecked-arithmetic");
    expect(hit, `unchecked-arithmetic fired on len() math: ${hit?.code_snippet}`).toBeUndefined();
  }, 20_000);

  it("does flag unchecked-arithmetic on lamport math", async () => {
    const out = await runProgramAutofixer({
      code: VULNERABLE_ARITHMETIC_LAMPORTS,
      framework: "pinocchio",
    });
    const hit = out.issues.find(i => i.rule === "unchecked-arithmetic");
    expect(hit, `unchecked-arithmetic missed lamport math`).toBeDefined();
  }, 20_000);
});

describe("unsafe-unwrap noise suppression (infallible try_into patterns)", () => {
  it("suppresses `data[0..N].try_into().unwrap()` with literal range", async () => {
    const out = await runProgramAutofixer({ code: SECURE_UNWRAP_FIXED_SLICE_LITERAL, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "unsafe-unwrap");
    expect(hit, `unsafe-unwrap fired on literal fixed slice: ${hit?.code_snippet}`).toBeUndefined();
  }, 20_000);

  it("suppresses `data[offset..offset + N].try_into().unwrap()`", async () => {
    const out = await runProgramAutofixer({ code: SECURE_UNWRAP_FIXED_SLICE_OFFSET, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "unsafe-unwrap");
    expect(hit, `unsafe-unwrap fired on offset+literal slice: ${hit?.code_snippet}`).toBeUndefined();
  }, 20_000);

  it("suppresses `value.to_le_bytes().try_into().unwrap()`", async () => {
    const out = await runProgramAutofixer({ code: SECURE_UNWRAP_TO_LE_BYTES, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "unsafe-unwrap");
    expect(hit, `unsafe-unwrap fired on to_le_bytes round-trip: ${hit?.code_snippet}`).toBeUndefined();
  }, 20_000);

  it("still flags `from_utf8(attacker_bytes).unwrap()`", async () => {
    const out = await runProgramAutofixer({ code: VULNERABLE_UNWRAP_FROM_UTF8, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "unsafe-unwrap");
    expect(hit, "unsafe-unwrap missed from_utf8 panic site").toBeDefined();
  }, 20_000);
});

describe("program_autofixer Pinocchio cross-check regression cases", () => {
  it("does not count nested function borrows against the outer function", async () => {
    const out = await runProgramAutofixer({
      code: SECURE_ACCOUNT_BORROW_NESTED_FN,
      framework: "pinocchio",
    });
    const hits = out.issues.filter(i => i.rule === "account-borrow");
    expect(hits).toHaveLength(1);
  }, 20_000);

  it("flags authority writes when only an unrelated signer was verified", async () => {
    const out = await runProgramAutofixer({
      code: VULNERABLE_AUTHORITY_ESC_UNRELATED_SIGNER,
      framework: "pinocchio",
    });
    const hit = out.issues.find(i => i.rule === "authority-escalation");
    expect(hit, "authority-escalation missed an unrelated verified signer").toBeDefined();
  }, 20_000);

  it("flags authority writes when the signer comparison is not a rejecting guard", async () => {
    const out = await runProgramAutofixer({
      code: VULNERABLE_AUTHORITY_ESC_PASSIVE_COMPARE,
      framework: "pinocchio",
    });
    const hit = out.issues.find(i => i.rule === "authority-escalation");
    expect(hit, "authority-escalation accepted a passive comparison").toBeDefined();
  }, 20_000);

  it("flags CreateAccount when only an unrelated lamports balance was checked", async () => {
    const out = await runProgramAutofixer({
      code: VULNERABLE_REINIT_UNRELATED_LAMPORTS,
      framework: "pinocchio",
    });
    const hit = out.issues.find(i => i.rule === "reinitialization");
    expect(hit, "reinitialization accepted a lamports check for the wrong account").toBeDefined();
  }, 20_000);

  it("does not require idempotent fallback when the existing-lamports branch rejects", async () => {
    const out = await runProgramAutofixer({
      code: SECURE_EXISTING_LAMPORTS_REJECTS,
      framework: "pinocchio",
    });
    const hit = out.issues.find(i => i.rule === "existing-lamports");
    expect(hit, `existing-lamports flagged an explicit rejection branch: ${hit?.title}`).toBeUndefined();
  }, 20_000);

  it("does not treat a zero-lamports branch as an existing-account branch", async () => {
    const out = await runProgramAutofixer({
      code: SECURE_EXISTING_LAMPORTS_ZERO_BRANCH,
      framework: "pinocchio",
    });
    const hit = out.issues.find(i => i.rule === "existing-lamports");
    expect(hit, `existing-lamports flagged a fresh-account branch: ${hit?.title}`).toBeUndefined();
  }, 20_000);
});

describe("program_autofixer suppression soundness", () => {
  it("does not let a key compare waive the signer requirement without PDA evidence", async () => {
    const code = `use pinocchio::account_view::AccountView;
use pinocchio::program_error::ProgramError;
pub struct A<'a> { pub admin: &'a AccountView }
impl<'a> A<'a> {
  pub fn try_from(accounts: &'a [AccountView]) -> Result<Self, ProgramError> {
    let [admin] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    if admin.key() != &EXPECTED_ADMIN { return Err(ProgramError::IllegalOwner); }
    Ok(Self { admin })
  }
}
`;
    const out = await runProgramAutofixer({ code, framework: "pinocchio" });
    expect(out.issues.some(i => i.rule === "missing-signer")).toBe(true);
  }, 20_000);

  it("accepts an owner check on the account behind a borrowed data buffer", async () => {
    const code = `use pinocchio::account_view::AccountView;
use pinocchio::program_error::ProgramError;
pub fn process(vault: &AccountView) -> Result<(), ProgramError> {
  if !vault.is_owned_by(&crate::ID) { return Err(ProgramError::IllegalOwner); }
  let data = vault.try_borrow_data()?;
  let _state = Vault::from_bytes(&data)?;
  Ok(())
}
`;
    const out = await runProgramAutofixer({ code, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "missing-owner");
    expect(hit, `missing-owner fired despite owner guard on buffer source: ${hit?.title}`).toBeUndefined();
  }, 20_000);

  it("does not suppress missing-owner via a check in an unrelated sibling function", async () => {
    const code = `use pinocchio::account_view::AccountView;
use pinocchio::program_error::ProgramError;
pub fn safe(account: &AccountView) -> Result<(), ProgramError> {
  if !account.is_owned_by(&crate::ID) { return Err(ProgramError::IllegalOwner); }
  let _s = State::from_bytes(account.data())?;
  Ok(())
}
pub fn unsafe_fn(account: &AccountView) -> Result<(), ProgramError> {
  let _s = State::from_bytes(account.data())?;
  Ok(())
}
`;
    const out = await runProgramAutofixer({ code, framework: "pinocchio" });
    expect(out.issues.some(i => i.rule === "missing-owner")).toBe(true);
  }, 20_000);

  it("skips discriminator-check when the program has no discriminator scheme", async () => {
    const code = `use pinocchio::account_view::AccountView;
use pinocchio::program_error::ProgramError;
pub fn process(vault: &AccountView) -> Result<(), ProgramError> {
  if !vault.is_owned_by(&crate::ID) { return Err(ProgramError::IllegalOwner); }
  let data = vault.try_borrow_data()?;
  let _state = Vault::from_bytes(&data)?;
  Ok(())
}
`;
    const out = await runProgramAutofixer({ code, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "discriminator-check");
    expect(hit, `discriminator-check fired without a discriminator scheme: ${hit?.title}`).toBeUndefined();
  }, 20_000);
});

describe("program_autofixer suppression ordering and polarity", () => {
  it("flags missing-owner when the ownership check is after the deserialization sink", async () => {
    const code = `use pinocchio::account_view::AccountView;
use pinocchio::program_error::ProgramError;
pub fn process(vault: &AccountView) -> Result<(), ProgramError> {
  let _s = Vault::from_bytes(vault.data())?;
  verify_current_program_account(vault)?;
  Ok(())
}
`;
    const out = await runProgramAutofixer({ code, framework: "pinocchio" });
    expect(out.issues.some(i => i.rule === "missing-owner")).toBe(true);
  }, 20_000);

  it("does not let a key compare to an arbitrary constant waive missing-signer", async () => {
    const code = `use pinocchio::account_view::AccountView;
use pinocchio::program_error::ProgramError;
use pinocchio::pubkey::find_program_address;
pub struct A<'a> { pub admin: &'a AccountView }
impl<'a> A<'a> {
  pub fn try_from(accounts: &'a [AccountView]) -> Result<Self, ProgramError> {
    let [admin] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    let (_unrelated, _b) = find_program_address(&[b"x"], &crate::ID);
    if admin.key() != &EXPECTED_ADMIN { return Err(ProgramError::IllegalOwner); }
    Ok(Self { admin })
  }
}
`;
    const out = await runProgramAutofixer({ code, framework: "pinocchio" });
    expect(out.issues.some(i => i.rule === "missing-signer")).toBe(true);
  }, 20_000);

  it("waives missing-signer when the account key is compared to a derived PDA", async () => {
    const code = `use pinocchio::account_view::AccountView;
use pinocchio::program_error::ProgramError;
use pinocchio::pubkey::find_program_address;
pub struct A<'a> { pub authority: &'a AccountView }
impl<'a> A<'a> {
  pub fn try_from(accounts: &'a [AccountView]) -> Result<Self, ProgramError> {
    let [authority] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    let (expected, _b) = find_program_address(&[b"auth"], &crate::ID);
    if authority.key() != &expected { return Err(ProgramError::InvalidSeeds); }
    Ok(Self { authority })
  }
}
`;
    const out = await runProgramAutofixer({ code, framework: "pinocchio" });
    expect(out.issues.some(i => i.rule === "missing-signer")).toBe(false);
  }, 20_000);

  it("flags an inverted then_some validation chain (wrong polarity)", async () => {
    const code = `use pinocchio::account_view::AccountView;
use pinocchio::program_error::ProgramError;
pub struct A<'a> { pub admin: &'a AccountView }
impl<'a> A<'a> {
  pub fn try_from(accounts: &'a [AccountView]) -> Result<Self, ProgramError> {
    let [admin] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    (!admin.is_signer()).then_some(()).ok_or(ProgramError::MissingRequiredSignature)?;
    Ok(Self { admin })
  }
}
`;
    const out = await runProgramAutofixer({ code, framework: "pinocchio" });
    expect(out.issues.some(i => i.rule === "missing-signer")).toBe(true);
  }, 20_000);

  it("accepts a correctly-oriented then_some ownership chain", async () => {
    const code = `use pinocchio::account_view::AccountView;
use pinocchio::program_error::ProgramError;
pub fn process(vault: &AccountView) -> Result<(), ProgramError> {
  vault.is_owned_by(&crate::ID).then_some(()).ok_or(ProgramError::IllegalOwner)?;
  let _s = Vault::from_bytes(vault.data())?;
  Ok(())
}
`;
    const out = await runProgramAutofixer({ code, framework: "pinocchio" });
    const hit = out.issues.find(i => i.rule === "missing-owner");
    expect(hit, `missing-owner fired despite valid then_some chain: ${hit?.title}`).toBeUndefined();
  }, 20_000);
});
