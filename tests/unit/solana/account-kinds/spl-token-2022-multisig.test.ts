import { describe, expect, it } from "vitest";
import { TOKEN_2022_PROGRAM_ID } from "../../../../lib/solana/constants";
import { buildSplToken2022MultisigPayload } from "../../../../lib/solana/account-kinds/spl-token-2022-multisig";
import type { AccountPayloadContext } from "../../../../lib/solana/types";

const KIND = "spl-token-2022:multisig" as const;

function makeContext(parsedInfo: Record<string, unknown> | null): AccountPayloadContext {
  return {
    kind: KIND,
    account: {
      owner: TOKEN_2022_PROGRAM_ID,
      parsedProgram: "spl-token-2022",
      parsedData: parsedInfo ? { info: parsedInfo } : null,
      rawDataBytes: null,
    },
  };
}

describe("buildSplToken2022MultisigPayload", () => {
  it("extracts all multisig fields from parsedData.info", () => {
    const signers = ["Signer111", "Signer222"];
    const result = buildSplToken2022MultisigPayload(
      makeContext({
        isInitialized: true,
        numRequiredSigners: 1,
        numValidSigners: 2,
        signers,
      }),
    );
    expect(result).toMatchObject({
      entity: {
        kind: KIND,
        token_program: TOKEN_2022_PROGRAM_ID,
        is_initialized: true,
        num_required_signers: 1,
        num_valid_signers: 2,
        signers,
      },
    });
  });

  it("returns null for all fields when parsedData is null", () => {
    const result = buildSplToken2022MultisigPayload(makeContext(null));
    const entity = result.entity as Record<string, unknown>;
    expect(entity.is_initialized).toBeNull();
    expect(entity.num_required_signers).toBeNull();
    expect(entity.num_valid_signers).toBeNull();
    expect(entity.signers).toBeNull();
  });

  it("filters non-string signers", () => {
    const result = buildSplToken2022MultisigPayload(
      makeContext({
        isInitialized: true,
        numRequiredSigners: 1,
        numValidSigners: 1,
        signers: ["Valid111", null, 42],
      }),
    );
    expect((result.entity as Record<string, unknown>).signers).toEqual(["Valid111"]);
  });

  it("uses TOKEN_2022_PROGRAM_ID as token_program", () => {
    const result = buildSplToken2022MultisigPayload(
      makeContext({
        isInitialized: false,
        numRequiredSigners: 0,
        numValidSigners: 0,
        signers: [],
      }),
    );
    expect((result.entity as Record<string, unknown>).token_program).toBe(TOKEN_2022_PROGRAM_ID);
  });
});
