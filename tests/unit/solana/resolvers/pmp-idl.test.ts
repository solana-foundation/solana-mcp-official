import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@solana/kit", () => ({
  address: vi.fn((addr: string) => addr),
  createSolanaRpc: vi.fn().mockReturnValue({}),
}));

vi.mock("@solana-program/program-metadata", () => ({
  fetchMaybeMetadataFromSeeds: vi.fn().mockResolvedValue({ exists: false }),
  unpackAndFetchData: vi.fn().mockResolvedValue("{}"),
}));

vi.mock("../../../../lib/solana/rpc", () => ({
  resolveRpcEndpoint: vi.fn().mockReturnValue("https://api.mainnet-beta.solana.com"),
}));

vi.mock("../../../../lib/solana/constants", () => ({
  RPC_REQUEST_TIMEOUT_MS: 10,
}));

import { fetchMaybeMetadataFromSeeds, unpackAndFetchData } from "@solana-program/program-metadata";

import { fetchPmpIdlMetadata } from "../../../../lib/solana/resolvers/pmp-idl";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchPmpIdlMetadata", () => {
  it("returns null when metadata account does not exist", async () => {
    vi.mocked(fetchMaybeMetadataFromSeeds).mockResolvedValue({
      exists: false,
    } as never);

    const result = await fetchPmpIdlMetadata("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "mainnet-beta");

    expect(result).toBeNull();
    expect(fetchMaybeMetadataFromSeeds).toHaveBeenCalledOnce();
  });

  it("returns unpacked content when metadata account exists", async () => {
    const idlJson = JSON.stringify({
      name: "test_program",
      instructions: [],
    });
    vi.mocked(fetchMaybeMetadataFromSeeds).mockResolvedValue({
      exists: true,
      data: {
        compression: 0,
        encoding: 0,
        dataSource: 0,
        data: new Uint8Array(),
      },
    } as never);
    vi.mocked(unpackAndFetchData).mockResolvedValue(idlJson);

    const result = await fetchPmpIdlMetadata("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "mainnet-beta");

    expect(result).toBe(idlJson);
    expect(unpackAndFetchData).toHaveBeenCalledOnce();
  });

  it("throws when fetchMaybeMetadataFromSeeds fails", async () => {
    vi.mocked(fetchMaybeMetadataFromSeeds).mockRejectedValue(new Error("RPC timeout"));

    await expect(fetchPmpIdlMetadata("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "mainnet-beta")).rejects.toThrow(
      "RPC timeout",
    );
  });

  it("throws when unpackAndFetchData fails", async () => {
    vi.mocked(fetchMaybeMetadataFromSeeds).mockResolvedValue({
      exists: true,
      data: {
        compression: 0,
        encoding: 0,
        dataSource: 0,
        data: new Uint8Array(),
      },
    } as never);
    vi.mocked(unpackAndFetchData).mockRejectedValue(new Error("decompression failed"));

    await expect(fetchPmpIdlMetadata("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "mainnet-beta")).rejects.toThrow(
      "decompression failed",
    );
  });

  describe("timeout behavior", () => {
    it("passes AbortSignal to fetchMaybeMetadataFromSeeds", async () => {
      vi.mocked(fetchMaybeMetadataFromSeeds).mockResolvedValue({
        exists: false,
      } as never);

      await fetchPmpIdlMetadata("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "mainnet-beta");

      expect(fetchMaybeMetadataFromSeeds).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          abortSignal: expect.any(AbortSignal),
        }),
      );
    });

    it("rejects when data unpack exceeds timeout", async () => {
      vi.mocked(fetchMaybeMetadataFromSeeds).mockResolvedValue({
        exists: true,
        data: {
          compression: 0,
          encoding: 0,
          dataSource: 0,
          data: new Uint8Array(),
        },
      } as never);
      vi.mocked(unpackAndFetchData).mockReturnValue(new Promise(() => {}) as never);

      await expect(fetchPmpIdlMetadata("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "mainnet-beta")).rejects.toThrow(
        "PMP unpack timed out",
      );
    });
  });
});
