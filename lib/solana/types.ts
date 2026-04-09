// Inlined from resolvers/security-txt-parser.ts (ported in Step 5)
export type SecurityTxtFields = {
  name: string;
  project_url: string;
  contacts: string;
  policy: string;
  preferred_languages: string | null;
  encryption: string | null;
  source_code: string | null;
  source_release: string | null;
  source_revision: string | null;
  auditors: string | null;
  acknowledgements: string | null;
  expiry: string | null;
  logo?: string | null;
  description?: string | null;
  notification?: string | null;
  sdk?: string | null;
  version?: string | null;
};

// Inlined from resolvers/verification.ts (ported in Step 5)
export type VerificationEvidence = {
  signer: string;
  signer_label: string | null;
  on_chain_hash: string;
  executable_hash: string;
  last_verified_at: string | null;
  repo_url: string | null;
  is_frozen: boolean;
  message: string;
};

export type VerificationResult =
  | { status: "verified"; evidence: VerificationEvidence }
  | { status: "unverified" }
  | {
      status: "unknown";
      reason: "source_unavailable" | "verification_invalid";
    };

export type IdentifierKind = "account" | "transaction" | "invalid";

export type AccountProbeEnvelope = {
  value: {
    owner: string;
    lamports: number | bigint;
    executable: boolean;
    data: { program: string; parsed: unknown } | [string, string];
  } | null;
};

export type CompiledInstruction = {
  programIdIndex: number;
  accounts: readonly number[];
  data: string;
};

export type CompiledInnerInstruction = {
  index: number;
  instructions: readonly CompiledInstruction[];
};

export type TransactionProbeEnvelope = {
  slot: number | bigint;
  blockTime: number | bigint | null;
  version?: "legacy" | 0 | null;
  meta: {
    err: unknown;
    fee: number | bigint;
    computeUnitsConsumed?: number | bigint | null;
    logMessages?: readonly string[] | null;
    innerInstructions?: readonly CompiledInnerInstruction[] | null;
  } | null;
  transaction: {
    message: {
      header: {
        numRequiredSignatures: number;
        numReadonlySignedAccounts: number;
        numReadonlyUnsignedAccounts: number;
      };
      accountKeys: readonly (string | { pubkey: string })[];
      recentBlockhash?: string;
      instructions: readonly CompiledInstruction[];
    };
  };
} | null;

export type ConfirmationStatus = "processed" | "confirmed" | "finalized";

export type SignatureStatusValue = {
  confirmationStatus: ConfirmationStatus | null;
  confirmations: number | bigint | null;
};

export type SignatureStatusEnvelope = {
  value: SignatureStatusValue | null;
};

export type AccountEntityKind =
  | "bpf-loader"
  | "bpf-loader-2"
  | "bpf-upgradeable-loader"
  | "loader-v4"
  | "stake"
  | "nftoken"
  | "spl-token:mint"
  | "spl-token:account"
  | "spl-token:multisig"
  | "spl-token-2022:mint"
  | "spl-token-2022:account"
  | "spl-token-2022:multisig"
  | "nonce"
  | "vote"
  | "sysvar"
  | "config"
  | "address-lookup-table"
  | "feature"
  | "solana-attestation-service"
  | "compressed-nft"
  | "unknown";

export type BaseAccountEntityKind = Exclude<AccountEntityKind, "compressed-nft">;

export type TokenSubtype = "mint" | "account" | "multisig";

export type UnknownMarker = {
  value: null;
  status: "unknown";
  reason: string;
};

export type NormalizedProgramDataInfo = {
  authority: string | null;
  slot: SafeNumeric;
};

export type ProgramDataStatus = "resolved" | "missing" | "source_unavailable";

export type NormalizedAccountInfo = {
  owner: string | null;
  parsedProgram: string | null;
  parsedData: unknown;
  rawDataBytes: Uint8Array | null;
  address?: string;
  lamports?: SafeNumeric;
  executable?: boolean | null;
  programDataAddress?: string | null;
  programData?: NormalizedProgramDataInfo | null;
  programDataStatus?: ProgramDataStatus;
  programDataRawBase64?: string | null;
};

