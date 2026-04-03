import { buildKindOnlyPayload, type AccountKindBuilder } from "./shared";

export const buildVotePayload: AccountKindBuilder = context => buildKindOnlyPayload(context);
