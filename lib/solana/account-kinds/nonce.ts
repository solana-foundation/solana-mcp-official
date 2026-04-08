import { buildKindOnlyPayload, type AccountKindBuilder } from "./shared";

export const buildNoncePayload: AccountKindBuilder = context => buildKindOnlyPayload(context);