export type DasClassificationOutcome = {
  compressed: boolean;
  assetId?: string;
  owner?: string;
  tree?: string;
};

export type SecurityMetadataResult =
  | {
      status: "present";
      data: SecurityTxtFields;
      source_type: "pmp_canonical" | "embedded_security_txt";
      security_expired?: true;
    }
  | { status: "missing" }
  | { status: "unknown"; reason: "source_unavailable" | "security_invalid" };

export type MultisigReferenceResult =
  | {
      status: "is_multisig";
      version: "v3" | "v4" | "spl-token" | "spl-token-2022";
      multisig_address: string | null;
      threshold: SafeNumeric;
      members: string[] | null;
    }
  | { status: "not_multisig" }
  | { status: "unknown"; reason: "source_unavailable" };

export type IdlType = "anchor" | "anchor_legacy" | "codama" | "shank";

export type IdlDiscoveryResult =
  | {
      status: "found";
      idl_type: IdlType;
      source_type: "pmp_canonical" | "anchor_on_chain";
      program_name: string | null;
      data: Record<string, unknown>;
    }
  | { status: "not_found" }
  | {
      status: "unknown";
      reason: "source_unavailable" | "idl_invalid" | "address_unverified";
    };

export type AccountPayloadContext = {
  kind: AccountEntityKind;
  account: NormalizedAccountInfo;
  dasOutcome?: DasClassificationOutcome;
  verificationResult?: VerificationResult;
  securityMetadataResult?: SecurityMetadataResult;
  multisigReferenceResult?: MultisigReferenceResult;
  idlDiscoveryResult?: IdlDiscoveryResult;
};

/** A numeric value that may be represented as a decimal string when it exceeds Number.MAX_SAFE_INTEGER. */
export type SafeNumeric = number | string | null;

type TransactionPayloadContextBase = {
  signature: string;
  slot: number;
  blockTime: SafeNumeric;
  feeLamports: SafeNumeric;
  version: "legacy" | 0 | null;
  computeUnitsConsumed: SafeNumeric;
  logMessages: readonly string[] | null;
  recentBlockhash: string | null;
  confirmationStatus: ConfirmationStatus | null;
  confirmations: number | "max" | null;
  accountKeys: string[];
  numRequiredSignatures: number;
  numReadonlySignedAccounts: number;
  numReadonlyUnsignedAccounts: number;
  instructions: readonly CompiledInstruction[];
  innerInstructions: readonly CompiledInnerInstruction[] | null;
};

export type TransactionPayloadContext =
  | (TransactionPayloadContextBase & { status: "success"; err: null })
  | (TransactionPayloadContextBase & {
      status: "failed";
      /** Raw error from the RPC response. */
      err: Record<string, unknown> | string | unknown[] | null;
    })
  | (TransactionPayloadContextBase & { status: "unknown"; err: null });

type TransactionPayloadEntityBase = {
  kind: "transaction";
  signature: string;
  slot: number;
  block_time: SafeNumeric;
  fee_lamports: SafeNumeric;
  signers: string[];
  transaction_version: "legacy" | 0 | null;
  recent_blockhash: string | null;
  compute_units_consumed: SafeNumeric;
  confirmation_status: ConfirmationStatus | null;
  confirmations: number | "max" | null;
  log_messages: readonly string[] | null;
  accounts: {
    address: string;
    signer: boolean;
    writable: boolean;
  }[];
  instructions: {
    program_id: string;
    accounts: string[];
    data: string;
    inner_instructions: {
      program_id: string;
      accounts: string[];
      data: string;
    }[];
  }[];
};

export type TransactionPayloadOutput = {
  entity:
    | (TransactionPayloadEntityBase & { status: "success"; error: null })
    | (TransactionPayloadEntityBase & {
        status: "failed";
        error: Record<string, unknown> | string | unknown[] | null;
      })
    | (TransactionPayloadEntityBase & { status: "unknown"; error: null });
};
