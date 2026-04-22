import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/solana/resolvers/squads-multisig", () => ({
  resolveMultisigReference: vi.fn(),
}));

vi.mock("../../../../lib/solana/resolvers/spl-multisig", () => ({
  resolveSplMultisigReference: vi.fn(),
}));

import { resolveMultisigReference } from "../../../../lib/solana/resolvers/multisig";
import { resolveMultisigReference as resolveSquadsMultisig } from "../../../../lib/solana/resolvers/squads-multisig";
import { resolveSplMultisigReference } from "../../../../lib/solana/resolvers/spl-multisig";

const AUTHORITY = "AeLnXCBPaQHGWRLr2saFsEVfnMNuKixRAbWCT9P5twgZ";
const MAINNET = "mainnet-beta" as const;
const DEVNET = "devnet" as const;

describe("resolveMultisigReference — composite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns Squads result when Squads finds a match", async () => {
    const squadsHit = {
      status: "is_multisig" as const,
      version: "v4" as const,
      multisig_address: "Msig111",
      threshold: 2,
      members: ["M1", "M2"],
    };
    vi.mocked(resolveSquadsMultisig).mockResolvedValue(squadsHit);

    const result = await resolveMultisigReference(AUTHORITY, MAINNET);
    expect(result).toEqual(squadsHit);
    expect(resolveSplMultisigReference).not.toHaveBeenCalled();
  });

  it("falls back to SPL when Squads returns not_multisig", async () => {
    vi.mocked(resolveSquadsMultisig).mockResolvedValue({
      status: "not_multisig",
    });
    const splHit = {
      status: "is_multisig" as const,
      version: "spl-token" as const,
      multisig_address: AUTHORITY,
      threshold: 2,
      members: ["S1", "S2"],
    };
    vi.mocked(resolveSplMultisigReference).mockResolvedValue(splHit);

    const result = await resolveMultisigReference(AUTHORITY, MAINNET);
    expect(result).toEqual(splHit);
    expect(resolveSplMultisigReference).toHaveBeenCalledWith(AUTHORITY, MAINNET);
  });

  it("falls back to SPL when Squads returns unknown (non-mainnet)", async () => {
    vi.mocked(resolveSquadsMultisig).mockResolvedValue({
      status: "unknown",
      reason: "source_unavailable",
    });
    const splHit = {
      status: "is_multisig" as const,
      version: "spl-token-2022" as const,
      multisig_address: AUTHORITY,
      threshold: 1,
      members: ["S1"],
    };
    vi.mocked(resolveSplMultisigReference).mockResolvedValue(splHit);

    const result = await resolveMultisigReference(AUTHORITY, DEVNET);
    expect(result).toEqual(splHit);
  });

  it("does not call SPL when authority is null", async () => {
    vi.mocked(resolveSquadsMultisig).mockResolvedValue({
      status: "not_multisig",
    });

    const result = await resolveMultisigReference(null, MAINNET);
    expect(result).toEqual({ status: "not_multisig" });
    expect(resolveSplMultisigReference).not.toHaveBeenCalled();
  });

  it("returns Squads unknown on mainnet without calling SPL", async () => {
    vi.mocked(resolveSquadsMultisig).mockResolvedValue({
      status: "unknown",
      reason: "source_unavailable",
    });

    const result = await resolveMultisigReference(AUTHORITY, MAINNET);
    expect(result).toEqual({ status: "unknown", reason: "source_unavailable" });
    expect(resolveSplMultisigReference).not.toHaveBeenCalled();
  });

  it("returns SPL not_multisig when neither resolver finds a match", async () => {
    vi.mocked(resolveSquadsMultisig).mockResolvedValue({
      status: "not_multisig",
    });
    vi.mocked(resolveSplMultisigReference).mockResolvedValue({
      status: "not_multisig",
    });

    const result = await resolveMultisigReference(AUTHORITY, MAINNET);
    expect(result).toEqual({ status: "not_multisig" });
  });
});
