import { describe, expect, it } from "vitest";

import {
  assertUnreachable,
  buildMintOverviewFields,
  buildTokenEntityFields,
  unknownMarker,
} from "../../../../lib/solana/account-kinds/shared";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../../../../lib/solana/constants";

describe("account kind shared helpers", () => {
  it("throws for unreachable account kinds", () => {
    expect(() => assertUnreachable("impossible" as never)).toThrow("Unhandled account entity kind");
  });

  it("builds deterministic unknown markers", () => {
    expect(unknownMarker("source_unavailable")).toEqual({
      value: null,
      status: "unknown",
      reason: "source_unavailable",
    });
  });

  it("builds token fields with and without token_program", () => {
    expect(
      buildTokenEntityFields("spl-token:account", {
        owner: "TokenProgram",
        parsedProgram: "spl-token",
        parsedData: {
          info: {
            mint: "mint-address",
            owner: "owner-address",
          },
        },
        rawDataBytes: null,
      }),
    ).toEqual({
      mint: "mint-address",
      owner: "owner-address",
      token_program: "TokenProgram",
    });

    expect(
      buildTokenEntityFields("spl-token:mint", {
        owner: null,
        parsedProgram: "spl-token",
        parsedData: {
          info: {},
        },
        rawDataBytes: null,
      }),
    ).toEqual({});
  });
});

describe("buildMintOverviewFields", () => {
  it("extracts all core fields from a complete mint", () => {
    expect(
      buildMintOverviewFields({
        address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        owner: TOKEN_PROGRAM_ID,
        parsedProgram: "spl-token",
        parsedData: {
          info: {
            supply: "5034943880217036",
            decimals: 6,
            isInitialized: true,
            mintAuthority: "2wmVCSfPxGPjrnMMn7rchp4uaeoTqN39mXFC2kPdENMD",
            freezeAuthority: "3sNBr7kMccME5D55xNgsmYpZnzPgP2g12CixAajXypn6",
          },
        },
        rawDataBytes: null,
      }),
    ).toEqual({
      address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      token_program: TOKEN_PROGRAM_ID,
      supply: "5034943880217036",
      decimals: 6,
      is_initialized: true,
      mint_authority: "2wmVCSfPxGPjrnMMn7rchp4uaeoTqN39mXFC2kPdENMD",
      freeze_authority: "3sNBr7kMccME5D55xNgsmYpZnzPgP2g12CixAajXypn6",
      supply_type: "variable",
    });
  });

  it("returns supply_type 'fixed' when mintAuthority is null", () => {
    const result = buildMintOverviewFields({
      address: "SomeFixedMint",
      owner: TOKEN_PROGRAM_ID,
      parsedProgram: "spl-token",
      parsedData: {
        info: {
          supply: "1000000",
          decimals: 9,
          isInitialized: true,
          mintAuthority: null,
          freezeAuthority: null,
        },
      },
      rawDataBytes: null,
    });
    expect(result.supply_type).toBe("fixed");
    expect(result.mint_authority).toBeNull();
    expect(result.freeze_authority).toBeNull();
  });

  it("returns supply_type null when mint is not initialized", () => {
    const result = buildMintOverviewFields({
      address: "UninitMint",
      owner: TOKEN_PROGRAM_ID,
      parsedProgram: "spl-token",
      parsedData: {
        info: {
          supply: "0",
          decimals: 0,
          isInitialized: false,
          mintAuthority: null,
          freezeAuthority: null,
        },
      },
      rawDataBytes: null,
    });
    expect(result.supply_type).toBeNull();
  });

  it("returns null fields when parsedData is null", () => {
    const result = buildMintOverviewFields({
      address: "SomeAddr",
      owner: null,
      parsedProgram: null,
      parsedData: null,
      rawDataBytes: null,
    });
    expect(result).toEqual({
      address: "SomeAddr",
      supply: null,
      decimals: null,
      is_initialized: null,
      mint_authority: null,
      freeze_authority: null,
      supply_type: null,
    });
    expect(result).not.toHaveProperty("token_program");
  });

  it("returns supply_type null when mintAuthority key is absent from parsed info", () => {
    const result = buildMintOverviewFields({
      address: "PartialMint",
      owner: TOKEN_PROGRAM_ID,
      parsedProgram: "spl-token",
      parsedData: {
        info: {
          supply: "1000",
          decimals: 6,
          isInitialized: true,
        },
      },
      rawDataBytes: null,
    });
    expect(result.supply_type).toBeNull();
    expect(result.is_initialized).toBe(true);
  });

  it("populates token_program from account.owner", () => {
    const result = buildMintOverviewFields({
      owner: TOKEN_2022_PROGRAM_ID,
      parsedProgram: "spl-token-2022",
      parsedData: {
        info: {
          supply: "0",
          decimals: 0,
          isInitialized: true,
          mintAuthority: null,
          freezeAuthority: null,
        },
      },
      rawDataBytes: null,
    });
    expect(result.token_program).toBe(TOKEN_2022_PROGRAM_ID);
  });
});
