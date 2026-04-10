import { describe, expect, it } from "vitest";

import { TOKEN_2022_PROGRAM_ID } from "../../../../lib/solana/constants";
import { buildBpfUpgradeableLoaderPayload } from "../../../../lib/solana/account-kinds/bpf-upgradeable-loader";

describe("bpf-upgradeable-loader account kind payload", () => {
  it("builds resolved programData payload with deployment fields", () => {
    const executableDataAddress = "DoU57AYuPfu2QU514RktNPG220AhpEjnKxnBcu4HDTY";
    const upgradeAuthority = "AeLnXCBPaQHGWRLr2saFsEVfnMNuKixRAbWCT9P5twgZ";
    const result = buildBpfUpgradeableLoaderPayload({
      kind: "bpf-upgradeable-loader",
      account: {
        address: TOKEN_2022_PROGRAM_ID,
        owner: "owner",
        parsedProgram: "bpf-upgradeable-loader",
        parsedData: {
          type: "program",
          info: { programData: executableDataAddress },
        },
        rawDataBytes: null,
        lamports: 567591537,
        executable: true,
        programDataAddress: executableDataAddress,
        programData: { authority: upgradeAuthority, slot: 395847597 },
        programDataStatus: "resolved",
      },
    });

    expect(result).toMatchObject({
      entity: {
        kind: "bpf-upgradeable-loader",
        address: TOKEN_2022_PROGRAM_ID,
        address_label: "Token-2022 Program",
        balance_lamports: 567591537,
        executable: true,
        executable_data: executableDataAddress,
        upgradeable: true,
        last_deployed_slot: 395847597,
        upgrade_authority: upgradeAuthority,
        verification: { status: "unknown" },
        security_metadata: { status: "unknown" },
        idl: { status: "unknown" },
      },
    });

    const entity = result.entity as Record<string, unknown>;
    expect(Object.keys(entity).sort()).toEqual([
      "address",
      "address_label",
      "balance_lamports",
      "executable",
      "executable_data",
      "idl",
      "kind",
      "last_deployed_slot",
      "multisig",
      "owner_program",
      "security_metadata",
      "upgrade_authority",
      "upgradeable",
      "verification",
    ]);
  });

  it("builds source-unavailable markers deterministically", () => {
    expect(
      buildBpfUpgradeableLoaderPayload({
        kind: "bpf-upgradeable-loader",
        account: {
          address: TOKEN_2022_PROGRAM_ID,
          owner: "owner",
          parsedProgram: "bpf-upgradeable-loader",
          parsedData: {
            type: "program",
            info: {
              programData: "ProgramData1111111111111111111111111111111111",
            },
          },
          rawDataBytes: null,
          lamports: 123,
          executable: true,
          programDataAddress: "ProgramData1111111111111111111111111111111111",
          programData: null,
          programDataStatus: "source_unavailable",
        },
      }),
    ).toMatchObject({
      entity: {
        kind: "bpf-upgradeable-loader",
        owner_program: "BPFLoaderUpgradeab1e11111111111111111111111",
        address_label: "Token-2022 Program",
        executable_data: "ProgramData1111111111111111111111111111111111",
        upgradeable: {
          status: "unknown",
          reason: "source_unavailable",
        },
      },
    });
  });

  it("builds frozen program payload with upgradeable false", () => {
    const executableDataAddress = "DoU57AYuPfu2QU514RktNPG220AhpEjnKxnBcu4HDTY";
    expect(
      buildBpfUpgradeableLoaderPayload({
        kind: "bpf-upgradeable-loader",
        account: {
          address: "FrozenProg111111111111111111111111111111111",
          owner: "BPFLoaderUpgradeab1e11111111111111111111111",
          parsedProgram: "bpf-upgradeable-loader",
          parsedData: {
            type: "program",
            info: { programData: executableDataAddress },
          },
          rawDataBytes: null,
          lamports: 1000000,
          executable: true,
          programDataAddress: executableDataAddress,
          programData: { authority: null, slot: 100000 },
          programDataStatus: "resolved",
        },
      }),
    ).toMatchObject({
      entity: {
        kind: "bpf-upgradeable-loader",
        address: "FrozenProg111111111111111111111111111111111",
        address_label: null,
        balance_lamports: 1000000,
        executable: true,
        executable_data: executableDataAddress,
        upgradeable: false,
        last_deployed_slot: 100000,
        upgrade_authority: null,
      },
    });
  });

  it("returns null address_label for unlabeled program", () => {
    const executableDataAddress = "PdataAddr111111111111111111111111111111111";
    const upgradeAuthority = "Auth1111111111111111111111111111111111111111";
    expect(
      buildBpfUpgradeableLoaderPayload({
        kind: "bpf-upgradeable-loader",
        account: {
          address: "UnlabeledProg11111111111111111111111111111",
          owner: "BPFLoaderUpgradeab1e11111111111111111111111",
          parsedProgram: "bpf-upgradeable-loader",
          parsedData: {
            type: "program",
            info: { programData: executableDataAddress },
          },
          rawDataBytes: null,
          lamports: 5000,
          executable: true,
          programDataAddress: executableDataAddress,
          programData: { authority: upgradeAuthority, slot: 200000 },
          programDataStatus: "resolved",
        },
      }),
    ).toMatchObject({
      entity: {
        address: "UnlabeledProg11111111111111111111111111111",
        address_label: null,
        upgradeable: true,
        upgrade_authority: upgradeAuthority,
      },
    });
  });

  it("passes verificationResult through to entity when present in context", () => {
    const executableDataAddress = "DoU57AYuPfu2QU514RktNPG220AhpEjnKxnBcu4HDTY";
    const upgradeAuthority = "AeLnXCBPaQHGWRLr2saFsEVfnMNuKixRAbWCT9P5twgZ";
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

    const result = buildBpfUpgradeableLoaderPayload({
      kind: "bpf-upgradeable-loader",
      account: {
        address: TOKEN_2022_PROGRAM_ID,
        owner: "owner",
        parsedProgram: "bpf-upgradeable-loader",
        parsedData: {
          type: "program",
          info: { programData: executableDataAddress },
        },
        rawDataBytes: null,
        lamports: 567591537,
        executable: true,
        programDataAddress: executableDataAddress,
        programData: { authority: upgradeAuthority, slot: 395847597 },
        programDataStatus: "resolved",
      },
      verificationResult,
    });

    expect((result as { entity: Record<string, unknown> }).entity.verification).toEqual(verificationResult);
  });

  it("passes securityMetadataResult through to entity when present in context", () => {
    const securityMetadataResult = {
      status: "present" as const,
      data: {
        name: "Test",
        project_url: "https://example.com",
        contacts: "email:a@b.com",
        policy: "policy",
        preferred_languages: null,
        encryption: null,
        source_code: null,
        source_release: null,
        source_revision: null,
        auditors: null,
        acknowledgements: null,
        expiry: null,
      },
      source_type: "embedded_security_txt" as const,
    };

    const result = buildBpfUpgradeableLoaderPayload({
      kind: "bpf-upgradeable-loader",
      account: {
        owner: "owner",
        parsedProgram: "bpf-upgradeable-loader",
        parsedData: null,
        rawDataBytes: null,
        programDataAddress: null,
        programData: null,
        programDataStatus: "missing",
      },
      securityMetadataResult,
    });

    expect((result as { entity: Record<string, unknown> }).entity.security_metadata).toEqual(securityMetadataResult);
  });

  it("falls back to unknownMarker when securityMetadataResult is absent", () => {
    const result = buildBpfUpgradeableLoaderPayload({
      kind: "bpf-upgradeable-loader",
      account: {
        owner: "owner",
        parsedProgram: "bpf-upgradeable-loader",
        parsedData: null,
        rawDataBytes: null,
        programDataAddress: null,
        programData: null,
        programDataStatus: "missing",
      },
    });

    expect((result as { entity: Record<string, unknown> }).entity.security_metadata).toEqual({
      value: null,
      status: "unknown",
      reason: "source_unavailable",
    });
  });

  it("outputs null deployment fields when programData is missing", () => {
    expect(
      buildBpfUpgradeableLoaderPayload({
        kind: "bpf-upgradeable-loader",
        account: {
          owner: "owner",
          parsedProgram: "bpf-upgradeable-loader",
          parsedData: null,
          rawDataBytes: null,
          programDataAddress: null,
          programData: null,
          programDataStatus: "missing",
        },
      }),
    ).toMatchObject({
      entity: {
        kind: "bpf-upgradeable-loader",
        address: null,
        address_label: null,
        executable_data: null,
        upgradeable: null,
        last_deployed_slot: null,
        upgrade_authority: null,
      },
    });
  });

  it("passes multisigReferenceResult through to entity when present in context", () => {
    const multisigReferenceResult = {
      status: "is_multisig" as const,
      version: "v3" as const,
      multisig_address: "MSIG1111111111111111111111111111111111111111",
      threshold: 2,
      members: [
        "Mem111111111111111111111111111111111111111",
        "Mem222222222222222222222222222222222222222",
        "Mem333333333333333333333333333333333333333",
      ],
    };

    const result = buildBpfUpgradeableLoaderPayload({
      kind: "bpf-upgradeable-loader",
      account: {
        owner: "owner",
        parsedProgram: "bpf-upgradeable-loader",
        parsedData: null,
        rawDataBytes: null,
        programDataAddress: null,
        programData: null,
        programDataStatus: "missing",
      },
      multisigReferenceResult,
    });

    expect((result as { entity: Record<string, unknown> }).entity.multisig).toEqual(multisigReferenceResult);
  });

  it("passes not_multisig result through to entity", () => {
    const result = buildBpfUpgradeableLoaderPayload({
      kind: "bpf-upgradeable-loader",
      account: {
        owner: "owner",
        parsedProgram: "bpf-upgradeable-loader",
        parsedData: null,
        rawDataBytes: null,
        programDataAddress: null,
        programData: null,
        programDataStatus: "missing",
      },
      multisigReferenceResult: { status: "not_multisig" },
    });

    expect((result as { entity: Record<string, unknown> }).entity.multisig).toEqual({ status: "not_multisig" });
  });

  it("falls back to unknownMarker when multisigReferenceResult is absent", () => {
    const result = buildBpfUpgradeableLoaderPayload({
      kind: "bpf-upgradeable-loader",
      account: {
        owner: "owner",
        parsedProgram: "bpf-upgradeable-loader",
        parsedData: null,
        rawDataBytes: null,
        programDataAddress: null,
        programData: null,
        programDataStatus: "missing",
      },
    });

    expect((result as { entity: Record<string, unknown> }).entity.multisig).toEqual({
      value: null,
      status: "unknown",
      reason: "source_unavailable",
    });
  });

  it("passes idlDiscoveryResult through to entity when present in context", () => {
    const idlDiscoveryResult = {
      status: "found" as const,
      idl_type: "anchor" as const,
      source_type: "pmp_canonical" as const,
      program_name: "test_program",
      data: {
        address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        metadata: { name: "test_program", spec: "0.1.0" },
        instructions: [],
      },
    };

    const result = buildBpfUpgradeableLoaderPayload({
      kind: "bpf-upgradeable-loader",
      account: {
        owner: "owner",
        parsedProgram: "bpf-upgradeable-loader",
        parsedData: null,
        rawDataBytes: null,
        programDataAddress: null,
        programData: null,
        programDataStatus: "missing",
      },
      idlDiscoveryResult,
    });

    expect((result as { entity: Record<string, unknown> }).entity.idl).toEqual(idlDiscoveryResult);
  });

  it("falls back to unknownMarker when idlDiscoveryResult is absent", () => {
    const result = buildBpfUpgradeableLoaderPayload({
      kind: "bpf-upgradeable-loader",
      account: {
        owner: "owner",
        parsedProgram: "bpf-upgradeable-loader",
        parsedData: null,
        rawDataBytes: null,
        programDataAddress: null,
        programData: null,
        programDataStatus: "missing",
      },
    });

    expect((result as { entity: Record<string, unknown> }).entity.idl).toEqual({
      value: null,
      status: "unknown",
      reason: "source_unavailable",
    });
  });
});
