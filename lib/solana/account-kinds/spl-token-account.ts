import { buildTokenEntityFields, type AccountKindBuilder } from "./shared";

export const buildSplTokenAccountPayload: AccountKindBuilder = context => {
  return {
    entity: {
      kind: context.kind,
      ...buildTokenEntityFields(context.kind, context.account),
    },
  };
};
