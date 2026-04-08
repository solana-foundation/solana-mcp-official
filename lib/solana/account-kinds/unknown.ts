import { buildKindOnlyPayload, type AccountKindBuilder } from "./shared";

export const buildUnknownPayload: AccountKindBuilder = context => buildKindOnlyPayload(context);
