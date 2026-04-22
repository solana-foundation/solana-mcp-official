import type {
  CompiledInnerInstruction,
  CompiledInstruction,
  ConfirmationStatus,
  SignatureStatusEnvelope,
  TransactionPayloadContext,
  TransactionProbeEnvelope,
} from "../types";
import { asSafeNumeric } from "../parse-helpers";
import { logger } from "../../observability/logger";

function toAccountKeyString(accountKey: string | { pubkey: string }): string {
  if (typeof accountKey === "string") {
    return accountKey;
  }
  return accountKey.pubkey;
}

function validateInstructionIndices(
  instructions: readonly CompiledInstruction[],
  accountKeyCount: number,
  label: string,
): void {
  for (const ix of instructions) {
    if (
      ix.programIdIndex < 0 ||
      ix.programIdIndex >= accountKeyCount ||
      ix.accounts.some(idx => idx < 0 || idx >= accountKeyCount)
    ) {
      throw new Error(
        `Unexpected transaction probe: ${label} index out of bounds (programIdIndex=${ix.programIdIndex}, accounts=[${ix.accounts.join(",")}], accountKeyCount=${accountKeyCount}).`,
      );
    }
  }
}

function validateMessageIntegrity(
  header: {
    numRequiredSignatures: number;
    numReadonlySignedAccounts: number;
    numReadonlyUnsignedAccounts: number;
  },
  accountKeyCount: number,
  instructions: readonly CompiledInstruction[],
  innerInstructions: readonly CompiledInnerInstruction[] | null,
): void {
  const { numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts } = header;

  if (numRequiredSignatures <= 0 || numRequiredSignatures > accountKeyCount) {
    throw new Error(
      `Unexpected transaction probe: numRequiredSignatures (${numRequiredSignatures}) out of range for ${accountKeyCount} account keys.`,
    );
  }

  if (numReadonlySignedAccounts < 0 || numReadonlyUnsignedAccounts < 0) {
    throw new Error(
      `Unexpected transaction probe: negative readonly account count (signed=${numReadonlySignedAccounts}, unsigned=${numReadonlyUnsignedAccounts}).`,
    );
  }

  if (
    numReadonlySignedAccounts >= numRequiredSignatures ||
    numReadonlyUnsignedAccounts > accountKeyCount - numRequiredSignatures
  ) {
    throw new Error(
      `Unexpected transaction probe: readonly counts (signed=${numReadonlySignedAccounts}, unsigned=${numReadonlyUnsignedAccounts}) exceed available accounts (signers=${numRequiredSignatures}, total=${accountKeyCount}).`,
    );
  }

  validateInstructionIndices(instructions, accountKeyCount, "instruction");

  if (innerInstructions) {
    for (const group of innerInstructions) {
      if (group.index < 0 || group.index >= instructions.length) {
        throw new Error(
          `Unexpected transaction probe: inner instruction group index (${group.index}) out of bounds for ${instructions.length} instructions.`,
        );
      }
      validateInstructionIndices(group.instructions, accountKeyCount, "inner instruction");
    }
  }
}

function isKnownConfirmationStatus(value: string | null): value is ConfirmationStatus {
  return value === "processed" || value === "confirmed" || value === "finalized";
}

function normalizeConfirmation(
  signatureStatus: SignatureStatusEnvelope | null | undefined,
  signature: string,
): {
  confirmationStatus: ConfirmationStatus | null;
  confirmations: number | "max" | null;
} {
  const statusValue = signatureStatus?.value ?? null;
  const rawStatus = statusValue?.confirmationStatus ?? null;
  if (rawStatus !== null && !isKnownConfirmationStatus(rawStatus)) {
    logger.warn({
      event: "normalizer.unknown_confirmation_status",
      value: rawStatus,
      signature,
    });
  }
  const confirmationStatus = isKnownConfirmationStatus(rawStatus) ? rawStatus : null;
  const rawConfirmations = statusValue?.confirmations ?? null;
  if (confirmationStatus === "finalized") {
    return { confirmationStatus, confirmations: "max" };
  }
  if (typeof rawConfirmations === "bigint") {
    // Confirmation count is bounded by MAX_LOCKOUT_HISTORY (32), safe to convert directly.
    return { confirmationStatus, confirmations: Number(rawConfirmations) };
  }
  if (typeof rawConfirmations === "number") {
    return { confirmationStatus, confirmations: rawConfirmations };
  }
  return { confirmationStatus, confirmations: null };
}

function normalizeTransactionError(
  rawErr: unknown,
  signature: string,
): Record<string, unknown> | string | unknown[] | null {
  if (rawErr === null || rawErr === undefined) {
    return null;
  }
  if (typeof rawErr === "string") {
    return rawErr;
  }
  if (Array.isArray(rawErr)) {
    return rawErr as unknown[];
  }
  if (typeof rawErr === "object") {
    return rawErr as Record<string, unknown>;
  }
  logger.warn({
    event: "normalizer.unrecognized_err_shape",
    value: String(rawErr),
    signature,
  });
  return String(rawErr);
}

export function normalizeTransactionProbe(
  signature: string,
  envelope: TransactionProbeEnvelope,
  signatureStatus?: SignatureStatusEnvelope | null,
): TransactionPayloadContext | null {
  if (envelope === null) {
    return null;
  }

  const slot = asSafeNumeric(envelope.slot);
  if (typeof slot !== "number") {
    throw new Error("Unexpected transaction probe: slot is not a safe number.");
  }

  const { header, accountKeys } = envelope.transaction.message;
  const instructions = Array.from(envelope.transaction.message.instructions ?? []);
  const meta = envelope.meta;
  const innerInstructions = meta?.innerInstructions ? Array.from(meta.innerInstructions) : null;

  validateMessageIntegrity(header, accountKeys.length, instructions, innerInstructions);

  const { numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts } = header;

  const status = meta === null ? "unknown" : meta.err === null || meta.err === undefined ? "success" : "failed";

  const version = envelope.version ?? null;
  const computeUnitsConsumed = meta ? asSafeNumeric(meta.computeUnitsConsumed ?? null) : null;
  const logMessages = meta?.logMessages ? Array.from(meta.logMessages) : null;
  const recentBlockhash = envelope.transaction.message.recentBlockhash ?? null;

  const { confirmationStatus, confirmations } = normalizeConfirmation(signatureStatus, signature);

  const base = {
    signature,
    slot,
    blockTime: asSafeNumeric(envelope.blockTime),
    feeLamports: meta ? asSafeNumeric(meta.fee) : null,
    accountKeys: accountKeys.map(toAccountKeyString),
    numRequiredSignatures,
    version,
    computeUnitsConsumed,
    logMessages,
    recentBlockhash,
    numReadonlySignedAccounts,
    numReadonlyUnsignedAccounts,
    confirmationStatus,
    confirmations,
    instructions,
    innerInstructions,
  };

  switch (status) {
    case "failed": {
      const err = normalizeTransactionError(meta?.err ?? null, signature);
      return { ...base, status, err };
    }
    case "success":
    case "unknown":
      return { ...base, status, err: null };
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled transaction status: ${String(_exhaustive)}`);
    }
  }
}
