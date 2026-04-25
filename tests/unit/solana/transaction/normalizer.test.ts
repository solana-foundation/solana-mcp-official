import { describe, expect, it } from "vitest";

import { normalizeTransactionProbe } from "../../../../lib/solana/transaction/normalizer";

function makeFullEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slot: 123,
    blockTime: 456,
    version: 0 as const,
    meta: {
      err: null,
      fee: 5000,
      computeUnitsConsumed: 12345,
      logMessages: ["Program 111 invoke [1]", "Program 111 success"],
      innerInstructions: [
        {
          index: 0,
          instructions: [{ programIdIndex: 2, accounts: [0], data: "abc" }],
        },
      ],
    },
    transaction: {
      message: {
        header: {
          numRequiredSignatures: 2,
          numReadonlySignedAccounts: 1,
          numReadonlyUnsignedAccounts: 1,
        },
        accountKeys: ["signer-1", { pubkey: "signer-2" }, "program-1", "readonly-1"],
        recentBlockhash: "GHtXQBbU2vKfGsFqgEz",
        instructions: [{ programIdIndex: 2, accounts: [0, 1], data: "3Bxs" }],
      },
    },
    ...overrides,
  };
}

function makeStatusEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    value: {
      confirmationStatus: "finalized" as const,
      confirmations: null,
      ...overrides,
    },
  };
}

