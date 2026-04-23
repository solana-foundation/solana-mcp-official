import type { SupportedCluster } from "../constants";
import type { MetaplexMetadataResult } from "./metaplex-normalize";
import { fetchRawMetaplexMetadata } from "./metaplex-umi";
import { normalizeMetadata } from "./metaplex-normalize";
import { logger } from "../../observability/logger";

export type {
  MetaplexTokenStandard,
  MetaplexCreator,
  MetaplexCollection,
  MetaplexMetadataFound,
  MetaplexMetadataResult,
} from "./metaplex-normalize";

export async function resolveMetaplexMetadata(
  mintAddress: string,
  cluster: SupportedCluster,
): Promise<MetaplexMetadataResult> {
  try {
    const metadata = await fetchRawMetaplexMetadata(mintAddress, cluster);
    return normalizeMetadata(metadata);
  } catch (error) {
    // UMI throws when the account doesn't exist (e.g., fungible tokens without metadata)
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("could not find account") ||
      message.includes("Account does not exist") ||
      message.includes("The account of type")
    ) {
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
