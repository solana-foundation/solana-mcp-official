import type { ResolvedAccount, TransactionVersion } from "../types";

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
    return { address, signer, writable };
  });
}

export function resolveStaticAccounts(params: AccountResolutionParams): AccountResolutionResult {
  const { staticKeys, header } = params;
  return {
    accountKeys: staticKeys,
    resolvedAccounts: classifyStaticKeys(staticKeys, header),
  };
}

export function resolveV0Accounts(params: AccountResolutionParams): AccountResolutionResult {
  const { staticKeys, header, loadedAddresses } = params;
  const staticAccounts = classifyStaticKeys(staticKeys, header);

  const loadedWritable = loadedAddresses?.writable ?? [];
  const loadedReadonly = loadedAddresses?.readonly ?? [];

  const loadedWritableAccounts: ResolvedAccount[] = loadedWritable.map(address => ({
    address,
    signer: false,
    writable: true,
  }));

  const loadedReadonlyAccounts: ResolvedAccount[] = loadedReadonly.map(address => ({
    address,
    signer: false,
    writable: false,
  }));

  return {
    accountKeys: [
      ...staticKeys,
      ...loadedWritable,
      ...loadedReadonly,
    ],
    resolvedAccounts: [
      ...staticAccounts,
      ...loadedWritableAccounts,
      ...loadedReadonlyAccounts,
    ],
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
