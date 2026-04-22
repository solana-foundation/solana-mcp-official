import { fetchAccountInfo } from "../rpc";
import { normalizeAccountProbe } from "../account-normalizer";
import { asSafeNumeric, asRecord, asString } from "../parse-helpers";
import type { SupportedCluster } from "../constants";
import type { MultisigReferenceResult } from "../types";
import { logger } from "../../observability/logger";

export async function resolveSplMultisigReference(
  address: string,
  cluster: SupportedCluster,
): Promise<MultisigReferenceResult> {
  try {
    const envelope = await fetchAccountInfo(address, cluster);
    const account = normalizeAccountProbe(address, envelope);

    if (!account) {
      return { status: "not_multisig" };
    }

    const { parsedProgram } = account;
    if (parsedProgram !== "spl-token" && parsedProgram !== "spl-token-2022") {
      return { status: "not_multisig" };
    }

    const parsedRecord = asRecord(account.parsedData);
    if (asString(parsedRecord?.type) !== "multisig") {
      return { status: "not_multisig" };
    }

    const parsedInfo = asRecord(parsedRecord?.info);
    const threshold = asSafeNumeric(parsedInfo?.numRequiredSigners);
    const rawSigners = parsedInfo?.signers;
    const members = Array.isArray(rawSigners)
      ? (rawSigners as unknown[]).flatMap(s => {
          const v = asString(s);
          return v ? [v] : [];
        })
      : null;

    return {
      status: "is_multisig",
      version: parsedProgram === "spl-token" ? "spl-token" : "spl-token-2022",
      multisig_address: address,
      threshold,
      members,
    };
  } catch (error) {
    logger.warn({ event: "spl_multisig.resolve_failed", address, error });
    return { status: "unknown", reason: "source_unavailable" };
  }
}
