import { BPF_UPGRADEABLE_LOADER_PROGRAM_ID, TOKEN_2022_PROGRAM_ADDRESS } from "../constants";
import type { NormalizedAccountInfo } from "../types";
import { unknownMarker, type AccountKindBuilder } from "./shared";

const PROGRAM_ADDRESS_LABELS: Record<string, string> = {
  [TOKEN_2022_PROGRAM_ADDRESS]: "Token-2022 Program",
  Vote111111111111111111111111111111111111111: "Vote Program",
};

function resolveProgramAddressLabel(address: string | undefined): string | null {
  if (!address) {
    return null;
  }
  return PROGRAM_ADDRESS_LABELS[address] ?? null;
}

function buildUpgradeableLoaderOverviewFields(account: NormalizedAccountInfo): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    address: account.address ?? null,
    address_label: resolveProgramAddressLabel(account.address),
    balance_lamports: account.lamports ?? null,
    executable: account.executable ?? null,
    executable_data: account.programDataAddress ?? null,
  };

  if (account.programDataStatus === "source_unavailable") {
    fields.upgradeable = unknownMarker("source_unavailable");
    fields.last_deployed_slot = unknownMarker("source_unavailable");
    fields.upgrade_authority = unknownMarker("source_unavailable");
    return fields;
  }

  const programData = account.programData;
  if (!programData) {
    fields.upgradeable = null;
    fields.last_deployed_slot = null;
    fields.upgrade_authority = null;
    return fields;
  }

  fields.upgradeable = programData.authority !== null;
  fields.last_deployed_slot = programData.slot;
  fields.upgrade_authority = programData.authority;
  return fields;
}

export const buildBpfUpgradeableLoaderPayload: AccountKindBuilder = context => {
  const entity: Record<string, unknown> = {
    kind: context.kind,
    owner_program: BPF_UPGRADEABLE_LOADER_PROGRAM_ID,
  };

  Object.assign(entity, buildUpgradeableLoaderOverviewFields(context.account));
  entity.verification = context.verificationResult ?? unknownMarker("source_unavailable");
  entity.security_metadata = context.securityMetadataResult ?? unknownMarker("source_unavailable");
  entity.idl = context.idlDiscoveryResult ?? unknownMarker("source_unavailable");
  entity.multisig = context.multisigReferenceResult ?? unknownMarker("source_unavailable");

  return { entity };
};
