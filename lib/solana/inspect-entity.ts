import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { unknownMarker } from "./account-kinds/shared";
import { buildAccountPayloadWithRouter as buildAccountPayload } from "./inspect-entity-account-router";
import {
  classifyAccountKindBase,
  decodeIdentifierKind,
  normalizeDasOutcome,
  promoteAccountKindWithDas,
} from "./inspect-entity-classifier";
import type {
  DasClassificationOutcome,
  IdlDiscoveryResult,
  MetaplexMetadataResult,
  MultisigReferenceResult,
  SecurityMetadataResult,
  VerificationResult,
} from "./types";
import { resolveMetaplexMetadata } from "./metaplex-metadata";
import { fetchAccountInfo, fetchAsset, fetchSignatureStatus, fetchTransaction, isSourceUnavailableError } from "./rpc";
import { SUPPORTED_CLUSTERS, type SupportedCluster } from "./constants";
import { type McpToolError, internalError, invalidArgument, notFound, sanitizeToolError, toToolResult } from "./errors";
import { enrichUpgradeableProgramData, normalizeAccountProbe } from "./account-normalizer";
import { normalizeTransactionProbe } from "./transaction/normalizer";
import { buildTransactionPayload } from "./transaction/build-payload";
import { logger } from "../observability/logger";

export const inspectEntityInputSchema = z
  .object({
    identifier: z.string().min(1).max(128),
    cluster: z.enum(SUPPORTED_CLUSTERS).optional().default("mainnet-beta"),
  })
  .strict();

type InspectEntityArgs = z.infer<typeof inspectEntityInputSchema>;

type InspectEntityDependencies = {
  fetchAccountInfo: typeof fetchAccountInfo;
  fetchTransaction: typeof fetchTransaction;
  fetchAsset: typeof fetchAsset;
  resolveProgramVerification: (
    programAddress: string,
    programAuthority: string | null,
    programDataBase64: string | null,
    cluster: SupportedCluster,
  ) => Promise<VerificationResult>;
  resolveProgramSecurityMetadata: (
    programAddress: string,
    programDataRawBase64: string | null,
    cluster: SupportedCluster,
  ) => Promise<SecurityMetadataResult>;
  resolveMultisigReference: (
    upgradeAuthority: string | null,
    cluster: SupportedCluster,
  ) => Promise<MultisigReferenceResult>;
  resolveProgramIdl: (programAddress: string, cluster: SupportedCluster) => Promise<IdlDiscoveryResult>;
  resolveMetaplexMetadata: (mintAddress: string, cluster: SupportedCluster) => Promise<MetaplexMetadataResult>;
  fetchSignatureStatus: typeof fetchSignatureStatus;
};

const defaultDependencies: InspectEntityDependencies = {
  fetchAccountInfo,
  fetchTransaction,
  fetchAsset,
  resolveProgramVerification: async () => ({ status: "unverified" as const }),
  resolveProgramSecurityMetadata: async () => ({ status: "missing" as const }),
  resolveMultisigReference: async () => ({ status: "not_multisig" as const }),
  resolveProgramIdl: async () => ({ status: "not_found" as const }),
  resolveMetaplexMetadata,
  fetchSignatureStatus,
};

function toSourceUnavailablePayload(kind: "account" | "transaction"): Record<string, unknown> {
  return {
    entity: {
      kind,
      source: unknownMarker("source_unavailable"),
    },
  };
}

function toNotFoundPayload(kind: "account" | "transaction"): Record<string, unknown> {
  return {
    entity: {
      kind,
    },
  };
}

function safeCatch<T>(resolver: string, identifier: string, fallback: T) {
  return (error: unknown): T => {
    logger.warn({ event: "inspect_entity.safety_catch", resolver, identifier, error });
    return fallback;
  };
}

