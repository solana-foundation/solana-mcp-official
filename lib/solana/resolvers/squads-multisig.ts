import type { Idl, Program } from "@coral-xyz/anchor";
import { createReadOnlyProvider, createAnchorProgram } from "../anchor";
import { SQUADS_LAMBDA_URL } from "../constants";
import type { SupportedCluster } from "../constants";
import { squadsV3Idl } from "../idls/squads-v3.min";
import { squadsV4Idl } from "../idls/squads-v4.min";
import type { MultisigReferenceResult } from "../types";
import { logger } from "../../observability/logger";

async function fetchV3MultisigDetails(
  program: Program<Idl>,
  multisigAddress: string,
): Promise<{ threshold: number; members: string[] } | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const account = await (program.account as any).ms.fetch(multisigAddress);
    if (!account) return null;

    const threshold = account.threshold as number;
    // V3 Ms.keys: PublicKey[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const members = (account.keys as any[])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((k: any) => k.toString())
      .filter((s: string) => s.length > 0);

    if (typeof threshold !== "number" || threshold <= 0) return null;
    if (members.length === 0) return null;

    return { threshold, members };
  } catch (error) {
    logger.warn({ event: "squads.v3_fetch_failed", multisigAddress, error });
    throw error;
  }
}

async function fetchV4MultisigDetails(
  program: Program<Idl>,
  multisigAddress: string,
): Promise<{ threshold: number; members: string[] } | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const account = await (program.account as any).multisig.fetch(multisigAddress);
    if (!account) return null;

    const threshold = account.threshold as number;
    // V4 Multisig.members: Array<{ key: PublicKey, ... }>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const members = (account.members as any[])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((m: any) => m.key.toString())
      .filter((s: string) => s.length > 0);

    if (typeof threshold !== "number" || threshold <= 0) return null;
    if (members.length === 0) return null;

    return { threshold, members };
  } catch (error) {
    logger.warn({ event: "squads.v4_fetch_failed", multisigAddress, error });
    throw error;
  }
}

// ── Lambda (mainnet only) ─────────────────────────────────────────────────────

type LambdaResult = {
  isSquad: boolean;
  version: "v3" | "v4";
  multisig: string;
};

async function fetchSquadsLambdaInfo(authority: string): Promise<LambdaResult | null> {
  let response: Response;
  try {
    response = await fetch(`${SQUADS_LAMBDA_URL}/${encodeURIComponent(authority)}`, {
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    logger.warn({ event: "squads.lambda_fetch_failed", authority, error });
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`Lambda responded with HTTP ${response.status}`);
    logger.warn({
      event: "squads.lambda_http_error",
      authority,
      statusCode: response.status,
    });
    throw error;
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    logger.warn({ event: "squads.lambda_json_parse_failed", authority, error });
    throw error;
  }
  if ("error" in data || !data.isSquad) return null;
  if (data.version !== "v3" && data.version !== "v4") return null;
  if (typeof data.multisig !== "string") return null;
  return data as unknown as LambdaResult;
}

// ── Main resolver ─────────────────────────────────────────────────────────────

export async function resolveMultisigReference(
  upgradeAuthority: string | null,
  cluster: SupportedCluster,
): Promise<MultisigReferenceResult> {
  if (!upgradeAuthority) {
    return { status: "not_multisig" };
  }

  if (cluster !== "mainnet-beta") {
    return { status: "unknown", reason: "source_unavailable" };
  }

  try {
    const lambdaInfo = await fetchSquadsLambdaInfo(upgradeAuthority);
    if (!lambdaInfo) {
      return { status: "not_multisig" };
    }

    const idl = lambdaInfo.version === "v3" ? squadsV3Idl : squadsV4Idl;
    const provider = createReadOnlyProvider(cluster);
    const program = await createAnchorProgram(idl, provider);

    const details =
      lambdaInfo.version === "v3"
        ? await fetchV3MultisigDetails(program, lambdaInfo.multisig)
        : await fetchV4MultisigDetails(program, lambdaInfo.multisig);

    return {
      status: "is_multisig",
      version: lambdaInfo.version,
      multisig_address: lambdaInfo.multisig,
      threshold: details?.threshold ?? null,
      members: details?.members ?? null,
    };
  } catch (error) {
    logger.warn({
      event: "squads.resolve_failed",
      upgradeAuthority,
      error,
    });
    return { status: "unknown", reason: "source_unavailable" };
  }
}
