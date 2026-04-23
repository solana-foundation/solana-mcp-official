import {
  fetchMetadata,
  findMetadataPda,
  mplTokenMetadata,
  type Metadata,
} from "@metaplex-foundation/mpl-token-metadata";
import { publicKey, type Umi } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

import { resolveRpcEndpoint } from "../rpc";
import { METAPLEX_METADATA_TIMEOUT_MS, type SupportedCluster } from "../constants";
import { raceWithTimeout } from "../timeout";

// Per-endpoint UMI cache (same pattern as solana-explorer)
const umiCache = new Map<string, Umi>();

function getUmi(rpcEndpoint: string): Umi {
  let umi = umiCache.get(rpcEndpoint);
  if (!umi) {
    umi = createUmi(rpcEndpoint).use(mplTokenMetadata());
    umiCache.set(rpcEndpoint, umi);
  }
  return umi;
}

export async function fetchRawMetaplexMetadata(
  mintAddress: string,
  cluster: SupportedCluster,
): Promise<Metadata> {
  const endpoint = resolveRpcEndpoint(cluster);
  const umi = getUmi(endpoint);

  const mintKey = publicKey(mintAddress);
  const metadataPda = findMetadataPda(umi, { mint: mintKey });

  return raceWithTimeout(
    fetchMetadata(umi, metadataPda),
    METAPLEX_METADATA_TIMEOUT_MS,
    "Metaplex metadata fetch",
  );
}
