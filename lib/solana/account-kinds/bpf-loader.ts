import { BPF_LOADER_PROGRAM_ID, BPF_LOADER_2_PROGRAM_ID, TOKEN_2022_PROGRAM_ADDRESS } from "../constants";
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

function buildBpfLoaderOverviewFields(account: NormalizedAccountInfo): Record<string, unknown> {
  return {
    address: account.address ?? null,
    address_label: resolveProgramAddressLabel(account.address),
    balance_lamports: account.lamports ?? null,
    executable: account.executable ?? null,
  };
}

function buildPayload(ownerProgram: string): AccountKindBuilder {
  return context => {
    const entity: Record<string, unknown> = {
      kind: context.kind,
      owner_program: ownerProgram,
    };

    Object.assign(entity, buildBpfLoaderOverviewFields(context.account));
    entity.verification = context.verificationResult ?? unknownMarker("source_unavailable");
    entity.security_metadata = context.securityMetadataResult ?? unknownMarker("source_unavailable");
    entity.idl = context.idlDiscoveryResult ?? unknownMarker("source_unavailable");
    entity.multisig = context.multisigReferenceResult ?? unknownMarker("source_unavailable");

    return { entity };
  };
}

export const buildBpfLoaderPayload: AccountKindBuilder = buildPayload(BPF_LOADER_PROGRAM_ID);
export const buildBpfLoader2Payload: AccountKindBuilder = buildPayload(BPF_LOADER_2_PROGRAM_ID);
