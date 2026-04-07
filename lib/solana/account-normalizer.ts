import type { AccountProbeEnvelope, NormalizedAccountInfo, NormalizedProgramDataInfo } from "./types";
import type { SupportedCluster } from "./constants";
import { isSourceUnavailableError } from "./rpc";
import { asSafeNumeric, asRecord, asString } from "./parse-helpers";
import { logger } from "../observability/logger";

export function extractRawDataBytesFromAccountData(data: unknown): Uint8Array | null {
  if (!Array.isArray(data) || data.length < 2) {
    return null;
  }

  const [encodedData, encoding] = data;
  if (typeof encodedData !== "string" || encoding !== "base64") {
    return null;
  }

  try {
    return new Uint8Array(Buffer.from(encodedData, "base64"));
  } catch (error) {
    logger.warn({ event: "normalizer.base64_decode_failed", error });
    return null;
  }
}

function extractProgramDataAddress(parsedData: unknown): string | null {
  const parsedRecord = asRecord(parsedData);
  if (asString(parsedRecord?.type) !== "program") {
    return null;
  }
  return asString(asRecord(parsedRecord?.info)?.programData);
}

// FIXME(@rogaldh, @pashpashkin: jsonParsed responses for programData accounts don't include
// info.data — bytecode lives in the top-level data field and requires a separate
// base64 fetch. This will return null until a dedicated base64 call is wired in (Step 5).
function extractProgramDataRawBase64(parsedData: unknown): string | null {
  const parsedRecord = asRecord(parsedData);
  if (asString(parsedRecord?.type) !== "programData") return null;
  const info = asRecord(parsedRecord?.info);
  const data = info?.data;
  if (!Array.isArray(data) || data.length < 2) return null;
  if (typeof data[0] !== "string" || data[1] !== "base64") return null;
  return data[0];
}

export function extractProgramDataInfo(parsedData: unknown): NormalizedProgramDataInfo | null {
  const parsedRecord = asRecord(parsedData);
  if (asString(parsedRecord?.type) !== "programData") {
    return null;
  }

  const info = asRecord(parsedRecord?.info);
  const slot = asSafeNumeric(info?.slot);
  if (slot === null) {
    return null;
  }

  if (info?.authority === null) {
    return {
      authority: null,
      slot,
    };
  }

  const authority = asString(info?.authority);
  if (!authority) {
    return null;
  }

  return {
    authority,
    slot,
  };
}

export function normalizeAccountProbe(address: string, envelope: AccountProbeEnvelope): NormalizedAccountInfo | null {
  const accountValue = envelope.value;
  if (accountValue === null) {
    return null;
  }

  const data = accountValue.data;
  const parsedDataContainer = Array.isArray(data) ? null : data;
  const parsedData = parsedDataContainer?.parsed ?? null;
  const normalizedProgramData = extractProgramDataInfo(parsedData);

  return {
    address,
    owner: accountValue.owner,
    parsedProgram: parsedDataContainer?.program ?? null,
    parsedData,
    rawDataBytes: extractRawDataBytesFromAccountData(data),
    lamports: asSafeNumeric(accountValue.lamports),
    executable: accountValue.executable,
    programDataAddress: extractProgramDataAddress(parsedData),
    programData: normalizedProgramData,
    programDataStatus: normalizedProgramData ? "resolved" : "missing",
  };
}

type AccountFetcher = (address: string, cluster: SupportedCluster) => Promise<AccountProbeEnvelope>;

export async function enrichUpgradeableProgramData(
  account: NormalizedAccountInfo,
  cluster: SupportedCluster,
  fetchAccount: AccountFetcher,
): Promise<NormalizedAccountInfo> {
  if (account.parsedProgram !== "bpf-upgradeable-loader") {
    return account;
  }

  if (account.programData) {
    return {
      ...account,
      programDataStatus: "resolved",
    };
  }

  const programDataAddress = account.programDataAddress;
  if (!programDataAddress) {
    return {
      ...account,
      programDataStatus: "missing",
    };
  }

  try {
    const programDataProbe = await fetchAccount(programDataAddress, cluster);
    const normalizedProgramDataAccount = normalizeAccountProbe(programDataAddress, programDataProbe);

    if (
      normalizedProgramDataAccount === null ||
      normalizedProgramDataAccount.parsedProgram !== "bpf-upgradeable-loader"
    ) {
      return {
        ...account,
        programDataStatus: "missing",
      };
    }

    // FIXME(@rogaldh): normalizeAccountProbe already calls extractProgramDataInfo,
    // so programData is pre-computed. No need to re-extract.
    if (!normalizedProgramDataAccount.programData) {
      return {
        ...account,
        programDataStatus: "missing",
      };
    }

    return {
      ...account,
      programData: normalizedProgramDataAccount.programData,
      programDataStatus: "resolved",
      programDataRawBase64: extractProgramDataRawBase64(normalizedProgramDataAccount.parsedData),
    };
  } catch (error) {
    if (isSourceUnavailableError(error)) {
      logger.warn({
        event: "normalizer.enrich_program_data_source_unavailable",
        programAddress: account.address,
        error,
      });
      return {
        ...account,
        programDataStatus: "source_unavailable",
      };
    }

    logger.warn({
      event: "normalizer.enrich_program_data_failed",
      programAddress: account.address,
      error,
    });

    return {
      ...account,
      programDataStatus: "source_unavailable",
    };
  }
}
