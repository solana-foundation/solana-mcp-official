import { buildSplMultisigFields, buildTokenEntityFields, type AccountKindBuilder } from "./shared";

export const buildSplTokenMultisigPayload: AccountKindBuilder = context => {
  return {
    entity: {
      kind: context.kind,
      ...buildTokenEntityFields(context.kind, context.account),
      ...buildSplMultisigFields(context.account),
    },
  };
};
