import { buildKindOnlyPayload, type AccountKindBuilder } from "./shared";

export const buildSolanaAttestationServicePayload: AccountKindBuilder = context => buildKindOnlyPayload(context);
