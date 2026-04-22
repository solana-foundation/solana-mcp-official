import type { CompiledInstruction, TransactionPayloadContext, TransactionPayloadOutput } from "../types";

// Solana message layout: [writable signers | readonly signers | writable non-signers | readonly non-signers]
function buildAccounts(context: TransactionPayloadContext) {
  const { accountKeys, numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts } = context;

  const readonlySignerStart = numRequiredSignatures - numReadonlySignedAccounts;
  const readonlyUnsignedStart = accountKeys.length - numReadonlyUnsignedAccounts;

  return accountKeys.map((address, i) => {
    const signer = i < numRequiredSignatures;
    const readonlySigned = signer && i >= readonlySignerStart;
    const readonlyUnsigned = !signer && i >= readonlyUnsignedStart;
    const writable = !readonlySigned && !readonlyUnsigned;
    return { address, signer, writable };
  });
}

function resolveAccountKey(index: number, accountKeys: string[]): string {
  const key = accountKeys[index];
  if (key === undefined) {
    throw new Error(`account index ${index} out of bounds for ${accountKeys.length} keys`);
  }
  return key;
}

function resolveInstruction(ix: CompiledInstruction, accountKeys: string[]) {
  return {
    program_id: resolveAccountKey(ix.programIdIndex, accountKeys),
    accounts: ix.accounts.map(i => resolveAccountKey(i, accountKeys)),
    data: ix.data,
  };
}

function buildInstructions(context: TransactionPayloadContext) {
  const { accountKeys, instructions, innerInstructions } = context;

  const innerMap = new Map<number, readonly CompiledInstruction[]>();
  for (const group of innerInstructions ?? []) {
    const existing = innerMap.get(group.index);
    innerMap.set(group.index, existing ? [...existing, ...group.instructions] : group.instructions);
  }

  return instructions.map((ix, i) => ({
    ...resolveInstruction(ix, accountKeys),
    inner_instructions: (innerMap.get(i) ?? []).map(inner => resolveInstruction(inner, accountKeys)),
  }));
}

export function buildTransactionPayload(context: TransactionPayloadContext): TransactionPayloadOutput {
  const safeSignerCount = Math.max(0, context.numRequiredSignatures);
  const signers = context.accountKeys.slice(0, safeSignerCount);

  const base = {
    kind: "transaction" as const,
    signature: context.signature,
    slot: context.slot,
    block_time: context.blockTime,
    fee_lamports: context.feeLamports,
    signers,
    transaction_version: context.version,
    recent_blockhash: context.recentBlockhash,
    compute_units_consumed: context.computeUnitsConsumed,
    confirmation_status: context.confirmationStatus,
    confirmations: context.confirmations,
    log_messages: context.logMessages,
    accounts: buildAccounts(context),
    instructions: buildInstructions(context),
  };

  switch (context.status) {
    case "failed":
      return {
        entity: { ...base, status: context.status, error: context.err },
      };
    case "success":
    case "unknown":
      return { entity: { ...base, status: context.status, error: null } };
    default: {
      const _exhaustive: never = context;
      throw new Error(`Unhandled transaction status: ${String((_exhaustive as TransactionPayloadContext).status)}`);
    }
  }
}
