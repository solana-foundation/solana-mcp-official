import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  enrichUpgradeableProgramData,
  extractProgramDataInfo,
  extractRawDataBytesFromAccountData,
  normalizeAccountProbe,
} from "../../../lib/solana/account-normalizer";
import type { AccountProbeEnvelope, NormalizedAccountInfo, NormalizedProgramDataInfo } from "../../../lib/solana/types";
import { SourceUnavailableError } from "../../../lib/solana/rpc";
import { logger } from "../../../lib/observability/logger";

describe("inspect-entity account normalizer", () => {
  it("extracts raw data bytes from same-response base64 tuple", () => {
    const source = Buffer.from([1, 2, 3, 4]).toString("base64");
    const rawBytes = extractRawDataBytesFromAccountData([source, "base64"]);

    expect(rawBytes).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(extractRawDataBytesFromAccountData(["abc", "jsonParsed"])).toBeNull();
  });

  it("returns null when envelope value is null", () => {
    expect(normalizeAccountProbe("addr", { value: null })).toBeNull();
  });

  it("normalizes account probes with parsed and raw fields", () => {
    const source = Buffer.from([1, 2, 3, 4]).toString("base64");
    const parsedEnvelope: AccountProbeEnvelope = {
      value: {
        owner: "Owner111111111111111111111111111111111111",
        lamports: 99,
        executable: true,
        data: {
          program: "bpf-upgradeable-loader",
          parsed: {
            type: "program",
            info: {
              programData: "ProgramData1111111111111111111111111111111111",
            },
          },
        },
      },
    };

    expect(normalizeAccountProbe("addr", parsedEnvelope)).toMatchObject({
      address: "addr",
      owner: "Owner111111111111111111111111111111111111",
      parsedProgram: "bpf-upgradeable-loader",
      lamports: 99,
      executable: true,
      programDataAddress: "ProgramData1111111111111111111111111111111111",
      programDataStatus: "missing",
    });

    const rawEnvelope: AccountProbeEnvelope = {
      value: {
        owner: "Owner111111111111111111111111111111111111",
        lamports: 0,
        executable: false,
        data: [source, "base64"],
      },
    };

    expect(normalizeAccountProbe("addr", rawEnvelope)).toMatchObject({
      rawDataBytes: new Uint8Array([1, 2, 3, 4]),
    });
  });

  it("extracts programData info for authority and authority-null branches", () => {
    expect(
      extractProgramDataInfo({
        type: "programData",
        info: {
          authority: "Authority1111111111111111111111111111111111",
          slot: 7,
        },
      }),
    ).toEqual({
      authority: "Authority1111111111111111111111111111111111",
      slot: 7,
    });

    expect(
      extractProgramDataInfo({
        type: "programData",
        info: {
          authority: null,
          slot: 8,
        },
      }),
    ).toEqual({
      authority: null,
      slot: 8,
    });
  });

  it("preserves programDataRawBase64 when enriching upgradeable program data", async () => {
    const programDataB64 = Buffer.from("cafebabe", "hex").toString("base64");
    const account: NormalizedAccountInfo = {
      owner: "BPFLoaderUpgradeab1e11111111111111111111111",
      parsedProgram: "bpf-upgradeable-loader",
      parsedData: {
        type: "program",
        info: { programData: "ProgramData111111111111111111111111111111111" },
      },
      rawDataBytes: null,
      programDataAddress: "ProgramData111111111111111111111111111111111",
      programData: null,
      programDataStatus: "missing",
    };

    const fetchAccount = vi.fn().mockResolvedValue({
      value: {
        owner: "BPFLoaderUpgradeab1e11111111111111111111111",
        lamports: 0,
        executable: false,
        data: {
          program: "bpf-upgradeable-loader",
          parsed: {
            type: "programData",
            info: {
              authority: "Auth11111111111111111111111111111111111111111",
              data: [programDataB64, "base64"],
              slot: 100,
            },
          },
        },
      },
    } satisfies AccountProbeEnvelope);

    const enriched = await enrichUpgradeableProgramData(account, "mainnet-beta", fetchAccount);

    expect(enriched.programDataRawBase64).toBe(programDataB64);
    expect(enriched.programDataStatus).toBe("resolved");
    expect(enriched.programData).toEqual({
      authority: "Auth11111111111111111111111111111111111111111",
      slot: 100,
    });
    expectTypeOf(enriched.programData).toEqualTypeOf<NormalizedProgramDataInfo | null | undefined>();
  });

  it("returns source_unavailable when fetchAccount throws non-SourceUnavailableError", async () => {
    const account: NormalizedAccountInfo = {
      owner: "BPFLoaderUpgradeab1e11111111111111111111111",
      parsedProgram: "bpf-upgradeable-loader",
      parsedData: {
        type: "program",
        info: {
          programData: "ProgramData111111111111111111111111111111111",
        },
      },
      rawDataBytes: null,
      programDataAddress: "ProgramData111111111111111111111111111111111",
      programData: null,
      programDataStatus: "missing",
    };

    const fetchAccount = vi.fn().mockRejectedValue(new TypeError("unexpected shape"));

    const enriched = await enrichUpgradeableProgramData(account, "mainnet-beta", fetchAccount);

    expect(enriched.programDataStatus).toBe("source_unavailable");
  });

  it("logs warning when fetchAccount throws SourceUnavailableError", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const account: NormalizedAccountInfo = {
      address: "Program111111111111111111111111111111111111",
      owner: "BPFLoaderUpgradeab1e11111111111111111111111",
      parsedProgram: "bpf-upgradeable-loader",
      parsedData: {
        type: "program",
        info: { programData: "ProgramData111111111111111111111111111111111" },
      },
      rawDataBytes: null,
      programDataAddress: "ProgramData111111111111111111111111111111111",
      programData: null,
      programDataStatus: "missing",
    };

    const rpcError = new SourceUnavailableError("RPC down");
    const fetchAccount = vi.fn().mockRejectedValue(rpcError);

    const enriched = await enrichUpgradeableProgramData(account, "mainnet-beta", fetchAccount);

    expect(enriched.programDataStatus).toBe("source_unavailable");
    expect(warnSpy).toHaveBeenCalledWith({
      event: "normalizer.enrich_program_data_source_unavailable",
      programAddress: "Program111111111111111111111111111111111111",
      error: rpcError,
    });

    warnSpy.mockRestore();
  });

  it("preserves large BigInt lamports as string", () => {
    const envelope: AccountProbeEnvelope = {
      value: {
        owner: "Owner111111111111111111111111111111111111",
        lamports: 9_007_199_254_740_993n,
        executable: false,
        data: ["", "base64"],
      },
    };

    const result = normalizeAccountProbe("addr", envelope);
    expect(result?.lamports).toBe("9007199254740993");
  });

  it("returns null for invalid programData payloads", () => {
    expect(extractProgramDataInfo({ type: "program", info: {} })).toBeNull();
    expect(
      extractProgramDataInfo({
        type: "programData",
        info: {
          authority: "Authority1111111111111111111111111111111111",
        },
      }),
    ).toBeNull();
    expect(
      extractProgramDataInfo({
        type: "programData",
        info: {
          authority: "",
          slot: 9,
        },
      }),
    ).toBeNull();
  });
});
