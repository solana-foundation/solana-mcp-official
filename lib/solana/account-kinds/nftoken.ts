import { NFTOKEN_ADDRESS } from "../constants";
import type { AccountKindBuilder } from "./shared";

export const buildNftokenPayload: AccountKindBuilder = context => {
  return {
    entity: {
      kind: context.kind,
      owner_program: NFTOKEN_ADDRESS,
    },
  };
};
