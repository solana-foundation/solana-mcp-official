import { type Metadata, TokenStandard } from "@metaplex-foundation/mpl-token-metadata";

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

const TOKEN_STANDARD_LABELS: Record<number, MetaplexTokenStandard> = {
  [TokenStandard.NonFungible]: "NonFungible",
  [TokenStandard.FungibleAsset]: "FungibleAsset",
  [TokenStandard.Fungible]: "Fungible",
  [TokenStandard.NonFungibleEdition]: "NonFungibleEdition",
  [TokenStandard.ProgrammableNonFungible]: "ProgrammableNonFungible",
  [TokenStandard.ProgrammableNonFungibleEdition]: "ProgrammableNonFungibleEdition",
};

function isSome<T>(
  option: { __option: "Some"; value: T } | { __option: "None" },
): option is { __option: "Some"; value: T } {
  return option.__option === "Some";
}

export function normalizeMetadata(metadata: Metadata): MetaplexMetadataFound {
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
