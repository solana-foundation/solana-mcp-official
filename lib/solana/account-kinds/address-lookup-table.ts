import { buildKindOnlyPayload, type AccountKindBuilder } from "./shared";

export const buildAddressLookupTablePayload: AccountKindBuilder = context => buildKindOnlyPayload(context);
