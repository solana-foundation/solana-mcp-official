import { buildKindOnlyPayload, type AccountKindBuilder } from "./shared";

export const buildStakePayload: AccountKindBuilder = context => buildKindOnlyPayload(context);
