import { describe, expect, it } from "vitest";
import { TOKEN_PROGRAM_ID } from "../../../../lib/solana/constants";
import { buildSplTokenMultisigPayload } from "../../../../lib/solana/account-kinds/spl-token-multisig";
import type { AccountPayloadContext } from "../../../../lib/solana/types";

const KIND = "spl-token:multisig" as const;

function makeContext(parsedInfo: Record<string, unknown> | null): AccountPayloadContext {
  return {
    kind: KIND,
    account: {
      owner: TOKEN_PROGRAM_ID,
      parsedProgram: "spl-token",
      parsedData: parsedInfo ? { info: parsedInfo } : null,
      rawDataBytes: null,
    },
  };
}

describe("buildSplTokenMultisigPayload", () => {
  it("extracts all multisig fields from parsedData.info", () => {
    const signers = [
      "Signer1111111111111111111111111111111111111",
      "Signer2222222222222222222222222222222222222",
      "Signer3333333333333333333333333333333333333",
    ];
    const result = buildSplTokenMultisigPayload(
      makeContext({
        isInitialized: true,
        numRequiredSigners: 2,
        numValidSigners: 3,
        signers,
      }),
    );
    expect(result).toMatchObject({
      entity: {
        kind: KIND,
        token_program: TOKEN_PROGRAM_ID,
        is_initialized: true,
        num_required_signers: 2,
        num_valid_signers: 3,
        signers,
      },
    });
  });

  it("exposes token_program from account.owner", () => {
    const result = buildSplTokenMultisigPayload(
      makeContext({
        isInitialized: true,
        numRequiredSigners: 1,
        numValidSigners: 1,
        signers: [],
      }),
    );
    expect((result.entity as Record<string, unknown>).token_program).toBe(TOKEN_PROGRAM_ID);
  });

  it("returns null for all multisig fields when parsedData is null — no throw", () => {
    const result = buildSplTokenMultisigPayload(makeContext(null));
    const entity = result.entity as Record<string, unknown>;
    expect(entity.is_initialized).toBeNull();
    expect(entity.num_required_signers).toBeNull();
    expect(entity.num_valid_signers).toBeNull();
    expect(entity.signers).toBeNull();
  });

  it("returns empty array for empty signers", () => {
    const result = buildSplTokenMultisigPayload(
      makeContext({
        isInitialized: false,
        numRequiredSigners: 0,
        numValidSigners: 0,
        signers: [],
      }),
    );
    expect((result.entity as Record<string, unknown>).signers).toEqual([]);
  });

  it("filters out non-string entries from signers array", () => {
    const result = buildSplTokenMultisigPayload(
      makeContext({
        isInitialized: true,
        numRequiredSigners: 1,
        numValidSigners: 1,
        signers: ["ValidPubkey111111111111111111111111111111111", null, 42, undefined],
      }),
    );
    expect((result.entity as Record<string, unknown>).signers).toEqual([
      "ValidPubkey111111111111111111111111111111111",
    ]);
  });
});
