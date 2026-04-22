import { resolveMultisigReference as resolveSquadsMultisig } from "./squads-multisig";
import { resolveSplMultisigReference } from "./spl-multisig";
import type { SupportedCluster } from "../constants";
import type { MultisigReferenceResult } from "../types";

export async function resolveMultisigReference(
  upgradeAuthority: string | null,
  cluster: SupportedCluster,
): Promise<MultisigReferenceResult> {
  const squadsResult = await resolveSquadsMultisig(upgradeAuthority, cluster);

  if (squadsResult.status === "is_multisig" || upgradeAuthority === null) {
    return squadsResult;
  }

  // On mainnet, Squads "unknown" means a transient failure — don't fall through
  // to SPL since they detect different multisig types.
  if (squadsResult.status === "unknown" && cluster === "mainnet-beta") {
    return squadsResult;
  }

  return resolveSplMultisigReference(upgradeAuthority, cluster);
}
