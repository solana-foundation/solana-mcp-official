import { LOADER_V4_PROGRAM_ID } from "../constants";
import type { NormalizedAccountInfo } from "../types";
import { resolveProgramAddressLabel, unknownMarker, type AccountKindBuilder } from "./shared";

function buildLoaderOverviewFields(account: NormalizedAccountInfo): Record<string, unknown> {
  return {
    address: account.address ?? null,
    address_label: resolveProgramAddressLabel(account.address),
    balance_lamports: account.lamports ?? null,
    executable: account.executable ?? null,
  };
}

export const buildLoaderV4Payload: AccountKindBuilder = context => {
  const entity: Record<string, unknown> = {
    kind: context.kind,
    owner_program: LOADER_V4_PROGRAM_ID,
  };

  Object.assign(entity, buildLoaderOverviewFields(context.account));
  entity.verification = context.verificationResult ?? unknownMarker("source_unavailable");
  entity.security_metadata = context.securityMetadataResult ?? unknownMarker("source_unavailable");
  entity.idl = context.idlDiscoveryResult ?? unknownMarker("source_unavailable");
  entity.multisig = context.multisigReferenceResult ?? unknownMarker("source_unavailable");

  return { entity };
};
