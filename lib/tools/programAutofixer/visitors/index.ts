import type { Visitor } from "../types.js";
import { missingSigner } from "./missing-signer.js";
import { missingOwner } from "./missing-owner.js";
import { discriminatorCheck } from "./discriminator-check.js";
import { programIdVerification } from "./program-id-verification.js";
import { uncheckedArithmetic } from "./unchecked-arithmetic.js";
import { sysvarSpoofing } from "./sysvar-spoofing.js";
import { arbitraryCpi } from "./arbitrary-cpi.js";
import { pdaValidation } from "./pda-validation.js";
import { unsafeUnwrap } from "./unsafe-unwrap.js";
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
import { accountRelationship } from "./account-relationship.js";
import { accountBorrow } from "./account-borrow.js";
import { anchorSeedsWithoutBump } from "./anchor-seeds-without-bump.js";
import { anchorInitWithoutSpace } from "./anchor-init-without-space.js";
import { anchorInitWithoutPayer } from "./anchor-init-without-payer.js";
import { anchorReallocIncomplete } from "./anchor-realloc-incomplete.js";
import { anchorUncheckedAccount } from "./anchor-unchecked-account.js";
import { anchorManualSignerCheck } from "./anchor-manual-signer-check.js";
import { anchorMissingMut } from "./anchor-missing-mut.js";
import { anchorCpiContextUnverified } from "./anchor-cpi-context-unverified.js";
import { anchorCloseWithoutReceiver } from "./anchor-close-without-receiver.js";

/**
 * Visitor registry. Numbered checks map to
 * pinocchio-security-analyzer/skills/pinocchio-security-patterns/references/vulnerability-catalog.md.
 *
 * Removed for chronic false positives (see git history): readonly-enforcement (Check 6),
 * signer-necessity (Check 3), writable-mutation (Check 5), bump-canonicalization (Check 10),
 * event-via-cpi (Check 21), anchor-emit-via-msg, anchor-manual-key-eq, anchor-account-not-interface.
 *
 * Account validation
 *   program-id-verification     → Check 1  (LOW)
 *   missing-owner               → Check 2  (HIGH)
 *   missing-signer              → Check 4  (CRITICAL)
 *   sysvar-spoofing             → Check 7  (MEDIUM)
 *
 * PDA security
 *   pda-validation              → Check 8  (CRITICAL)
 *   pda-seed-collision          → Check 9  (MEDIUM)
 *
 * Data integrity
 *   discriminator-check         → Check 11 (HIGH)
 *   data-size-validation        → Check 12 (HIGH)
 *   type-cosplay                → Check 13 (CRITICAL)
 *   unchecked-deserialization   → Check 14 (MEDIUM)
 *
 * Account lifecycle
 *   reinitialization            → Check 15 (MEDIUM)
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
 *   token-2022-extensions       → Check 22 (MEDIUM)
 *   instruction-data-bounds     → Check 24 (HIGH)
 *   unsafe-unwrap               → Check 25 (LOW)
 *   account-relationship        → Check 26 (LOW)
 *   account-borrow              → Check 27 (LOW)
 *
 * Anchor account constraints
 *   anchor-seeds-without-bump    (HIGH)
 *   anchor-init-without-space    (HIGH)
 *   anchor-init-without-payer    (CRITICAL)
 *   anchor-realloc-incomplete    (MEDIUM)
 *   anchor-unchecked-account     (LOW)
 *
 * Anchor account types and handler checks
 *   anchor-manual-signer-check   (LOW)      — .is_signer on a ctx.accounts field inside #[program] mod
 *   anchor-missing-mut             (HIGH)     — ctx.accounts.X mutated, struct field lacks `mut`
 *   anchor-cpi-context-unverified  (HIGH)     — CpiContext::new(<untyped account>, ...) without typed Program/Interface
 *   anchor-close-without-receiver  (CRITICAL) — manual lamport drain without `close = ...` constraint
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
  unsafeUnwrap,
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
  accountRelationship,
  accountBorrow,
  anchorSeedsWithoutBump,
  anchorInitWithoutSpace,
  anchorInitWithoutPayer,
  anchorReallocIncomplete,
  anchorUncheckedAccount,
  anchorManualSignerCheck,
  anchorMissingMut,
  anchorCpiContextUnverified,
  anchorCloseWithoutReceiver,
];
