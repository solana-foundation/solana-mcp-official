import { describe, expect, it } from "vitest";

import { buildMetaplexMetadataField } from "../../../lib/solana/account-kinds/shared";
import type { MetaplexMetadataResult } from "../../../lib/solana/types";

describe("buildMetaplexMetadataField", () => {
  it("returns null when result is undefined", () => {
    expect(buildMetaplexMetadataField(undefined)).toBeNull();
  });

  it("returns null when result is not_found", () => {
    expect(buildMetaplexMetadataField({ status: "not_found" })).toBeNull();
  });

  it("returns unknown marker when result is source_unavailable", () => {
    expect(buildMetaplexMetadataField({ status: "unknown", reason: "source_unavailable" })).toEqual({
      value: null,
      status: "unknown",
      reason: "source_unavailable",
    });
  });

  it("maps found result to structured metadata fields", () => {
    const found: MetaplexMetadataResult = {
      status: "found",
      name: "My NFT",
      symbol: "MNFT",
      uri: "https://example.com/nft.json",
      seller_fee_basis_points: 500,
      creators: [{ address: "Creator111", verified: true, share: 100 }],
      token_standard: "NonFungible",
      collection: { verified: true, key: "Collection111" },
      is_collection: false,
      primary_sale_happened: true,
      is_mutable: true,
    };

    const result = buildMetaplexMetadataField(found);

    expect(result).toEqual({
      name: "My NFT",
      symbol: "MNFT",
      uri: "https://example.com/nft.json",
      seller_fee_basis_points: 500,
      creators: [{ address: "Creator111", verified: true, share: 100 }],
      token_standard: "NonFungible",
      collection: { verified: true, key: "Collection111" },
      is_collection: false,
      primary_sale_happened: true,
      is_mutable: true,
    });
  });

  it("handles found result with null optional fields", () => {
    const found: MetaplexMetadataResult = {
      status: "found",
      name: "Fungible Token",
      symbol: "FT",
      uri: "https://example.com/ft.json",
      seller_fee_basis_points: 0,
      creators: null,
      token_standard: "Fungible",
      collection: null,
      is_collection: false,
      primary_sale_happened: false,
      is_mutable: true,
    };

    const result = buildMetaplexMetadataField(found);

    expect(result).toMatchObject({
      name: "Fungible Token",
      token_standard: "Fungible",
      creators: null,
      collection: null,
    });
  });
});
