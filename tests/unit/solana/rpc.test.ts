import { beforeEach, describe, expect, it, vi } from "vitest";

const getAccountInfoMock = vi.fn();
const getTransactionMock = vi.fn();
const getSignatureStatusesMock = vi.fn();

vi.mock("@solana/kit", () => ({
  createSolanaRpc: vi.fn(() => ({
    getAccountInfo: getAccountInfoMock,
    getTransaction: getTransactionMock,
    getSignatureStatuses: getSignatureStatusesMock,
  })),
}));

import { createSolanaRpc } from "@solana/kit";

import {
  fetchAccountInfo,
  fetchAsset,
  fetchSignatureStatus,
  fetchTransaction,
  resolveRpcEndpoint,
  SourceUnavailableError,
} from "../../../lib/solana/rpc";
import {
  DEVNET_RPC_ENDPOINT,
  MAINNET_BETA_RPC_ENDPOINT,
  RPC_REQUEST_TIMEOUT_MS,
  SIMD296_RPC_ENDPOINT,
  TESTNET_RPC_ENDPOINT,
} from "../../../lib/solana/constants";

const createSolanaRpcMock = vi.mocked(createSolanaRpc);

describe("solana rpc adapter", () => {
  beforeEach(() => {
    createSolanaRpcMock.mockClear();
    getAccountInfoMock.mockReset();
    getTransactionMock.mockReset();
    getSignatureStatusesMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("resolves deterministic endpoints", () => {
    expect(
      resolveRpcEndpoint("mainnet-beta", {
        mainnetBetaUrl: "https://custom-mainnet",
        devnetUrl: undefined,
        testnetUrl: undefined,
        simd296Url: undefined,
      }),
    ).toBe("https://custom-mainnet");

    expect(
      resolveRpcEndpoint("mainnet-beta", {
        mainnetBetaUrl: undefined,
        devnetUrl: undefined,
        testnetUrl: undefined,
        simd296Url: undefined,
      }),
    ).toBe(MAINNET_BETA_RPC_ENDPOINT);

    expect(
      resolveRpcEndpoint("devnet", {
        mainnetBetaUrl: undefined,
        devnetUrl: undefined,
        testnetUrl: undefined,
        simd296Url: undefined,
      }),
    ).toBe(DEVNET_RPC_ENDPOINT);

    expect(
      resolveRpcEndpoint("testnet", {
        mainnetBetaUrl: undefined,
        devnetUrl: undefined,
        testnetUrl: undefined,
        simd296Url: undefined,
      }),
    ).toBe(TESTNET_RPC_ENDPOINT);

    expect(
      resolveRpcEndpoint("simd296", {
        mainnetBetaUrl: undefined,
        devnetUrl: undefined,
        testnetUrl: undefined,
        simd296Url: undefined,
      }),
    ).toBe(SIMD296_RPC_ENDPOINT);
  });

  it("fetches account info with deterministic defaults", async () => {
    const sendMock = vi.fn().mockResolvedValue({
      value: null,
    });
    getAccountInfoMock.mockReturnValue({
      send: sendMock,
    });

    const result = await fetchAccountInfo("address", "devnet");

    expect(result).toEqual({ value: null });
    expect(createSolanaRpcMock).toHaveBeenCalledWith(expect.any(String));
    expect(getAccountInfoMock).toHaveBeenCalledWith("address", {
      commitment: "finalized",
      encoding: "jsonParsed",
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: expect.any(Object),
      }),
    );
  });

  it("maps send TypeError failures to SourceUnavailableError without retry", async () => {
    const sendMock = vi.fn().mockRejectedValue(new TypeError("unexpected argument"));
    getAccountInfoMock.mockReturnValue({
      send: sendMock,
    });

    await expect(fetchAccountInfo("address", "devnet")).rejects.toBeInstanceOf(SourceUnavailableError);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("maps timeout-style abort failures to SourceUnavailableError", async () => {
    const timeoutSignal = AbortSignal.abort("timeout");
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal);
    const sendMock = vi.fn().mockImplementation(() => {
      const timeoutError = new Error("The operation timed out.");
      timeoutError.name = "TimeoutError";
      return Promise.reject(timeoutError);
    });
    getAccountInfoMock.mockReturnValue({
      send: sendMock,
    });

    await expect(fetchAccountInfo("address", "devnet")).rejects.toBeInstanceOf(SourceUnavailableError);
    expect(timeoutSpy).toHaveBeenCalledWith(RPC_REQUEST_TIMEOUT_MS);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      abortSignal: timeoutSignal,
    });
  });

  it("fetches transaction preview with maxSupportedTransactionVersion = 0", async () => {
    const sendMock = vi.fn().mockResolvedValue({
      slot: 1,
    });
    getTransactionMock.mockReturnValue({
      send: sendMock,
    });

    const result = await fetchTransaction("signature", "mainnet-beta");

    expect(result).toEqual({ slot: 1 });
    expect(getTransactionMock).toHaveBeenCalledWith("signature", {
      commitment: "finalized",
      encoding: "json",
      maxSupportedTransactionVersion: 0,
    });
  });

  it("maps RPC transport failures to SourceUnavailableError with cause chain", async () => {
    const originalError = new Error("socket hang up");
    getAccountInfoMock.mockReturnValue({
      send: vi.fn().mockRejectedValue(originalError),
    });

    const wrapped = await fetchAccountInfo("address", "mainnet-beta").catch((e: unknown) => e);
    expect(wrapped).toBeInstanceOf(SourceUnavailableError);
    expect((wrapped as SourceUnavailableError).message).toContain("socket hang up");
    expect((wrapped as SourceUnavailableError).cause).toBe(originalError);
  });

  it("maps transaction transport failures to SourceUnavailableError", async () => {
    getTransactionMock.mockReturnValue({
      send: vi.fn().mockRejectedValue(new Error("socket hang up")),
    });

    await expect(fetchTransaction("signature", "mainnet-beta")).rejects.toBeInstanceOf(SourceUnavailableError);
  });

  it("fetches DAS getAsset through the direct JSON-RPC exception path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: { id: "asset-id" } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAsset("asset-id", "devnet");

    expect(result).toEqual({ id: "asset-id" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("maps DAS endpoint errors to SourceUnavailableError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: -32601 } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAsset("asset-id", "devnet")).rejects.toBeInstanceOf(SourceUnavailableError);
  });

  it("maps non-OK DAS HTTP responses to SourceUnavailableError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("unavailable", {
        status: 503,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAsset("asset-id", "devnet")).rejects.toBeInstanceOf(SourceUnavailableError);
  });

  it("fetches signature status with searchTransactionHistory", async () => {
    const sendMock = vi.fn().mockResolvedValue({
      value: [{ confirmationStatus: "finalized", confirmations: null }],
    });
    getSignatureStatusesMock.mockReturnValue({ send: sendMock });

    const result = await fetchSignatureStatus("signature", "mainnet-beta");

    expect(result).toEqual({
      value: { confirmationStatus: "finalized", confirmations: null },
    });
    expect(getSignatureStatusesMock).toHaveBeenCalledWith(["signature"], {
      searchTransactionHistory: true,
    });
  });

  it("maps signature status transport failures to SourceUnavailableError", async () => {
    getSignatureStatusesMock.mockReturnValue({
      send: vi.fn().mockRejectedValue(new Error("socket hang up")),
    });

    await expect(fetchSignatureStatus("signature", "mainnet-beta")).rejects.toBeInstanceOf(SourceUnavailableError);
  });

  it("returns null value when signature not found in status array", async () => {
    const sendMock = vi.fn().mockResolvedValue({ value: [null] });
    getSignatureStatusesMock.mockReturnValue({ send: sendMock });

    const result = await fetchSignatureStatus("signature", "mainnet-beta");
    expect(result).toEqual({ value: null });
  });

  it("throws SourceUnavailableError on empty status array", async () => {
    const sendMock = vi.fn().mockResolvedValue({ value: [] });
    getSignatureStatusesMock.mockReturnValue({ send: sendMock });

    await expect(fetchSignatureStatus("signature", "mainnet-beta")).rejects.toBeInstanceOf(SourceUnavailableError);
  });
});
