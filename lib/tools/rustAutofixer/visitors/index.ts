import type { Visitor } from "../types.js";
import { missingSigner } from "./missing-signer.js";
import { missingOwner } from "./missing-owner.js";
import { discriminatorCheck } from "./discriminator-check.js";
import { programIdVerification } from "./program-id-verification.js";
import { readonlyEnforcement } from "./readonly-enforcement.js";
import { uncheckedArithmetic } from "./unchecked-arithmetic.js";
import { sysvarSpoofing } from "./sysvar-spoofing.js";
import { arbitraryCpi } from "./arbitrary-cpi.js";
import { pdaValidation } from "./pda-validation.js";
import { signerNecessity } from "./signer-necessity.js";
import { unsafeUnwrap } from "./unsafe-unwrap.js";
import { eventViaCpi } from "./event-via-cpi.js";
import { uncheckedDeserialization } from "./unchecked-deserialization.js";
import { dataSizeValidation } from "./data-size-validation.js";
import { typeCosplay } from "./type-cosplay.js";
import { accountClosure } from "./account-closure.js";
import { reinitialization } from "./reinitialization.js";
import { existingLamports } from "./existing-lamports.js";
import { rentExempt } from "./rent-exempt.js";
import { authorityEscalation } from "./authority-escalation.js";
import { token2022Extensions } from "./token-2022-extensions.js";
import { instructionDataBounds } from "./instruction-data-bounds.js";
import { pdaSeedCollision } from "./pda-seed-collision.js";
import { bumpCanonicalization } from "./bump-canonicalization.js";
import { writableMutation } from "./writable-mutation.js";
import { accountRelationship } from "./account-relationship.js";
import { accountBorrow } from "./account-borrow.js";
import { anchorSeedsWithoutBump } from "./anchor-seeds-without-bump.js";
import { anchorInitWithoutSpace } from "./anchor-init-without-space.js";
import { anchorInitWithoutPayer } from "./anchor-init-without-payer.js";
import { anchorReallocIncomplete } from "./anchor-realloc-incomplete.js";
import { anchorUncheckedAccount } from "./anchor-unchecked-account.js";

/**
 * 27-check visitor registry. Each entry maps to a numbered check in
 * pinocchio-security-analyzer/skills/pinocchio-security-patterns/references/vulnerability-catalog.md.
 *
 * Account validation
 *   program-id-verification     → Check 1  (HIGH)
 *   missing-owner               → Check 2  (CRITICAL)
 *   signer-necessity            → Check 3  (MEDIUM)
 *   missing-signer              → Check 4  (CRITICAL)
 *   writable-mutation           → Check 5  (LOW)
 *   readonly-enforcement        → Check 6  (MEDIUM)
 *   sysvar-spoofing             → Check 7  (HIGH)
 *
 * PDA security
 *   pda-validation              → Check 8  (CRITICAL)
 *   pda-seed-collision          → Check 9  (HIGH)
 *   bump-canonicalization       → Check 10 (HIGH)
 *
 * Data integrity
 *   discriminator-check         → Check 11 (CRITICAL)
 *   data-size-validation        → Check 12 (HIGH)
 *   type-cosplay                → Check 13 (CRITICAL)
 *   unchecked-deserialization   → Check 14 (HIGH)
 *
 * Account lifecycle
 *   reinitialization            → Check 15 (CRITICAL)
 *   existing-lamports           → Check 16 (MEDIUM)
 *   rent-exempt                 → Check 17 (MEDIUM)
 *   account-closure             → Check 23 (CRITICAL)
 *
 * CPI security
 *   arbitrary-cpi               → Check 18 (CRITICAL)
 *   authority-escalation        → Check 19 (HIGH)
 *
 * Code quality
 *   unchecked-arithmetic        → Check 20 (MEDIUM)
 *   event-via-cpi               → Check 21 (LOW)
 *   token-2022-extensions       → Check 22 (HIGH)
 *   instruction-data-bounds     → Check 24 (HIGH)
 *   unsafe-unwrap               → Check 25 (MEDIUM)
 *   account-relationship        → Check 26 (MEDIUM)
 *   account-borrow              → Check 27 (LOW)
 *
 * Anchor (tier 1, attribute-only)
 *   anchor-seeds-without-bump    (HIGH)
 *   anchor-init-without-space    (HIGH)
 *   anchor-init-without-payer    (CRITICAL)
 *   anchor-realloc-incomplete    (MEDIUM)
 *   anchor-unchecked-account     (LOW)
 */
export const allVisitors: readonly Visitor[] = [
  missingSigner,
  missingOwner,
  discriminatorCheck,
  programIdVerification,
  sysvarSpoofing,
  arbitraryCpi,
  pdaValidation,
  uncheckedArithmetic,
  readonlyEnforcement,
  signerNecessity,
  unsafeUnwrap,
  eventViaCpi,
  uncheckedDeserialization,
  dataSizeValidation,
  typeCosplay,
  accountClosure,
  reinitialization,
  existingLamports,
  rentExempt,
  authorityEscalation,
  token2022Extensions,
  instructionDataBounds,
  pdaSeedCollision,
  bumpCanonicalization,
  writableMutation,
  accountRelationship,
  accountBorrow,
  anchorSeedsWithoutBump,
  anchorInitWithoutSpace,
  anchorInitWithoutPayer,
  anchorReallocIncomplete,
  anchorUncheckedAccount,
];
