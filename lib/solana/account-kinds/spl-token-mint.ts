import { buildMetaplexMetadataField, buildMintOverviewFields, type AccountKindBuilder } from "./shared";

export const buildSplTokenMintPayload: AccountKindBuilder = context => {
  return {
    entity: {
      kind: context.kind,
      ...buildMintOverviewFields(context.account),
      metaplex_metadata: buildMetaplexMetadataField(context.metaplexMetadataResult),
    },
  };
};
