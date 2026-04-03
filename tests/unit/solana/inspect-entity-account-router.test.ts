import { describe, expect, it } from "vitest";

import { NFTOKEN_ADDRESS, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../../../lib/solana/constants";
import { buildAccountPayloadWithRouter } from "../../../lib/solana/inspect-entity-account-router";
import type { AccountEntityKind, AccountPayloadContext } from "../../../lib/solana/types";

const ALL_ACCOUNT_KINDS = [
  "bpf-upgradeable-loader",
  "stake",
  "nftoken",
  "spl-token:mint",
  "spl-token:account",
  "spl-token:multisig",
  "spl-token-2022:mint",
  "spl-token-2022:account",
  "spl-token-2022:multisig",
  "nonce",
  "vote",
  "sysvar",
  "config",
  "address-lookup-table",
  "feature",
  "solana-attestation-service",
  "compressed-nft",
  "unknown",
] as const satisfies ReadonlyArray<AccountEntityKind>;

type MissingKinds = Exclude<AccountEntityKind, (typeof ALL_ACCOUNT_KINDS)[number]>;
type _AssertNoMissingKinds = MissingKinds extends never ? true : never;
const assertNoMissingKinds: _AssertNoMissingKinds = true;
void assertNoMissingKinds;

function contextForKind(kind: AccountEntityKind): AccountPayloadContext {
  if (kind === "bpf-upgradeable-loader") {
    return {
      kind,
      account: {
        address: TOKEN_2022_PROGRAM_ID,
        owner: "owner",
        parsedProgram: "bpf-upgradeable-loader",
        parsedData: {
          type: "program",
          info: {
            programData: "DoU57AYuPfu2QU514RktNPG220AhpEjnKxnBcu4HDTY",
          },
        },
        rawDataBytes: null,
        lamports: 567591537,
        executable: true,
        programDataAddress: "DoU57AYuPfu2QU514RktNPG220AhpEjnKxnBcu4HDTY",
        programData: {
          authority: "AeLnXCBPaQHGWRLr2saFsEVfnMNuKixRAbWCT9P5twgZ",
          slot: 395847597,
        },
        programDataStatus: "resolved",
      },
    };
  }

  if (kind === "compressed-nft") {
    return {
      kind,
      account: {
        owner: "owner",
        parsedProgram: null,
        parsedData: null,
        rawDataBytes: null,
      },
      dasOutcome: {
        compressed: true,
        assetId: "asset",
        owner: "owner-address",
        tree: "tree-address",
      },
    };
  }

  if (kind === "spl-token:mint" || kind === "spl-token-2022:mint") {
    const isTok2022 = kind === "spl-token-2022:mint";
    return {
      kind,
      account: {
        address: "MintAddress111111111111111111111111111111111",
        owner: isTok2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
        parsedProgram: isTok2022 ? "spl-token-2022" : "spl-token",
        parsedData: {
          type: "mint",
          info: {
            supply: "1000000000",
            decimals: 6,
            isInitialized: true,
            mintAuthority: "AuthAddr1111111111111111111111111111111111111",
            freezeAuthority: null,
            ...(isTok2022
              ? {
                  extensions: [
                    {
                      extension: "transferFeeConfig",
                      state: { withheldAmount: "0" },
                    },
                  ],
                }
              : {}),
          },
        },
        rawDataBytes: null,
      },
    };
  }

  if (kind.startsWith("spl-token")) {
    return {
      kind,
      account: {
        owner: "TokenProgram",
        parsedProgram: kind.startsWith("spl-token-2022") ? "spl-token-2022" : "spl-token",
        parsedData: {
          info: {
            mint: "mint-address",
            owner: "owner-address",
          },
        },
        rawDataBytes: null,
      },
    };
  }

  return {
    kind,
    account: {
      owner: "owner",
      parsedProgram: null,
      parsedData: null,
      rawDataBytes: null,
    },
  };
}

describe("inspect-entity account router", () => {
  it("returns a payload with entity.kind for every account kind", () => {
    for (const kind of ALL_ACCOUNT_KINDS) {
      const context = contextForKind(kind);
      const payload = buildAccountPayloadWithRouter(context);
      expect(payload).toHaveProperty("entity.kind", kind);
    }
  });

  it("builds compressed-nft payload from DAS outcome", () => {
    const payload = buildAccountPayloadWithRouter({
      kind: "compressed-nft",
      account: {
        owner: "owner",
        parsedProgram: null,
        parsedData: null,
        rawDataBytes: null,
      },
      dasOutcome: {
        compressed: true,
        assetId: "asset",
        owner: "owner-address",
        tree: "tree-address",
      },
    });

    expect(payload).toMatchObject({
      entity: {
        kind: "compressed-nft",
        asset_id: "asset",
        owner: "owner-address",
        tree: "tree-address",
      },
    });
  });

  it("builds spl-token payload with token_program field", () => {
    const payload = buildAccountPayloadWithRouter({
      kind: "spl-token:account",
      account: {
        owner: "TokenProgram",
        parsedProgram: "spl-token",
        parsedData: {
          info: { mint: "mint-address", owner: "owner-address" },
        },
        rawDataBytes: null,
      },
    });

    expect(payload).toMatchObject({
      entity: {
        mint: "mint-address",
        owner: "owner-address",
        token_program: "TokenProgram",
      },
    });
  });

  it("builds spl-token-2022 payload with token_program field", () => {
    const payload = buildAccountPayloadWithRouter({
      kind: "spl-token-2022:account",
      account: {
        owner: "Token2022Program",
        parsedProgram: "spl-token-2022",
        parsedData: {
          info: { mint: "mint-2022-address", owner: "owner-2022-address" },
        },
        rawDataBytes: null,
      },
    });

    expect(payload).toMatchObject({
      entity: {
        mint: "mint-2022-address",
        owner: "owner-2022-address",
        token_program: "Token2022Program",
      },
    });
  });

  it("builds spl-token:mint payload with core mint fields", () => {
    const payload = buildAccountPayloadWithRouter(contextForKind("spl-token:mint"));
    expect(payload).toMatchObject({
      entity: {
        kind: "spl-token:mint",
        address: "MintAddress111111111111111111111111111111111",
        token_program: TOKEN_PROGRAM_ID,
        supply: "1000000000",
        decimals: 6,
        is_initialized: true,
        mint_authority: "AuthAddr1111111111111111111111111111111111111",
        freeze_authority: null,
        supply_type: "variable",
      },
    });
    expect(payload.entity).not.toHaveProperty("extensions");
  });

  it("builds spl-token-2022:mint payload with extensions", () => {
    const payload = buildAccountPayloadWithRouter(contextForKind("spl-token-2022:mint"));
    expect(payload).toMatchObject({
      entity: {
        kind: "spl-token-2022:mint",
        supply: "1000000000",
        decimals: 6,
        extensions: [{ extension: "transferFeeConfig", state: { withheldAmount: "0" } }],
      },
    });
  });

  it("preserves extension state shape including BigInt values", () => {
    const payload = buildAccountPayloadWithRouter({
      kind: "spl-token-2022:mint",
      account: {
        address: "BigIntMint",
        owner: TOKEN_2022_PROGRAM_ID,
        parsedProgram: "spl-token-2022",
        parsedData: {
          type: "mint",
          info: {
            supply: "1000",
            decimals: 6,
            isInitialized: true,
            mintAuthority: null,
            freezeAuthority: null,
            extensions: [
              {
                extension: "transferFeeConfig",
                state: {
                  newerTransferFee: {
                    epoch: BigInt(605),
                    maximumFee: BigInt(0),
                    transferFeeBasisPoints: 100,
                  },
                  withheldAmount: BigInt(0),
                },
              },
            ],
          },
        },
        rawDataBytes: null,
      },
    });

    const ext = (payload.entity as Record<string, unknown>).extensions as Array<{ state: unknown }>;
    const state = ext[0]!.state as Record<string, unknown>;
    // Builder preserves raw values; BigInt coercion happens in toToolResult
    expect(state.withheldAmount).toBe(BigInt(0));
    const newerFee = state.newerTransferFee as Record<string, unknown>;
    expect(newerFee.epoch).toBe(BigInt(605));
    expect(newerFee.transferFeeBasisPoints).toBe(100);
  });

  it("builds spl-token-2022:mint with null extensions when none present", () => {
    const payload = buildAccountPayloadWithRouter({
      kind: "spl-token-2022:mint",
      account: {
        address: "NoExtMint",
        owner: TOKEN_2022_PROGRAM_ID,
        parsedProgram: "spl-token-2022",
        parsedData: {
          type: "mint",
          info: {
            supply: "100",
            decimals: 0,
            isInitialized: true,
            mintAuthority: null,
            freezeAuthority: null,
          },
        },
        rawDataBytes: null,
      },
    });
    expect(payload).toMatchObject({
      entity: {
        kind: "spl-token-2022:mint",
        supply_type: "fixed",
        extensions: null,
      },
    });
  });

  it("omits token_program when owner is null", () => {
    const payload = buildAccountPayloadWithRouter({
      kind: "spl-token:mint",
      account: {
        owner: null,
        parsedProgram: "spl-token",
        parsedData: { info: {} },
        rawDataBytes: null,
      },
    });
    expect(payload).toMatchObject({
      entity: {
        kind: "spl-token:mint",
        supply: null,
        decimals: null,
        is_initialized: null,
        mint_authority: null,
        freeze_authority: null,
        supply_type: null,
      },
    });
    expect(payload.entity).not.toHaveProperty("token_program");
  });

  it("builds nftoken payload with owner_program", () => {
    const payload = buildAccountPayloadWithRouter({
      kind: "nftoken",
      account: {
        owner: NFTOKEN_ADDRESS,
        parsedProgram: null,
        parsedData: null,
        rawDataBytes: null,
      },
    });

    expect(payload).toMatchObject({
      entity: { owner_program: NFTOKEN_ADDRESS },
    });
  });
});
