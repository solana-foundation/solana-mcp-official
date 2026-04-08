import { buildKindOnlyPayload, type AccountKindBuilder } from "./shared";

export const buildConfigPayload: AccountKindBuilder = context => buildKindOnlyPayload(context);
