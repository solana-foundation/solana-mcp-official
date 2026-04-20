import type { AccountPayloadContext, AccountEntityKind, MetaplexMetadataResult, NormalizedAccountInfo } from "../types";
import { asBoolean, asSafeNumeric, asRecord, asString } from "../parse-helpers";

export type AccountKindBuilder = (context: AccountPayloadContext) => Record<string, unknown>;

export function assertUnreachable(kind: never): never {
  throw new Error(`Unhandled account entity kind: ${String(kind)}`);
}

export function unknownMarker(reason: string): {
  value: null;
  status: "unknown";
  reason: string;
} {
  return {
    value: null,
    status: "unknown",
    reason,
  };
}

// FIXME(@rogaldh): sparse keys (omit vs null) — callers cannot distinguish "field absent" from "not set".
export function buildTokenEntityFields(
  kind: AccountEntityKind,
  account: NormalizedAccountInfo,
): Record<string, string> {
  const entityFields: Record<string, string> = {};
  const parsedInfo = asRecord(asRecord(account.parsedData)?.info);
  const mint = asString(parsedInfo?.mint);
  const owner = asString(parsedInfo?.owner);

  if (mint) {
    entityFields.mint = mint;
  }
  if (owner) {
    entityFields.owner = owner;
  }
  if (kind.startsWith("spl-token")) {
    entityFields.token_program = account.owner ?? "";
  }
  if (!entityFields.token_program) {
    delete entityFields.token_program;
  }

  return entityFields;
}

export function buildKindOnlyPayload(context: AccountPayloadContext): Record<string, unknown> {
  return {
    entity: {
      kind: context.kind,
    },
  };
}

export function buildMintOverviewFields(account: NormalizedAccountInfo): Record<string, unknown> {
  const parsedInfo = asRecord(asRecord(account.parsedData)?.info);

  const supply = asString(parsedInfo?.supply);
  const decimals = asSafeNumeric(parsedInfo?.decimals);
  const isInitialized = asBoolean(parsedInfo?.isInitialized);
  const mintAuthority = asString(parsedInfo?.mintAuthority);
  const freezeAuthority = asString(parsedInfo?.freezeAuthority);

  // Solana RPC always includes mintAuthority for initialized mints:
  // null = authority revoked (fixed supply), string = authority present (variable supply).
  // Guard: only derive supplyType when mintAuthority was explicitly present in parsed data.
  let supplyType: string | null = null;
  if (isInitialized === true && parsedInfo !== null && "mintAuthority" in parsedInfo) {
    supplyType = mintAuthority === null ? "fixed" : "variable";
  }

  const fields: Record<string, unknown> = {
    address: account.address ?? null,
    token_program: account.owner ?? null,
    supply,
    decimals,
    is_initialized: isInitialized,
    mint_authority: mintAuthority,
    freeze_authority: freezeAuthority,
    supply_type: supplyType,
  };

  if (!fields.token_program) {
    delete fields.token_program;
  }

  return fields;
}

export function buildMetaplexMetadataField(
  result: MetaplexMetadataResult | undefined,
): Record<string, unknown> | null {
  if (!result || result.status === "not_found") {
    return null;
  }
  if (result.status === "unknown") {
    return unknownMarker(result.reason);
  }
  return {
    name: result.name,
    symbol: result.symbol,
    uri: result.uri,
    seller_fee_basis_points: result.seller_fee_basis_points,
    creators: result.creators,
    token_standard: result.token_standard,
    collection: result.collection,
    is_collection: result.is_collection,
    primary_sale_happened: result.primary_sale_happened,
    is_mutable: result.is_mutable,
  };
}

export function buildSplMultisigFields(account: NormalizedAccountInfo): Record<string, unknown> {
  const parsedInfo = asRecord(asRecord(account.parsedData)?.info);
  const rawSigners = parsedInfo?.signers;
  const signers = Array.isArray(rawSigners)
    ? (rawSigners as unknown[]).flatMap(s => {
        const v = asString(s);
        return v ? [v] : [];
      })
    : null;
  return {
    is_initialized: asBoolean(parsedInfo?.isInitialized),
    num_required_signers: asSafeNumeric(parsedInfo?.numRequiredSigners),
    num_valid_signers: asSafeNumeric(parsedInfo?.numValidSigners),
    signers,
  };
}
