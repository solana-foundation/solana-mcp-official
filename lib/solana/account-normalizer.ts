import * as O from "fp-ts/Option";
import { pipe } from "fp-ts/function";

import type { AccountProbeEnvelope, NormalizedAccountInfo, NormalizedProgramDataInfo } from "./types";
import type { SupportedCluster } from "./constants";
import { isSourceUnavailableError } from "./rpc";
import { asSafeNumeric, asRecord, asString, asRecordO, asStringO } from "./parse-helpers";
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

/** @internal Exported for test coverage. */
export function extractProgramDataAddress(parsedData: unknown): string | null {
  return pipe(
    asRecordO(parsedData),
    O.filter(r => asString(r.type) === "program"), // only "program"-typed entries carry a programData pointer
    O.flatMap(r => asRecordO(r.info)), // drill into nested info object
    O.flatMap(info => asStringO(info.programData)), // extract the programData address
    O.getOrElse(() => null as string | null),
  );
}

// FIXME(@rogaldh, @pashpashkin: jsonParsed responses for programData accounts don't include
// info.data — bytecode lives in the top-level data field and requires a separate
// base64 fetch. This will return null until a dedicated base64 call is wired in (Step 5).
function extractProgramDataRawBase64(parsedData: unknown): string | null {
  return pipe(
    asRecordO(parsedData),
    O.filter(r => asString(r.type) === "programData"), // only programData entries carry bytecode
    O.flatMap(r => asRecordO(r.info)), // drill into nested info object
    O.flatMap(info => {
      // extract base64-encoded bytecode from [string, "base64"] tuple
      const data = info.data;
      if (!Array.isArray(data) || data.length < 2) return O.none;
      if (typeof data[0] !== "string" || data[1] !== "base64") return O.none;
      return O.some(data[0]);
    }),
    O.getOrElse(() => null as string | null),
  );
}

export function extractProgramDataInfo(parsedData: unknown): NormalizedProgramDataInfo | null {
  return pipe(
    asRecordO(parsedData),
    O.filter(r => asString(r.type) === "programData"), // only programData entries carry authority/slot
    O.flatMap(r => asRecordO(r.info)), // drill into nested info object
    O.flatMap(info => {
      // extract authority + slot, handling frozen programs (authority === null)
      const slot = asSafeNumeric(info.slot);
      if (slot === null) return O.none;
      if (info.authority === null) return O.some({ authority: null, slot }); // frozen program
      return pipe(
        asStringO(info.authority),
        O.filter(s => s.length > 0), // reject empty-string authority (asStringO yields Some(""))
        O.map(authority => ({ authority, slot })),
      );
    }),
    O.getOrElse(() => null as NormalizedProgramDataInfo | null),
  );
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

    // FIXME(@rogaldh): this catch branch handles non-RPC errors (e.g. TypeError,
    // serialization bugs). "source_unavailable" is misleading here — revisit
    // the status value when wiring up the tool in Step 4.
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
