import { describe, expect, it } from "vitest";

import { LOADER_V4_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "../../../../lib/solana/constants";
import { buildLoaderV4Payload } from "../../../../lib/solana/account-kinds/loader";

describe("loader-v4 account kind payload", () => {
  it("builds payload with correct kind and owner_program", () => {
    const result = buildLoaderV4Payload({
      kind: "loader-v4",
      account: {
        address: "V4Prog11111111111111111111111111111111111111",
        owner: LOADER_V4_PROGRAM_ID,
        parsedProgram: null,
        parsedData: null,
        rawDataBytes: null,
        lamports: 3000000,
        executable: true,
      },
    });

    expect(result).toMatchObject({
      entity: {
        kind: "loader-v4",
        owner_program: LOADER_V4_PROGRAM_ID,
        address: "V4Prog11111111111111111111111111111111111111",
        balance_lamports: 3000000,
        executable: true,
      },
    });

    const entity = result.entity as Record<string, unknown>;
    expect(Object.keys(entity).sort()).toEqual([
      "address",
      "address_label",
      "balance_lamports",
      "executable",
      "idl",
      "kind",
      "multisig",
      "owner_program",
      "security_metadata",
      "verification",
    ]);
  });

  it("resolves address_label for known programs", () => {
    const result = buildLoaderV4Payload({
      kind: "loader-v4",
      account: {
        address: TOKEN_2022_PROGRAM_ID,
        owner: LOADER_V4_PROGRAM_ID,
        parsedProgram: null,
        parsedData: null,
        rawDataBytes: null,
      },
    });

    expect((result.entity as Record<string, unknown>).address_label).toBe("Token-2022 Program");
  });

  it("returns null address_label for unlabeled programs", () => {
    const result = buildLoaderV4Payload({
      kind: "loader-v4",
      account: {
        address: "Unknown111111111111111111111111111111111111",
        owner: LOADER_V4_PROGRAM_ID,
        parsedProgram: null,
        parsedData: null,
        rawDataBytes: null,
      },
    });

    expect((result.entity as Record<string, unknown>).address_label).toBeNull();
  });

  it("passes verificationResult through to entity when present", () => {
    const verificationResult = {
      status: "verified" as const,
      evidence: {
        signer: "5vJwnLeyjV8uNJSp1zn7VLW8GwiQbcsQbGaVSwRmkE4r",
        signer_label: "Foundation",
        on_chain_hash: "abc123",
        executable_hash: "def456",
        last_verified_at: "2026-01-15T00:00:00Z",
        repo_url: "https://github.com/example/repo/tree/abc",
        is_frozen: false,
        message: "Verification information provided by a trusted signer.",
      },
    };

    const result = buildLoaderV4Payload({
      kind: "loader-v4",
      account: {
        owner: LOADER_V4_PROGRAM_ID,
        parsedProgram: null,
        parsedData: null,
        rawDataBytes: null,
      },
      verificationResult,
    });

    expect((result.entity as Record<string, unknown>).verification).toEqual(verificationResult);
  });

  it("falls back to unknownMarker for absent optional context fields", () => {
    const result = buildLoaderV4Payload({
      kind: "loader-v4",
      account: {
        owner: LOADER_V4_PROGRAM_ID,
        parsedProgram: null,
        parsedData: null,
        rawDataBytes: null,
      },
    });

    const entity = result.entity as Record<string, unknown>;
    const marker = { value: null, status: "unknown", reason: "source_unavailable" };
    expect(entity.verification).toEqual(marker);
    expect(entity.security_metadata).toEqual(marker);
    expect(entity.idl).toEqual(marker);
    expect(entity.multisig).toEqual(marker);
  });

  it("outputs null for missing address and lamports", () => {
    const result = buildLoaderV4Payload({
      kind: "loader-v4",
      account: {
        owner: LOADER_V4_PROGRAM_ID,
        parsedProgram: null,
        parsedData: null,
        rawDataBytes: null,
      },
    });

    const entity = result.entity as Record<string, unknown>;
    expect(entity.address).toBeNull();
    expect(entity.balance_lamports).toBeNull();
    expect(entity.executable).toBeNull();
  });
});
