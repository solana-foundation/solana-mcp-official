import { buildTokenEntityFields, type AccountKindBuilder } from "./shared";

export const buildSplToken2022AccountPayload: AccountKindBuilder = context => {
  return {
    entity: {
      kind: context.kind,
      ...buildTokenEntityFields(context.kind, context.account),
    },
  };
};
