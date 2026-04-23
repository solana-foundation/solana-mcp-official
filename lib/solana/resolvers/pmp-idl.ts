import { address, createSolanaRpc } from "@solana/kit";
import { fetchMaybeMetadataFromSeeds, unpackAndFetchData } from "@solana-program/program-metadata";

import { resolveRpcEndpoint } from "../rpc";
import { RPC_REQUEST_TIMEOUT_MS, type SupportedCluster } from "../constants";
import { raceWithTimeout } from "../timeout";

const PMP_IDL_SEED = "idl";

export async function fetchPmpIdlMetadata(programAddress: string, cluster: SupportedCluster): Promise<string | null> {
  const endpoint = resolveRpcEndpoint(cluster);
  const rpc = createSolanaRpc(endpoint);

  const maybeMetadata = await fetchMaybeMetadataFromSeeds(
    rpc,
    {
      authority: null,
      program: address(programAddress),
      seed: PMP_IDL_SEED,
    },
    { abortSignal: AbortSignal.timeout(RPC_REQUEST_TIMEOUT_MS) },
  );

  if (!maybeMetadata.exists) return null;

  return await raceWithTimeout(
    unpackAndFetchData({
      rpc,
      ...maybeMetadata.data,
    }),
    RPC_REQUEST_TIMEOUT_MS,
    "PMP unpack",
  );
}
