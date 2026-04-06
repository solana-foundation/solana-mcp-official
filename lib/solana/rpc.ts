import { createSolanaRpc } from "@solana/kit";

import { serviceConfig, type SolanaRpcRuntimeConfig } from "../config";
import {
  DAS_REQUEST_TIMEOUT_MS,
  DEVNET_RPC_ENDPOINT,
  MAINNET_BETA_RPC_ENDPOINT,
  RPC_REQUEST_TIMEOUT_MS,
  SIMD296_RPC_ENDPOINT,
  TESTNET_RPC_ENDPOINT,
  type SupportedCluster,
} from "./constants";
import type {
  AccountProbeEnvelope,
  SignatureStatusEnvelope,
  SignatureStatusValue,
  TransactionProbeEnvelope,
} from "./types";

export class SourceUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SourceUnavailableError";
  }
}

export function isSourceUnavailableError(error: unknown): error is SourceUnavailableError {
  return error instanceof SourceUnavailableError;
}

function toSourceUnavailableError(error: unknown): SourceUnavailableError {
  if (error instanceof SourceUnavailableError) {
    return error;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new SourceUnavailableError(`Upstream source is unavailable: ${detail}`, { cause: error });
}

export function resolveRpcEndpoint(
  cluster: SupportedCluster,
  config: SolanaRpcRuntimeConfig = serviceConfig.solanaRpc,
): string {
  if (cluster === "mainnet-beta") {
    return config.mainnetBetaUrl ?? MAINNET_BETA_RPC_ENDPOINT;
  }
  if (cluster === "devnet") {
    return config.devnetUrl ?? DEVNET_RPC_ENDPOINT;
  }
  if (cluster === "testnet") {
    return config.testnetUrl ?? TESTNET_RPC_ENDPOINT;
  }
  if (cluster === "simd296") {
    return config.simd296Url ?? SIMD296_RPC_ENDPOINT;
  }
  const _exhaustive: never = cluster;
  throw new SourceUnavailableError(`No RPC endpoint is configured for cluster: ${_exhaustive as string}`);
}

type RpcRequest<TValue> = {
  send: (options?: { abortSignal?: AbortSignal }) => Promise<TValue>;
};

async function sendWithTimeout<TValue>(request: RpcRequest<TValue>, timeoutMs: number): Promise<TValue> {
  return await request.send({ abortSignal: AbortSignal.timeout(timeoutMs) });
}

type AccountInfoRequestOptions = {
  commitment?: "finalized" | "confirmed";
  encoding?: "jsonParsed" | "json" | "base64";
};

type TransactionRequestOptions = {
  commitment?: "finalized" | "confirmed";
  encoding?: "json" | "jsonParsed" | "base64" | "base58";
  maxSupportedTransactionVersion?: number;
};

export async function fetchAccountInfo(
  address: string,
  cluster: SupportedCluster,
  options?: AccountInfoRequestOptions,
): Promise<AccountProbeEnvelope> {
  const endpoint = resolveRpcEndpoint(cluster);
  const rpc = createSolanaRpc(endpoint) as {
    getAccountInfo: (inputAddress: unknown, config: AccountInfoRequestOptions) => RpcRequest<AccountProbeEnvelope>;
  };

  try {
    const request = rpc.getAccountInfo(address, {
      commitment: options?.commitment ?? "finalized",
      encoding: options?.encoding ?? "jsonParsed",
    });
    return await sendWithTimeout(request, RPC_REQUEST_TIMEOUT_MS);
  } catch (error) {
    throw toSourceUnavailableError(error);
  }
}

export async function fetchTransaction(
  signature: string,
  cluster: SupportedCluster,
  options?: TransactionRequestOptions,
): Promise<TransactionProbeEnvelope> {
  const endpoint = resolveRpcEndpoint(cluster);
  const rpc = createSolanaRpc(endpoint) as {
    getTransaction: (
      inputSignature: unknown,
      config: TransactionRequestOptions,
    ) => RpcRequest<TransactionProbeEnvelope>;
  };

  try {
    const request = rpc.getTransaction(signature, {
      commitment: options?.commitment ?? "finalized",
      encoding: options?.encoding ?? "json",
      maxSupportedTransactionVersion: options?.maxSupportedTransactionVersion ?? 0,
    });
    return await sendWithTimeout(request, RPC_REQUEST_TIMEOUT_MS);
  } catch (error) {
    throw toSourceUnavailableError(error);
  }
}

type SignatureStatusRpcResponse = {
  value: readonly (SignatureStatusValue | null)[];
};

export async function fetchSignatureStatus(
  signature: string,
  cluster: SupportedCluster,
): Promise<SignatureStatusEnvelope> {
  const endpoint = resolveRpcEndpoint(cluster);
  const rpc = createSolanaRpc(endpoint) as {
    getSignatureStatuses: (
      signatures: readonly unknown[],
      config: { searchTransactionHistory: boolean },
    ) => RpcRequest<SignatureStatusRpcResponse>;
  };

  try {
    const request = rpc.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const result = await sendWithTimeout(request, RPC_REQUEST_TIMEOUT_MS);
    if (result.value.length === 0) {
      throw new SourceUnavailableError("getSignatureStatuses returned empty array (expected 1 element).");
    }
    return { value: result.value[0] ?? null };
  } catch (error) {
    throw toSourceUnavailableError(error);
  }
}

export async function fetchAsset(address: string, cluster: SupportedCluster): Promise<unknown> {
  const endpoint = resolveRpcEndpoint(cluster);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAsset",
        params: {
          id: address,
        },
      }),
      signal: AbortSignal.timeout(DAS_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new SourceUnavailableError("DAS endpoint is unavailable.");
    }

    const payload = (await response.json()) as {
      result?: unknown;
      error?: unknown;
    };

    if (payload.error !== undefined) {
      throw new SourceUnavailableError("DAS method is unavailable.");
    }

    return payload.result;
  } catch (error) {
    throw toSourceUnavailableError(error);
  }
}
