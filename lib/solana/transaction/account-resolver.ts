import type { AddressTableLookup, ResolvedAccount, TransactionVersion } from "../types";

type MessageHeader = {
  numRequiredSignatures: number;
  numReadonlySignedAccounts: number;
  numReadonlyUnsignedAccounts: number;
};

type LoadedAddresses = {
  readonly writable: readonly string[];
  readonly readonly: readonly string[];
};

type AccountResolutionParams = {
  staticKeys: string[];
  header: MessageHeader;
  loadedAddresses?: LoadedAddresses | null;
  addressTableLookups?: readonly AddressTableLookup[];
};

type AccountResolutionResult = {
  accountKeys: string[];
  resolvedAccounts: ResolvedAccount[];
};

type TransactionAccountResolver = (params: AccountResolutionParams) => AccountResolutionResult;

function classifyStaticKeys(staticKeys: string[], header: MessageHeader): ResolvedAccount[] {
  const { numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts } = header;
  const readonlySignerStart = numRequiredSignatures - numReadonlySignedAccounts;
  const readonlyUnsignedStart = staticKeys.length - numReadonlyUnsignedAccounts;

  return staticKeys.map((address, i) => {
    const signer = i < numRequiredSignatures;
    const readonlySigned = signer && i >= readonlySignerStart;
    const readonlyUnsigned = !signer && i >= readonlyUnsignedStart;
    const writable = !readonlySigned && !readonlyUnsigned;
    return { address, signer, writable, source: "static" as const };
  });
}

/**
 * Build a mapping from loaded address position to its source ALT account.
 *
 * `addressTableLookups` entries are ordered — their writable/readonly counts
 * correspond 1:1 with the flattened `loadedAddresses.writable` and
 * `loadedAddresses.readonly` arrays respectively.
 */
function buildLookupTableMap(addressTableLookups: readonly AddressTableLookup[] | undefined): {
  writableMap: string[];
  readonlyMap: string[];
} {
  const writableMap: string[] = [];
  const readonlyMap: string[] = [];

  if (!addressTableLookups) {
    return { writableMap, readonlyMap };
  }

  for (const lookup of addressTableLookups) {
    for (let i = 0; i < lookup.writableIndexes.length; i++) {
      writableMap.push(lookup.accountKey);
    }
    for (let i = 0; i < lookup.readonlyIndexes.length; i++) {
      readonlyMap.push(lookup.accountKey);
    }
  }

  return { writableMap, readonlyMap };
}

export function resolveStaticAccounts(params: AccountResolutionParams): AccountResolutionResult {
  const { staticKeys, header } = params;
  return {
    accountKeys: staticKeys,
    resolvedAccounts: classifyStaticKeys(staticKeys, header),
  };
}

export function resolveV0Accounts(params: AccountResolutionParams): AccountResolutionResult {
  const { staticKeys, header, loadedAddresses, addressTableLookups } = params;
  const staticAccounts = classifyStaticKeys(staticKeys, header);

  const loadedWritable = loadedAddresses?.writable ?? [];
  const loadedReadonly = loadedAddresses?.readonly ?? [];

  const { writableMap, readonlyMap } = buildLookupTableMap(addressTableLookups);

  const loadedWritableAccounts: ResolvedAccount[] = loadedWritable.map((address, i) => ({
    address,
    signer: false,
    writable: true,
    source: "lookupTable" as const,
    ...(writableMap[i] != null && { lookupTableAddress: writableMap[i] }),
  }));

  const loadedReadonlyAccounts: ResolvedAccount[] = loadedReadonly.map((address, i) => ({
    address,
    signer: false,
    writable: false,
    source: "lookupTable" as const,
    ...(readonlyMap[i] != null && { lookupTableAddress: readonlyMap[i] }),
  }));

  return {
    accountKeys: [...staticKeys, ...loadedWritable, ...loadedReadonly],
    resolvedAccounts: [...staticAccounts, ...loadedWritableAccounts, ...loadedReadonlyAccounts],
  };
}

export function selectAccountResolver(version: TransactionVersion): TransactionAccountResolver {
  switch (version) {
    case "legacy":
    case null:
    case 1:
      return resolveStaticAccounts;
    case 0:
      return resolveV0Accounts;
    default: {
      const _exhaustive: never = version;
      throw new Error(`Unhandled transaction version: ${String(_exhaustive)}`);
    }
  }
}