async function resolveAccount(
  identifier: string,
  cluster: SupportedCluster,
  dependencies: InspectEntityDependencies,
): Promise<CallToolResult> {
  try {
    const accountProbe = await dependencies.fetchAccountInfo(identifier, cluster);
    const normalizedAccount = normalizeAccountProbe(identifier, accountProbe);

    if (normalizedAccount === null) {
      return toToolResult({
        payload: toNotFoundPayload("account"),
        errors: [notFound()],
      });
    }

    const enrichedAccount = await enrichUpgradeableProgramData(
      normalizedAccount,
      cluster,
      dependencies.fetchAccountInfo,
    );

    const baseKind = classifyAccountKindBase(enrichedAccount);

    let verificationResult: VerificationResult | undefined;
    let securityMetadataResult: SecurityMetadataResult | undefined;
    let multisigReferenceResult: MultisigReferenceResult | undefined;
    let idlDiscoveryResult: IdlDiscoveryResult | undefined;

    if (baseKind === "bpf-upgradeable-loader") {
      [verificationResult, securityMetadataResult, multisigReferenceResult, idlDiscoveryResult] = await Promise.all([
        dependencies
          .resolveProgramVerification(
            identifier,
            enrichedAccount.programData?.authority ?? null,
            enrichedAccount.programDataRawBase64 ?? null,
            cluster,
          )
          .catch(
            safeCatch<VerificationResult>("verification", identifier, {
              status: "unknown",
              reason: "source_unavailable",
            }),
          ),
        dependencies
          .resolveProgramSecurityMetadata(identifier, enrichedAccount.programDataRawBase64 ?? null, cluster)
          .catch(
            safeCatch<SecurityMetadataResult>("security_metadata", identifier, {
              status: "unknown",
              reason: "source_unavailable",
            }),
          ),
        dependencies.resolveMultisigReference(enrichedAccount.programData?.authority ?? null, cluster).catch(
          safeCatch<MultisigReferenceResult>("multisig", identifier, {
            status: "unknown",
            reason: "source_unavailable",
          }),
        ),
        dependencies
          .resolveProgramIdl(identifier, cluster)
          .catch(
            safeCatch<IdlDiscoveryResult>("idl", identifier, { status: "unknown", reason: "source_unavailable" }),
          ),
      ]);
    }

    let dasOutcome: DasClassificationOutcome | null = null;

    if (baseKind === "unknown") {
      try {
        const rawAsset = await dependencies.fetchAsset(identifier, cluster);
        dasOutcome = normalizeDasOutcome(rawAsset);
      } catch (error) {
        logger.warn({ event: "inspect_entity.safety_catch", resolver: "das", identifier, error });
        dasOutcome = null;
      }
    }

    const finalKind = promoteAccountKindWithDas(baseKind, dasOutcome);

    let metaplexMetadataResult: MetaplexMetadataResult | undefined;

    if (finalKind === "spl-token:mint" || finalKind === "spl-token-2022:mint") {
      metaplexMetadataResult = await dependencies.resolveMetaplexMetadata(identifier, cluster).catch(
        safeCatch<MetaplexMetadataResult>("metaplex_metadata", identifier, {
          status: "unknown",
          reason: "source_unavailable",
        }),
      );
    }

    const payload = buildAccountPayload({
      kind: finalKind,
      account: enrichedAccount,
      ...(dasOutcome ? { dasOutcome } : {}),
      ...(verificationResult ? { verificationResult } : {}),
      ...(securityMetadataResult ? { securityMetadataResult } : {}),
      ...(multisigReferenceResult ? { multisigReferenceResult } : {}),
      ...(idlDiscoveryResult ? { idlDiscoveryResult } : {}),
      ...(metaplexMetadataResult ? { metaplexMetadataResult } : {}),
    });

    return toToolResult({
      payload,
      errors: [],
    });
  } catch (error) {
    logger.error({
      event: "inspect_entity.resolve_account_failed",
      identifier,
      error,
    });

    if (isSourceUnavailableError(error)) {
      return toToolResult({
        payload: toSourceUnavailablePayload("account"),
        errors: [internalError()],
      });
    }

    return toToolResult({
      payload: {},
      errors: [internalError()],
    });
  }
}

async function resolveTransaction(
  identifier: string,
  cluster: SupportedCluster,
  dependencies: InspectEntityDependencies,
): Promise<CallToolResult> {
  try {
    const [transactionProbe, signatureStatus] = await Promise.all([
      dependencies.fetchTransaction(identifier, cluster),
      dependencies.fetchSignatureStatus(identifier, cluster).catch(error => {
        logger.warn({
          event: "inspect_entity.safety_catch",
          resolver: "signature_status",
          identifier,
          error,
        });
        return null;
      }),
    ]);
    const transactionContext = normalizeTransactionProbe(identifier, transactionProbe, signatureStatus);

    if (transactionContext === null) {
      return toToolResult({
        payload: toNotFoundPayload("transaction"),
        errors: [notFound()],
      });
    }

    const errors: McpToolError[] = [];
    if (signatureStatus === null) {
      errors.push(internalError("Confirmation status temporarily unavailable."));
    }

    return toToolResult({
      payload: buildTransactionPayload(transactionContext),
      errors,
      isError: false,
    });
  } catch (error) {
    logger.error({
      event: "inspect_entity.resolve_transaction_failed",
      identifier,
      error,
    });

    if (isSourceUnavailableError(error)) {
      return toToolResult({
        payload: toSourceUnavailablePayload("transaction"),
        errors: [internalError()],
      });
    }

    return toToolResult({
      payload: {},
      errors: [internalError()],
    });
  }
}

export async function handleInspectEntity(
  rawInput: unknown,
  dependencies: InspectEntityDependencies = defaultDependencies,
): Promise<CallToolResult> {
  const parseResult = inspectEntityInputSchema.safeParse(rawInput);
  if (!parseResult.success) {
    return toToolResult({
      payload: {},
      errors: [sanitizeToolError(parseResult.error)],
    });
  }

  const input: InspectEntityArgs = parseResult.data;
  const identifierKind = decodeIdentifierKind(input.identifier);

  if (identifierKind === "invalid") {
    return toToolResult({
      payload: {},
      errors: [invalidArgument("identifier must decode from base58 to 32 or 64 bytes")],
    });
  }

  if (identifierKind === "account") {
    return resolveAccount(input.identifier, input.cluster, dependencies);
  }

  return resolveTransaction(input.identifier, input.cluster, dependencies);
}
