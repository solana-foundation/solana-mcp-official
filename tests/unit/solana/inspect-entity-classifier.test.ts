import { describe, expect, it } from "vitest";

import {
  classifyAccountKindBase,
  decodeBase58,
  decodeIdentifierKind,
  extractTokenSubtype,
  promoteAccountKindWithDas,
} from "../../../lib/solana/inspect-entity-classifier";
import {
  ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS,
  FEATURE_PROGRAM_ID,
  NFTOKEN_ADDRESS,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ID,
} from "../../../lib/solana/constants";

const ACCOUNT_IDENTIFIER = "11111111111111111111111111111111";
const TRANSACTION_IDENTIFIER =
  "4ReKprwf3WdLHRrzp4ctPWNBsQDPL3VZz3zMmoZfcGJMJCHh5Vq937mPdyxhCbw54wNnA6hZ7KfNpQdpt13yY7A9";

describe("inspect-entity classifier", () => {
  it("decodes base58 identifiers and routes by deterministic byte length", () => {
    const accountBytes = decodeBase58(ACCOUNT_IDENTIFIER);
    const transactionBytes = decodeBase58(TRANSACTION_IDENTIFIER);

    expect(accountBytes?.length).toBe(32);
    expect(transactionBytes?.length).toBe(64);
    expect(decodeIdentifierKind(ACCOUNT_IDENTIFIER)).toBe("account");
    expect(decodeIdentifierKind(TRANSACTION_IDENTIFIER)).toBe("transaction");
    expect(decodeIdentifierKind("not@base58")).toBe("invalid");
    expect(decodeBase58("")).toBeNull();
    expect(decodeBase58("111")).toEqual(new Uint8Array([0, 0, 0]));
  });

  it("extracts token subtype deterministically", () => {
    expect(extractTokenSubtype({ type: "mint" })).toBe("mint");
    expect(extractTokenSubtype({ type: "account" })).toBe("account");
    expect(extractTokenSubtype({ type: "multisig" })).toBe("multisig");
    expect(extractTokenSubtype({ type: "other" })).toBeNull();
    expect(extractTokenSubtype("account")).toBeNull();
  });

  it("prioritizes nftoken owner check before token parser classification", () => {
    const kind = classifyAccountKindBase({
      owner: NFTOKEN_ADDRESS,
      parsedProgram: "spl-token",
      parsedData: { type: "account", info: {} },
      rawDataBytes: null,
    });

    expect(kind).toBe("nftoken");
  });

  it("supports address-lookup-table fallback from same-response raw bytes when owner matches", () => {
    const altRawBytes = new Uint8Array(56);
    const kind = classifyAccountKindBase({
      owner: ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS,
      parsedProgram: null,
      parsedData: null,
      rawDataBytes: altRawBytes,
    });

    const wrongSizeKind = classifyAccountKindBase({
      owner: ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS,
      parsedProgram: null,
      parsedData: null,
      rawDataBytes: new Uint8Array(57),
    });

    expect(kind).toBe("address-lookup-table");
    expect(wrongSizeKind).toBe("unknown");
  });

  it("rejects address-lookup-table heuristic when owner does not match", () => {
    const altRawBytes = new Uint8Array(56);
    const kind = classifyAccountKindBase({
      owner: "SomeOtherProgram",
      parsedProgram: null,
      parsedData: null,
      rawDataBytes: altRawBytes,
    });

    expect(kind).toBe("unknown");
  });

  it("covers deterministic classification branches across parsed programs and owners", () => {
    expect(
      classifyAccountKindBase({
        owner: "owner",
        parsedProgram: "spl-token",
        parsedData: { type: "mint", info: {} },
        rawDataBytes: null,
      }),
    ).toBe("spl-token:mint");

    expect(
      classifyAccountKindBase({
        owner: "owner",
        parsedProgram: "spl-token-2022",
        parsedData: { type: "account", info: {} },
        rawDataBytes: null,
      }),
    ).toBe("spl-token-2022:account");

    expect(
      classifyAccountKindBase({
        owner: "owner",
        parsedProgram: "nonce",
        parsedData: {},
        rawDataBytes: null,
      }),
    ).toBe("nonce");

    expect(
      classifyAccountKindBase({
        owner: "owner",
        parsedProgram: "vote",
        parsedData: {},
        rawDataBytes: null,
      }),
    ).toBe("vote");

    expect(
      classifyAccountKindBase({
        owner: "owner",
        parsedProgram: "sysvar",
        parsedData: {},
        rawDataBytes: null,
      }),
    ).toBe("sysvar");

    expect(
      classifyAccountKindBase({
        owner: "owner",
        parsedProgram: "config",
        parsedData: {},
        rawDataBytes: null,
      }),
    ).toBe("config");

    expect(
      classifyAccountKindBase({
        owner: FEATURE_PROGRAM_ID,
        parsedProgram: null,
        parsedData: {},
        rawDataBytes: null,
      }),
    ).toBe("feature");

    expect(
      classifyAccountKindBase({
        owner: SOLANA_ATTESTATION_SERVICE_PROGRAM_ID,
        parsedProgram: null,
        parsedData: {},
        rawDataBytes: null,
      }),
    ).toBe("solana-attestation-service");
  });

  it("promotes unknown account kind to compressed-nft from DAS outcome only", () => {
    expect(
      promoteAccountKindWithDas("unknown", {
        compressed: true,
      }),
    ).toBe("compressed-nft");
    expect(promoteAccountKindWithDas("stake", { compressed: true })).toBe("stake");
    expect(promoteAccountKindWithDas("unknown", null)).toBe("unknown");
  });
});
