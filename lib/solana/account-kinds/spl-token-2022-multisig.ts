import { buildSplMultisigFields, buildTokenEntityFields, type AccountKindBuilder } from "./shared";

export const buildSplToken2022MultisigPayload: AccountKindBuilder = context => {
  return {
    entity: {
      kind: context.kind,
      ...buildTokenEntityFields(context.kind, context.account),
      ...buildSplMultisigFields(context.account),
    },
  };
};
