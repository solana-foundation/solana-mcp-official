import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/solana/rpc", () => ({
  fetchAccountInfo: vi.fn(),
}));

vi.mock("../../../../lib/solana/account-normalizer", () => ({
  normalizeAccountProbe: vi.fn(),
}));

import { resolveSplMultisigReference } from "../../../../lib/solana/resolvers/spl-multisig";
import { fetchAccountInfo } from "../../../../lib/solana/rpc";
import { normalizeAccountProbe } from "../../../../lib/solana/account-normalizer";

const ADDRESS = "SplMultisig111111111111111111111111111111111";
const CLUSTER = "mainnet-beta" as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNormalizedSplMultisig(parsedProgram: string, info: Record<string, unknown>) {
  return {
    address: ADDRESS,
    owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    parsedProgram,
    parsedData: { type: "multisig", info },
    rawDataBytes: null,
    lamports: 2039280,
    executable: false,
    programDataAddress: null,
    programData: null,
    programDataStatus: "missing" as const,
  };
}

// ── Guard clauses ────────────────────────────────────────────────────────────

describe("resolveSplMultisigReference — guard clauses", () => {
  it("returns not_multisig when account does not exist", async () => {
    vi.mocked(fetchAccountInfo).mockResolvedValue({ value: null });
    vi.mocked(normalizeAccountProbe).mockReturnValue(null);

    const result = await resolveSplMultisigReference(ADDRESS, CLUSTER);
    expect(result).toEqual({ status: "not_multisig" });
  });

  it("returns not_multisig when parsedProgram is not spl-token", async () => {
    vi.mocked(fetchAccountInfo).mockResolvedValue({ value: null } as never);
    vi.mocked(normalizeAccountProbe).mockReturnValue({
      ...makeNormalizedSplMultisig("spl-token", {}),
      parsedProgram: "bpf-upgradeable-loader",
    });

    const result = await resolveSplMultisigReference(ADDRESS, CLUSTER);
    expect(result).toEqual({ status: "not_multisig" });
  });

  it("returns not_multisig when parsed type is not multisig", async () => {
    vi.mocked(fetchAccountInfo).mockResolvedValue({ value: null } as never);
    vi.mocked(normalizeAccountProbe).mockReturnValue({
      ...makeNormalizedSplMultisig("spl-token", {}),
      parsedData: { type: "mint", info: {} },
    });

    const result = await resolveSplMultisigReference(ADDRESS, CLUSTER);
    expect(result).toEqual({ status: "not_multisig" });
  });
});

// ── Successful detection ─────────────────────────────────────────────────────

describe("resolveSplMultisigReference — detection", () => {
  it("returns full spl-token multisig details", async () => {
    const signers = [
      "Signer1111111111111111111111111111111111111",
      "Signer2222222222222222222222222222222222222",
      "Signer3333333333333333333333333333333333333",
    ];
    vi.mocked(fetchAccountInfo).mockResolvedValue({ value: null } as never);
    vi.mocked(normalizeAccountProbe).mockReturnValue(
      makeNormalizedSplMultisig("spl-token", {
        isInitialized: true,
        numRequiredSigners: 2,
        numValidSigners: 3,
        signers,
      }),
    );

    const result = await resolveSplMultisigReference(ADDRESS, CLUSTER);
    expect(result).toEqual({
      status: "is_multisig",
      version: "spl-token",
      multisig_address: ADDRESS,
      threshold: 2,
      members: signers,
    });
  });

  it("returns full spl-token-2022 multisig details", async () => {
    const signers = ["Mem111", "Mem222"];
    vi.mocked(fetchAccountInfo).mockResolvedValue({ value: null } as never);
    vi.mocked(normalizeAccountProbe).mockReturnValue(
      makeNormalizedSplMultisig("spl-token-2022", {
        isInitialized: true,
        numRequiredSigners: 1,
        numValidSigners: 2,
        signers,
      }),
    );

    const result = await resolveSplMultisigReference(ADDRESS, CLUSTER);
    expect(result).toEqual({
      status: "is_multisig",
      version: "spl-token-2022",
      multisig_address: ADDRESS,
      threshold: 1,
      members: signers,
    });
  });

  it("returns null threshold and members when parsedInfo fields are missing", async () => {
    vi.mocked(fetchAccountInfo).mockResolvedValue({ value: null } as never);
    vi.mocked(normalizeAccountProbe).mockReturnValue(makeNormalizedSplMultisig("spl-token", {}));

    const result = await resolveSplMultisigReference(ADDRESS, CLUSTER);
    expect(result).toEqual({
      status: "is_multisig",
      version: "spl-token",
      multisig_address: ADDRESS,
      threshold: null,
      members: null,
    });
  });

  it("returns empty members array when signers list is empty", async () => {
    vi.mocked(fetchAccountInfo).mockResolvedValue({ value: null } as never);
    vi.mocked(normalizeAccountProbe).mockReturnValue(
      makeNormalizedSplMultisig("spl-token", {
        isInitialized: true,
        numRequiredSigners: 0,
        numValidSigners: 0,
        signers: [],
      }),
    );

    const result = await resolveSplMultisigReference(ADDRESS, CLUSTER);
    expect(result).toEqual({
      status: "is_multisig",
      version: "spl-token",
      multisig_address: ADDRESS,
      threshold: 0,
      members: [],
    });
  });
});

// ── Error resilience ─────────────────────────────────────────────────────────

describe("resolveSplMultisigReference — error resilience", () => {
  it("returns unknown when fetchAccountInfo throws", async () => {
    vi.mocked(fetchAccountInfo).mockRejectedValue(new Error("RPC timeout"));

    const result = await resolveSplMultisigReference(ADDRESS, CLUSTER);
    expect(result).toEqual({
      status: "unknown",
      reason: "source_unavailable",
    });
  });
});
