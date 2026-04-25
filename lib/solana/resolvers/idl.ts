import type { SupportedCluster } from "../constants";
import type { IdlDiscoveryResult } from "../types";
import { createReadOnlyProvider, fetchAnchorIdl } from "../anchor";
import { fetchPmpIdlMetadata } from "./pmp-idl";
import { detectIdlFormat, validateIdlProgramAddress } from "./idl-format";
import { logger } from "../../observability/logger";

async function tryPmpIdlSource(programAddress: string, cluster: SupportedCluster): Promise<IdlDiscoveryResult> {
  let content: string | null;
  try {
    content = await fetchPmpIdlMetadata(programAddress, cluster);
  } catch (error) {
    logger.warn({ event: "idl.pmp_fetch_failed", programAddress, error });
    return { status: "unknown", reason: "source_unavailable" };
  }

  if (content === null) return { status: "not_found" };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    logger.error({ event: "idl.pmp_parse_failed", programAddress, error });
    return { status: "unknown", reason: "idl_invalid" };
  }

  const format = detectIdlFormat(parsed);
  if (format === null) return { status: "unknown", reason: "idl_invalid" };

  const addressCheck = validateIdlProgramAddress(parsed, format.idl_type, programAddress);
  if (addressCheck === "mismatch") return { status: "unknown", reason: "idl_invalid" };
  if (addressCheck === "unverified") return { status: "unknown", reason: "address_unverified" };

  return {
    status: "found",
    idl_type: format.idl_type,
    source_type: "pmp_canonical",
    program_name: format.program_name,
    data: parsed,
  };
}

async function tryAnchorIdlSource(programAddress: string, cluster: SupportedCluster): Promise<IdlDiscoveryResult> {
  let idl;
  try {
    const provider = createReadOnlyProvider(cluster);
    idl = await fetchAnchorIdl(programAddress, provider);
  } catch (error) {
    logger.warn({ event: "idl.anchor_fetch_failed", programAddress, error });
    return { status: "unknown", reason: "source_unavailable" };
  }

  if (idl === null) return { status: "not_found" };

  const idlRecord = idl as unknown as Record<string, unknown>;
  const format = detectIdlFormat(idlRecord);
  if (format === null) return { status: "unknown", reason: "idl_invalid" };

  const addressCheck = validateIdlProgramAddress(idlRecord, format.idl_type, programAddress);
  if (addressCheck === "mismatch") return { status: "unknown", reason: "idl_invalid" };
  if (addressCheck === "unverified") return { status: "unknown", reason: "address_unverified" };

  return {
    status: "found",
    idl_type: format.idl_type,
    source_type: "anchor_on_chain",
    program_name: format.program_name,
    data: idlRecord,
  };
}

export async function resolveProgramIdl(
  programAddress: string,
  cluster: SupportedCluster,
): Promise<IdlDiscoveryResult> {
  const [pmp, anchor] = await Promise.all([
    tryPmpIdlSource(programAddress, cluster),
    tryAnchorIdlSource(programAddress, cluster),
  ]);

  if (pmp.status === "found") return pmp;
  if (anchor.status === "found") return anchor;
  if (pmp.status === "unknown") return pmp;
  if (anchor.status === "unknown") return anchor;
  return { status: "not_found" };
}
