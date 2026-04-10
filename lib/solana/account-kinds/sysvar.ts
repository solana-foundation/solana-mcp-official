import { buildKindOnlyPayload, type AccountKindBuilder } from "./shared";

export const buildSysvarPayload: AccountKindBuilder = context => buildKindOnlyPayload(context);