describe("transaction normalizer", () => {
  it("normalizes mixed account key shapes and successful status", () => {
    const normalized = normalizeTransactionProbe("sig", makeFullEnvelope() as never);

    expect(normalized).toMatchObject({
      signature: "sig",
      slot: 123,
      blockTime: 456,
      status: "success",
      feeLamports: 5000,
      accountKeys: ["signer-1", "signer-2", "program-1", "readonly-1"],
      numRequiredSignatures: 2,
    });
  });

  it("maps null metadata to unknown status and null fee", () => {
    const normalized = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope({
        slot: 999,
        blockTime: null,
        meta: null,
      }) as never,
    );

    expect(normalized).toMatchObject({
      status: "unknown",
      feeLamports: null,
      computeUnitsConsumed: null,
      err: null,
      logMessages: null,
      innerInstructions: null,
    });
  });

  it("returns null for null envelope", () => {
    expect(normalizeTransactionProbe("sig", null)).toBeNull();
  });

  it("throws on negative required signature count", () => {
    expect(() =>
      normalizeTransactionProbe(
        "sig",
        makeFullEnvelope({
          meta: null,
          transaction: {
            message: {
              header: {
                numRequiredSignatures: -1,
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: 0,
              },
              accountKeys: ["signer-1"],
              instructions: [],
            },
          },
        }) as never,
      ),
    ).toThrow("numRequiredSignatures (-1) out of range for 1 account keys");
  });

  it("handles bigint slot and fee values", () => {
    const normalized = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope({
        slot: BigInt(42),
        blockTime: BigInt(1000),
        meta: {
          err: null,
          fee: BigInt(5000),
          computeUnitsConsumed: BigInt(99),
        },
      }) as never,
    );

    expect(normalized).toMatchObject({
      slot: 42,
      blockTime: 1000,
      feeLamports: 5000,
      computeUnitsConsumed: 99,
    });
  });

  it("extracts version field", () => {
    expect(normalizeTransactionProbe("sig", makeFullEnvelope({ version: 0 }) as never)).toMatchObject({ version: 0 });

    expect(normalizeTransactionProbe("sig", makeFullEnvelope({ version: "legacy" }) as never)).toMatchObject({
      version: "legacy",
    });

    expect(normalizeTransactionProbe("sig", makeFullEnvelope({ version: undefined }) as never)).toMatchObject({
      version: null,
    });
  });

  it("normalizes computeUnitsConsumed from bigint", () => {
    const normalized = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope({
        meta: { err: null, fee: 5000, computeUnitsConsumed: BigInt(12345) },
      }) as never,
    );

    expect(normalized).toMatchObject({ computeUnitsConsumed: 12345 });
  });

  it("passes through err for failed transactions", () => {
    const errDetail = { InstructionError: [0, "Custom"] };
    const normalized = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope({
        meta: { err: errDetail, fee: 5000 },
      }) as never,
    );

    expect(normalized).toMatchObject({
      status: "failed",
      err: errDetail,
    });
  });

  it("passes through string err for simple error variants", () => {
    const normalized = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope({
        meta: { err: "AccountInUse", fee: 5000 },
      }) as never,
    );

    expect(normalized).toMatchObject({
      status: "failed",
      err: "AccountInUse",
    });
  });

  it("passes through string err for other simple variants", () => {
    for (const variant of ["BlockhashNotFound", "InsufficientFundsForRent", "AccountLoadedTwice"]) {
      const normalized = normalizeTransactionProbe(
        "sig",
        makeFullEnvelope({
          meta: { err: variant, fee: 5000 },
        }) as never,
      );

      expect(normalized).toMatchObject({
        status: "failed",
        err: variant,
      });
    }
  });

  it("passes through array-shaped err for failed transactions", () => {
    const arrErr = ["InstructionError", [0, "Custom"]];
    const normalized = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope({
        meta: { err: arrErr, fee: 5000 },
      }) as never,
    );

    expect(normalized).toMatchObject({
      status: "failed",
      err: arrErr,
    });
  });

  it("passes through logMessages array", () => {
    const logs = ["Program 111 invoke [1]", "Program 111 success"];
    const normalized = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope({
        meta: { err: null, fee: 5000, logMessages: logs },
      }) as never,
    );

    expect(normalized!.logMessages).toEqual(logs);

    const withoutLogs = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope({
        meta: { err: null, fee: 5000 },
      }) as never,
    );

    expect(withoutLogs!.logMessages).toBeNull();
  });

  it("extracts recentBlockhash", () => {
    const normalized = normalizeTransactionProbe("sig", makeFullEnvelope() as never);

    expect(normalized!.recentBlockhash).toBe("GHtXQBbU2vKfGsFqgEz");

    const withoutHash = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope({
        transaction: {
          message: {
            header: {
              numRequiredSignatures: 2,
              numReadonlySignedAccounts: 1,
              numReadonlyUnsignedAccounts: 1,
            },
            accountKeys: ["signer-1", "signer-2", "program-1", "readonly-1"],
            instructions: [{ programIdIndex: 2, accounts: [0, 1], data: "3Bxs" }],
          },
        },
      }) as never,
    );

    expect(withoutHash!.recentBlockhash).toBeNull();
  });

  it("throws when slot exceeds safe integer range", () => {
    expect(() =>
      normalizeTransactionProbe(
        "sig",
        makeFullEnvelope({
          slot: BigInt("9007199254740992"),
        }) as never,
      ),
    ).toThrow("Unexpected transaction probe: slot is not a safe number.");
  });

  it("preserves unsafe bigint values as strings", () => {
    const unsafeBigint = BigInt("9007199254740992");
    const normalized = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope({
        meta: {
          err: null,
          fee: unsafeBigint,
          computeUnitsConsumed: unsafeBigint,
        },
      }) as never,
    );

    expect(normalized!.feeLamports).toBe("9007199254740992");
    expect(normalized!.computeUnitsConsumed).toBe("9007199254740992");
  });

  it("throws when all signers would be readonly", () => {
    expect(() =>
      normalizeTransactionProbe(
        "sig",
        makeFullEnvelope({
          transaction: {
            message: {
              header: {
                numRequiredSignatures: 2,
                numReadonlySignedAccounts: 2,
                numReadonlyUnsignedAccounts: 0,
              },
              accountKeys: ["a", "b", "c"],
              instructions: [],
            },
          },
        }) as never,
      ),
    ).toThrow("readonly counts (signed=2, unsigned=0) exceed available accounts");
  });

  it("throws when signer count exceeds account keys length", () => {
    expect(() =>
      normalizeTransactionProbe(
        "sig",
        makeFullEnvelope({
          transaction: {
            message: {
              header: {
                numRequiredSignatures: 5,
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: 0,
              },
              accountKeys: ["a", "b"],
              instructions: [],
            },
          },
        }) as never,
      ),
    ).toThrow("numRequiredSignatures (5) out of range for 2 account keys");
  });

  it("throws when readonly unsigned count exceeds non-signer accounts", () => {
    expect(() =>
      normalizeTransactionProbe(
        "sig",
        makeFullEnvelope({
          transaction: {
            message: {
              header: {
                numRequiredSignatures: 1,
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: 5,
              },
              accountKeys: ["a", "b", "c"],
              instructions: [],
            },
          },
        }) as never,
      ),
    ).toThrow("readonly counts (signed=0, unsigned=5) exceed available accounts");
  });

  it("validates readonly header counts", () => {
    expect(() =>
      normalizeTransactionProbe(
        "sig",
        makeFullEnvelope({
          transaction: {
            message: {
              header: {
                numRequiredSignatures: 1,
                numReadonlySignedAccounts: -1,
                numReadonlyUnsignedAccounts: 0,
              },
              accountKeys: ["signer-1"],
              instructions: [],
            },
          },
        }) as never,
      ),
    ).toThrow("Unexpected transaction probe:");

    expect(() =>
      normalizeTransactionProbe(
        "sig",
        makeFullEnvelope({
          transaction: {
            message: {
              header: {
                numRequiredSignatures: 1,
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: -1,
              },
              accountKeys: ["signer-1"],
              instructions: [],
            },
          },
        }) as never,
      ),
    ).toThrow("Unexpected transaction probe:");
  });

  it("passes through instructions and innerInstructions", () => {
    const normalized = normalizeTransactionProbe("sig", makeFullEnvelope() as never);

    expect(normalized!.instructions).toEqual([{ programIdIndex: 2, accounts: [0, 1], data: "3Bxs" }]);
    expect(normalized!.innerInstructions).toEqual([
      {
        index: 0,
        instructions: [{ programIdIndex: 2, accounts: [0], data: "abc" }],
      },
    ]);
  });

  it("maps finalized status to max confirmations", () => {
    const normalized = normalizeTransactionProbe("sig", makeFullEnvelope() as never, makeStatusEnvelope());

    expect(normalized).toMatchObject({
      confirmationStatus: "finalized",
      confirmations: "max",
    });
  });

  it("passes through numeric confirmations for non-finalized", () => {
    const normalized = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope() as never,
      makeStatusEnvelope({
        confirmationStatus: "confirmed",
        confirmations: 42,
      }),
    );

    expect(normalized).toMatchObject({
      confirmationStatus: "confirmed",
      confirmations: 42,
    });
  });

  it("defaults confirmation fields to null when status envelope is null", () => {
    const normalized = normalizeTransactionProbe("sig", makeFullEnvelope() as never, null);

    expect(normalized).toMatchObject({
      confirmationStatus: null,
      confirmations: null,
    });
  });

  it("defaults confirmation fields to null when status envelope is omitted", () => {
    const normalized = normalizeTransactionProbe("sig", makeFullEnvelope() as never);

    expect(normalized).toMatchObject({
      confirmationStatus: null,
      confirmations: null,
    });
  });

  it("passes through numeric confirmations for processed status", () => {
    const normalized = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope() as never,
      makeStatusEnvelope({
        confirmationStatus: "processed",
        confirmations: 3,
      }),
    );

    expect(normalized).toMatchObject({
      confirmationStatus: "processed",
      confirmations: 3,
    });
  });

  it("converts bigint confirmations for confirmed status", () => {
    const normalized = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope() as never,
      makeStatusEnvelope({
        confirmationStatus: "confirmed",
        confirmations: BigInt(10),
      }),
    );

    expect(normalized).toMatchObject({
      confirmationStatus: "confirmed",
      confirmations: 10,
    });
  });

  it("converts bigint confirmations directly to number", () => {
    const normalized = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope() as never,
      makeStatusEnvelope({
        confirmationStatus: "confirmed",
        confirmations: BigInt(25),
      }),
    );

    expect(normalized).toMatchObject({
      confirmationStatus: "confirmed",
      confirmations: 25,
    });
  });

  it("throws on out-of-bounds programIdIndex in instructions", () => {
    expect(() =>
      normalizeTransactionProbe(
        "sig",
        makeFullEnvelope({
          meta: { err: null, fee: 5000 },
          transaction: {
            message: {
              header: {
                numRequiredSignatures: 1,
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: 0,
              },
              accountKeys: ["signer-1"],
              recentBlockhash: "GHtX",
              instructions: [{ programIdIndex: 5, accounts: [0], data: "abc" }],
            },
          },
        }) as never,
      ),
    ).toThrow("Unexpected transaction probe:");
  });

  it("throws on out-of-bounds account index in instructions", () => {
    expect(() =>
      normalizeTransactionProbe(
        "sig",
        makeFullEnvelope({
          meta: { err: null, fee: 5000 },
          transaction: {
            message: {
              header: {
                numRequiredSignatures: 1,
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: 0,
              },
              accountKeys: ["signer-1"],
              recentBlockhash: "GHtX",
              instructions: [{ programIdIndex: 0, accounts: [0, 99], data: "abc" }],
            },
          },
        }) as never,
      ),
    ).toThrow("Unexpected transaction probe:");
  });

  it("throws on out-of-bounds index in inner instructions", () => {
    expect(() =>
      normalizeTransactionProbe(
        "sig",
        makeFullEnvelope({
          meta: {
            err: null,
            fee: 5000,
            innerInstructions: [
              {
                index: 0,
                instructions: [{ programIdIndex: 99, accounts: [0], data: "abc" }],
              },
            ],
          },
          transaction: {
            message: {
              header: {
                numRequiredSignatures: 1,
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: 0,
              },
              accountKeys: ["signer-1"],
              recentBlockhash: "GHtX",
              instructions: [{ programIdIndex: 0, accounts: [0], data: "abc" }],
            },
          },
        }) as never,
      ),
    ).toThrow("Unexpected transaction probe:");
  });

  it("throws on negative programIdIndex in instructions", () => {
    expect(() =>
      normalizeTransactionProbe(
        "sig",
        makeFullEnvelope({
          meta: { err: null, fee: 5000 },
          transaction: {
            message: {
              header: {
                numRequiredSignatures: 1,
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: 0,
              },
              accountKeys: ["signer-1"],
              recentBlockhash: "GHtX",
              instructions: [{ programIdIndex: -1, accounts: [0], data: "abc" }],
            },
          },
        }) as never,
      ),
    ).toThrow("instruction index out of bounds (programIdIndex=-1");
  });

  it("throws on negative account index in inner instructions", () => {
    expect(() =>
      normalizeTransactionProbe(
        "sig",
        makeFullEnvelope({
          meta: {
            err: null,
            fee: 5000,
            innerInstructions: [
              {
                index: 0,
                instructions: [{ programIdIndex: 0, accounts: [-1], data: "abc" }],
              },
            ],
          },
          transaction: {
            message: {
              header: {
                numRequiredSignatures: 1,
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: 0,
              },
              accountKeys: ["signer-1"],
              recentBlockhash: "GHtX",
              instructions: [{ programIdIndex: 0, accounts: [0], data: "abc" }],
            },
          },
        }) as never,
      ),
    ).toThrow("inner instruction index out of bounds (programIdIndex=0, accounts=[-1]");
  });

  it("normalizes NaN blockTime to null", () => {
    const normalized = normalizeTransactionProbe("sig", makeFullEnvelope({ blockTime: NaN }) as never);

    expect(normalized!.blockTime).toBeNull();
  });

  it("rejects zero required signatures", () => {
    expect(() =>
      normalizeTransactionProbe(
        "sig",
        makeFullEnvelope({
          meta: null,
          transaction: {
            message: {
              header: {
                numRequiredSignatures: 0,
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: 0,
              },
              accountKeys: ["a"],
              instructions: [],
            },
          },
        }) as never,
      ),
    ).toThrow("numRequiredSignatures (0) out of range");
  });

  it("defaults confirmations to null for non-finalized with null count", () => {
    const normalized = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope() as never,
      makeStatusEnvelope({
        confirmationStatus: "confirmed",
        confirmations: null,
      }),
    );

    expect(normalized).toMatchObject({
      confirmationStatus: "confirmed",
      confirmations: null,
    });
  });

  it("maps unrecognized confirmation status to null while preserving confirmations", () => {
    const normalized = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope() as never,
      makeStatusEnvelope({
        confirmationStatus: "optimistic" as never,
        confirmations: 5,
      }),
    );

    expect(normalized).toMatchObject({
      confirmationStatus: null,
      confirmations: 5,
    });
  });

  it("throws when inner instruction group index exceeds instruction count", () => {
    expect(() =>
      normalizeTransactionProbe(
        "sig",
        makeFullEnvelope({
          meta: {
            err: null,
            fee: 5000,
            innerInstructions: [
              {
                index: 5,
                instructions: [{ programIdIndex: 0, accounts: [0], data: "abc" }],
              },
            ],
          },
          transaction: {
            message: {
              header: {
                numRequiredSignatures: 1,
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: 0,
              },
              accountKeys: ["signer-1"],
              recentBlockhash: "GHtX",
              instructions: [{ programIdIndex: 0, accounts: [0], data: "abc" }],
            },
          },
        }) as never,
      ),
    ).toThrow("inner instruction group index (5) out of bounds for 1 instructions");
  });

  it("throws when inner instruction group index equals instruction count (off-by-one)", () => {
    expect(() =>
      normalizeTransactionProbe(
        "sig",
        makeFullEnvelope({
          meta: {
            err: null,
            fee: 5000,
            innerInstructions: [
              {
                index: 1,
                instructions: [{ programIdIndex: 0, accounts: [0], data: "abc" }],
              },
            ],
          },
          transaction: {
            message: {
              header: {
                numRequiredSignatures: 1,
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: 0,
              },
              accountKeys: ["signer-1"],
              recentBlockhash: "GHtX",
              instructions: [{ programIdIndex: 0, accounts: [0], data: "abc" }],
            },
          },
        }) as never,
      ),
    ).toThrow("inner instruction group index (1) out of bounds for 1 instructions");
  });

  it("throws when inner instruction group index is negative", () => {
    expect(() =>
      normalizeTransactionProbe(
        "sig",
        makeFullEnvelope({
          meta: {
            err: null,
            fee: 5000,
            innerInstructions: [
              {
                index: -1,
                instructions: [{ programIdIndex: 0, accounts: [0], data: "abc" }],
              },
            ],
          },
          transaction: {
            message: {
              header: {
                numRequiredSignatures: 1,
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: 0,
              },
              accountKeys: ["signer-1"],
              recentBlockhash: "GHtX",
              instructions: [{ programIdIndex: 0, accounts: [0], data: "abc" }],
            },
          },
        }) as never,
      ),
    ).toThrow("inner instruction group index (-1) out of bounds");
  });

  it("normalizes Infinity blockTime to null", () => {
    const normalized = normalizeTransactionProbe("sig", makeFullEnvelope({ blockTime: Infinity }) as never);

    expect(normalized!.blockTime).toBeNull();
  });

  it("normalizes -Infinity fee to null", () => {
    const normalized = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope({
        meta: { err: null, fee: -Infinity },
      }) as never,
    );

    expect(normalized!.feeLamports).toBeNull();
  });

  it("rejects empty account keys with zero signatures", () => {
    expect(() =>
      normalizeTransactionProbe(
        "sig",
        makeFullEnvelope({
          meta: null,
          transaction: {
            message: {
              header: {
                numRequiredSignatures: 0,
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: 0,
              },
              accountKeys: [],
              instructions: [],
            },
          },
        }) as never,
      ),
    ).toThrow("numRequiredSignatures (0) out of range");
  });

  it("defaults confirmation fields when status envelope has null value", () => {
    const normalized = normalizeTransactionProbe("sig", makeFullEnvelope() as never, { value: null });

    expect(normalized).toMatchObject({
      confirmationStatus: null,
      confirmations: null,
    });
  });

  it("stringifies unrecognized error shape", () => {
    const normalized = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope({
        meta: { err: 42, fee: 5000 },
      }) as never,
    );

    expect(normalized).toMatchObject({
      status: "failed",
      err: "42",
    });
  });

  it("stringifies unsafe finite number values", () => {
    const unsafeNumber = Number.MAX_SAFE_INTEGER + 1;
    const normalized = normalizeTransactionProbe(
      "sig",
      makeFullEnvelope({
        meta: { err: null, fee: unsafeNumber },
      }) as never,
    );

    expect(normalized!.feeLamports).toBe(String(unsafeNumber));
  });
});
