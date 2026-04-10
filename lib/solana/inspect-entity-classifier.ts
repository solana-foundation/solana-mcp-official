import { getBase58Encoder } from "@solana/kit";

import {
  ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS,
  BPF_LOADER_PROGRAM_ID,
  BPF_LOADER_2_PROGRAM_ID,
  FEATURE_PROGRAM_ID,
  LOADER_V4_PROGRAM_ID,
  NFTOKEN_ADDRESS,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ID,
} from "./constants";
import type {
  BaseAccountEntityKind,
  DasClassificationOutcome,
  AccountEntityKind,
  IdentifierKind,
  NormalizedAccountInfo,
  TokenSubtype,
} from "./types";
import { asRecord, asString } from "./parse-helpers";
import { logger } from "../observability/logger";

const base58ToBytes = getBase58Encoder();

const ADDRESS_LOOKUP_TABLE_META_BYTES = 56;
const PUBKEY_BYTES = 32;

export function decodeBase58(value: string): Uint8Array | null {
  if (!value) {
    return null;
  }

  try {
    return new Uint8Array(base58ToBytes.encode(value));
  } catch (error) {
    logger.warn({ event: "classifier.base58_decode_failed", value, error });
    return null;
  }
}

export function decodeIdentifierKind(identifier: string): IdentifierKind {
  const decoded = decodeBase58(identifier);
  if (!decoded) {
    return "invalid";
  }
  if (decoded.length === 32) {
    return "account";
  }
  if (decoded.length === 64) {
    return "transaction";
  }
  return "invalid";
}

function hasAddressLookupTableLayout(rawDataBytes: Uint8Array | null): boolean {
  if (!rawDataBytes) {
    return false;
  }
  if (rawDataBytes.length < ADDRESS_LOOKUP_TABLE_META_BYTES) {
    return false;
  }
  const remainingBytes = rawDataBytes.length - ADDRESS_LOOKUP_TABLE_META_BYTES;
  return remainingBytes % PUBKEY_BYTES === 0;
}

export function extractTokenSubtype(parsedData: unknown): TokenSubtype | null {
  const parsedRecord = asRecord(parsedData);
  const subtype = asString(parsedRecord?.type);
  if (!subtype) {
    return null;
  }
  if (subtype === "mint" || subtype === "account" || subtype === "multisig") {
    return subtype;
  }
  return null;
}

export function classifyAccountKindBase(account: NormalizedAccountInfo): BaseAccountEntityKind {
  const parsedProgram = account.parsedProgram;

  if (parsedProgram === "bpf-upgradeable-loader") {
    return "bpf-upgradeable-loader";
  }
  if (account.owner === BPF_LOADER_PROGRAM_ID) {
    return "bpf-loader";
  }
  if (account.owner === BPF_LOADER_2_PROGRAM_ID) {
    return "bpf-loader-2";
  }
  if (account.owner === LOADER_V4_PROGRAM_ID) {
    return "loader-v4";
  }
  if (parsedProgram === "stake") {
    return "stake";
  }
  if (account.owner === NFTOKEN_ADDRESS) {
    return "nftoken";
  }

  const tokenSubtype = extractTokenSubtype(account.parsedData);
  if (parsedProgram === "spl-token" && tokenSubtype) {
    return `spl-token:${tokenSubtype}`;
  }
  if (parsedProgram === "spl-token-2022" && tokenSubtype) {
    return `spl-token-2022:${tokenSubtype}`;
  }

  if (parsedProgram === "nonce") {
    return "nonce";
  }
  if (parsedProgram === "vote") {
    return "vote";
  }
  if (parsedProgram === "sysvar") {
    return "sysvar";
  }
  if (parsedProgram === "config") {
    return "config";
  }
  if (
    parsedProgram === "address-lookup-table" ||
    (account.owner === ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS && hasAddressLookupTableLayout(account.rawDataBytes))
  ) {
    return "address-lookup-table";
  }
  if (account.owner === FEATURE_PROGRAM_ID) {
    return "feature";
  }
  if (account.owner === SOLANA_ATTESTATION_SERVICE_PROGRAM_ID) {
    return "solana-attestation-service";
  }

  return "unknown";
}

export function normalizeDasOutcome(value: unknown): DasClassificationOutcome | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const compression = asRecord(record.compression);
  const ownership = asRecord(record.ownership);
  const id = asString(record.id) ?? asString(record.assetId) ?? undefined;
  const owner = asString(ownership?.owner) ?? undefined;
  const tree = asString(compression?.tree) ?? undefined;

  const outcome: DasClassificationOutcome = {
    compressed: compression?.compressed === true,
  };
  if (id) {
    outcome.assetId = id;
  }
  if (owner) {
    outcome.owner = owner;
  }
  if (tree) {
    outcome.tree = tree;
  }

  return outcome;
}

export function promoteAccountKindWithDas(
  baseKind: BaseAccountEntityKind,
  dasOutcome: DasClassificationOutcome | null,
): AccountEntityKind {
  if (baseKind !== "unknown") {
    return baseKind;
  }
  if (dasOutcome?.compressed === true) {
    return "compressed-nft";
  }
  return "unknown";
}
