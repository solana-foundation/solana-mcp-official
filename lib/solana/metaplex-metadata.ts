import {
  fetchMetadata,
  findMetadataPda,
  mplTokenMetadata,
  type Metadata,
  TokenStandard,
} from "@metaplex-foundation/mpl-token-metadata";
import { AccountNotFoundError, publicKey, type Umi } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { raceWithTimeout } from "./timeout";
import { logger } from "../observability/logger";

const TOKEN_STANDARD_LABELS: Record<number, MetaplexTokenStandard> = {
  [TokenStandard.NonFungible]: "NonFungible",
  [TokenStandard.FungibleAsset]: "FungibleAsset",
  [TokenStandard.Fungible]: "Fungible",
  [TokenStandard.NonFungibleEdition]: "NonFungibleEdition",
  [TokenStandard.ProgrammableNonFungible]: "ProgrammableNonFungible",
  [TokenStandard.ProgrammableNonFungibleEdition]: "ProgrammableNonFungibleEdition",
};

export type MetaplexTokenStandard =
  | "NonFungible"
  | "FungibleAsset"
  | "Fungible"
  | "NonFungibleEdition"
  | "ProgrammableNonFungible"
  | "ProgrammableNonFungibleEdition";

export type MetaplexCreator = {
  address: string;
  verified: boolean;
  share: number;
};

export type MetaplexCollection = {
  verified: boolean;
  key: string;
};

export type MetaplexMetadataFound = {
  status: "found";
  name: string;
  symbol: string;
  uri: string;
  seller_fee_basis_points: number;
  creators: MetaplexCreator[] | null;
  token_standard: MetaplexTokenStandard | null;
  collection: MetaplexCollection | null;
  is_collection: boolean;
  primary_sale_happened: boolean;
  is_mutable: boolean;
};

export type MetaplexMetadataResult =
  | MetaplexMetadataFound
  | { status: "not_found" }
  | { status: "unknown"; reason: "source_unavailable" };

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

function isSome<T>(
  option: { __option: "Some"; value: T } | { __option: "None" },
): option is { __option: "Some"; value: T } {
  return option.__option === "Some";
}

function normalizeMetadata(metadata: Metadata): MetaplexMetadataFound {
  const tokenStandard = isSome(metadata.tokenStandard)
    ? (TOKEN_STANDARD_LABELS[metadata.tokenStandard.value] ?? null)
    : null;

  const collection = isSome(metadata.collection)
    ? { verified: metadata.collection.value.verified, key: metadata.collection.value.key.toString() }
    : null;

  const creators = isSome(metadata.creators)
    ? metadata.creators.value.map(c => ({
        address: c.address.toString(),
        verified: c.verified,
        share: c.share,
      }))
    : null;

  const isCollection = isSome(metadata.collectionDetails);

  return {
    status: "found",
    name: metadata.name.replace(/\0/g, "").trim(),
    symbol: metadata.symbol.replace(/\0/g, "").trim(),
    uri: metadata.uri.replace(/\0/g, "").trim(),
    seller_fee_basis_points: metadata.sellerFeeBasisPoints,
    creators,
    token_standard: tokenStandard,
    collection,
    is_collection: isCollection,
    primary_sale_happened: metadata.primarySaleHappened,
    is_mutable: metadata.isMutable,
  };
}

export async function resolveMetaplexMetadata(
  mintAddress: string,
  cluster: SupportedCluster,
): Promise<MetaplexMetadataResult> {
  const endpoint = resolveRpcEndpoint(cluster);
  const umi = getUmi(endpoint);

  try {
    const mintKey = publicKey(mintAddress);
    const metadataPda = findMetadataPda(umi, { mint: mintKey });

    const metadata = await raceWithTimeout(
      fetchMetadata(umi, metadataPda),
      METAPLEX_METADATA_TIMEOUT_MS,
      "Metaplex metadata fetch",
    );

    return normalizeMetadata(metadata);
  } catch (error) {
    if (error instanceof AccountNotFoundError) {
      return { status: "not_found" };
    }

    // Fallback: string match for UMI errors that don't use the typed class
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("could not find account") ||
      message.includes("Account does not exist") ||
      message.includes("The account of type")
    ) {
      logger.warn({ event: "metaplex_metadata.string_match_not_found", mintAddress, message });
      return { status: "not_found" };
    }

    logger.warn({
      event: "metaplex_metadata.resolve_failed",
      mintAddress,
      cluster,
      error,
    });
    return { status: "unknown", reason: "source_unavailable" };
  }
}
