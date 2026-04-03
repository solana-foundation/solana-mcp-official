import { buildKindOnlyPayload, type AccountKindBuilder } from "./shared";

export const buildFeaturePayload: AccountKindBuilder = context => buildKindOnlyPayload(context);
