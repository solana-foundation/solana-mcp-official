import { describe, expect, it } from "vitest";

import type { TransactionPayloadContext } from "../../../../lib/solana/types";
import { buildTransactionPayload } from "../../../../lib/solana/transaction/build-payload";

function makeFullContext(overrides: Partial<TransactionPayloadContext> = {}): TransactionPayloadContext {
  return {
    signature: "sig",
    slot: 123,
    blockTime: 456,
    status: "success",
    feeLamports: 5000,
    accountKeys: ["fee-payer", "readonly-signer", "writable-nonsigner", "program"],
    numRequiredSignatures: 2,
    version: 0,
    computeUnitsConsumed: 12345,
    err: null,
    logMessages: ["Program log"],
    recentBlockhash: "GHtXQBbU",
    numReadonlySignedAccounts: 1,
    numReadonlyUnsignedAccounts: 1,
    confirmationStatus: "finalized",
    confirmations: "max",
    instructions: [{ programIdIndex: 3, accounts: [0, 2], data: "abc" }],
    innerInstructions: [
      {
        index: 0,
        instructions: [{ programIdIndex: 3, accounts: [0], data: "def" }],
      },
    ],
    ...overrides,
  } as TransactionPayloadContext;
}

describe("transaction payload builder", () => {
  it("builds payload with signer slicing", () => {
    const result = buildTransactionPayload(makeFullContext());

    expect(result.entity).toMatchObject({
      kind: "transaction",
      signature: "sig",
      slot: 123,
      block_time: 456,
      status: "success",
      fee_lamports: 5000,
      signers: ["fee-payer", "readonly-signer"],
    });
  });

  it("handles negative signer counts safely", () => {
    const result = buildTransactionPayload(
      makeFullContext({
        numRequiredSignatures: -1,
        accountKeys: ["a"],
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 0,
        instructions: [],
        innerInstructions: null,
      }),
    );

    expect(result.entity).toMatchObject({ signers: [] });
  });

  it("derives account roles from header", () => {
    const result = buildTransactionPayload(makeFullContext());

    expect(result.entity.accounts).toEqual([
      { address: "fee-payer", signer: true, writable: true },
      { address: "readonly-signer", signer: true, writable: false },
      { address: "writable-nonsigner", signer: false, writable: true },
      { address: "program", signer: false, writable: false },
    ]);
  });

  it("resolves instruction program_id and accounts to addresses", () => {
    const result = buildTransactionPayload(makeFullContext());

    expect(result.entity.instructions[0]!).toMatchObject({
      program_id: "program",
      accounts: ["fee-payer", "writable-nonsigner"],
      data: "abc",
    });
  });

  it("nests inner instructions under parent", () => {
    const result = buildTransactionPayload(makeFullContext());
    const inner = result.entity.instructions[0]!.inner_instructions;

    expect(inner).toEqual([
      {
        program_id: "program",
        accounts: ["fee-payer"],
        data: "def",
      },
    ]);
  });

  it("returns empty inner_instructions when none match", () => {
    const result = buildTransactionPayload(makeFullContext({ innerInstructions: null }));
    const inner = result.entity.instructions[0]!.inner_instructions;

    expect(inner).toEqual([]);
  });

  it("includes error only when status is failed", () => {
    const errDetail = { InstructionError: [0, "Custom"] };

    const failed = buildTransactionPayload(makeFullContext({ status: "failed", err: errDetail }));
    expect(failed.entity.error).toEqual(errDetail);

    const success = buildTransactionPayload(makeFullContext());
    expect(success.entity.error).toBeNull();
  });

  it("derives roles for single-signer with one readonly unsigned", () => {
    const result = buildTransactionPayload(
      makeFullContext({
        accountKeys: ["payer", "system-program"],
        numRequiredSignatures: 1,
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 1,
        instructions: [],
        innerInstructions: null,
      }),
    );

    expect(result.entity.accounts).toEqual([
      { address: "payer", signer: true, writable: true },
      { address: "system-program", signer: false, writable: false },
    ]);
  });

  it("includes new scalar fields", () => {
    const result = buildTransactionPayload(makeFullContext());

    expect(result.entity).toMatchObject({
      transaction_version: 0,
      recent_blockhash: "GHtXQBbU",
      compute_units_consumed: 12345,
      confirmation_status: "finalized",
      confirmations: "max",
      log_messages: ["Program log"],
    });
  });

  it("marks all accounts writable when both readonly counts are zero", () => {
    const result = buildTransactionPayload(
      makeFullContext({
        accountKeys: ["signer-a", "signer-b", "other"],
        numRequiredSignatures: 2,
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 0,
        instructions: [],
        innerInstructions: null,
      }),
    );

    expect(result.entity.accounts).toEqual([
      { address: "signer-a", signer: true, writable: true },
      { address: "signer-b", signer: true, writable: true },
      { address: "other", signer: false, writable: true },
    ]);
  });

  it("derives roles with multiple readonly signers", () => {
    const result = buildTransactionPayload(
      makeFullContext({
        accountKeys: ["fee-payer", "cosigner-ro-1", "cosigner-ro-2", "other"],
        numRequiredSignatures: 3,
        numReadonlySignedAccounts: 2,
        numReadonlyUnsignedAccounts: 0,
        instructions: [],
        innerInstructions: null,
      }),
    );

    expect(result.entity.accounts).toEqual([
      { address: "fee-payer", signer: true, writable: true },
      { address: "cosigner-ro-1", signer: true, writable: false },
      { address: "cosigner-ro-2", signer: true, writable: false },
      { address: "other", signer: false, writable: true },
    ]);
  });

  it("maps non-contiguous inner instruction groups to correct parents", () => {
    const result = buildTransactionPayload(
      makeFullContext({
        accountKeys: ["signer", "prog-a", "prog-b", "prog-c"],
        numRequiredSignatures: 1,
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 3,
        instructions: [
          { programIdIndex: 1, accounts: [0], data: "ix0" },
          { programIdIndex: 2, accounts: [0], data: "ix1" },
          { programIdIndex: 3, accounts: [0], data: "ix2" },
        ],
        innerInstructions: [
          {
            index: 0,
            instructions: [{ programIdIndex: 2, accounts: [0], data: "cpi0" }],
          },
          {
            index: 2,
            instructions: [{ programIdIndex: 1, accounts: [0], data: "cpi2" }],
          },
        ],
      }),
    );

    const { instructions } = result.entity;
    expect(instructions[0]!.inner_instructions).toEqual([{ program_id: "prog-b", accounts: ["signer"], data: "cpi0" }]);
    expect(instructions[1]!.inner_instructions).toEqual([]);
    expect(instructions[2]!.inner_instructions).toEqual([{ program_id: "prog-a", accounts: ["signer"], data: "cpi2" }]);
  });

  it("concatenates inner instructions when multiple groups share the same parent index", () => {
    const result = buildTransactionPayload(
      makeFullContext({
        accountKeys: ["signer", "prog-a", "prog-b"],
        numRequiredSignatures: 1,
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 2,
        instructions: [{ programIdIndex: 1, accounts: [0], data: "ix0" }],
        innerInstructions: [
          {
            index: 0,
            instructions: [{ programIdIndex: 2, accounts: [0], data: "cpi-a" }],
          },
          {
            index: 0,
            instructions: [{ programIdIndex: 1, accounts: [0], data: "cpi-b" }],
          },
        ],
      }),
    );

    expect(result.entity.instructions[0]!.inner_instructions).toEqual([
      { program_id: "prog-b", accounts: ["signer"], data: "cpi-a" },
      { program_id: "prog-a", accounts: ["signer"], data: "cpi-b" },
    ]);
  });

  it("returns null error for unknown status", () => {
    const result = buildTransactionPayload(
      makeFullContext({
        status: "unknown",
        err: null,
      }),
    );

    expect(result.entity.status).toBe("unknown");
    expect(result.entity.error).toBeNull();
  });

  it("passes string SafeNumeric values through unchanged", () => {
    const result = buildTransactionPayload(
      makeFullContext({
        feeLamports: "9007199254740992",
        computeUnitsConsumed: "9007199254740993",
        blockTime: "9007199254740994",
      }),
    );

    expect(result.entity.fee_lamports).toBe("9007199254740992");
    expect(result.entity.compute_units_consumed).toBe("9007199254740993");
    expect(result.entity.block_time).toBe("9007199254740994");
  });
});
