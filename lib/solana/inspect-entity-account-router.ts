import type { AccountEntityKind, AccountPayloadContext } from "./types";
import { buildAddressLookupTablePayload } from "./account-kinds/address-lookup-table";
import { buildBpfUpgradeableLoaderPayload } from "./account-kinds/bpf-upgradeable-loader";
import { buildCompressedNftPayload } from "./account-kinds/compressed-nft";
import { buildConfigPayload } from "./account-kinds/config";
import { buildFeaturePayload } from "./account-kinds/feature";
import { buildNftokenPayload } from "./account-kinds/nftoken";
import { buildNoncePayload } from "./account-kinds/nonce";
import { buildSolanaAttestationServicePayload } from "./account-kinds/solana-attestation-service";
import { buildSplToken2022AccountPayload } from "./account-kinds/spl-token-2022-account";
import { buildSplToken2022MintPayload } from "./account-kinds/spl-token-2022-mint";
import { buildSplToken2022MultisigPayload } from "./account-kinds/spl-token-2022-multisig";
import { buildSplTokenAccountPayload } from "./account-kinds/spl-token-account";
import { buildSplTokenMintPayload } from "./account-kinds/spl-token-mint";
import { buildSplTokenMultisigPayload } from "./account-kinds/spl-token-multisig";
import { buildStakePayload } from "./account-kinds/stake";
import { buildSysvarPayload } from "./account-kinds/sysvar";
import { buildUnknownPayload } from "./account-kinds/unknown";
import { buildVotePayload } from "./account-kinds/vote";
import { assertUnreachable, type AccountKindBuilder } from "./account-kinds/shared";

function selectBuilder(kind: AccountEntityKind): AccountKindBuilder {
  switch (kind) {
    case "bpf-upgradeable-loader":
      return buildBpfUpgradeableLoaderPayload;
    case "stake":
      return buildStakePayload;
    case "nftoken":
      return buildNftokenPayload;
    case "spl-token:mint":
      return buildSplTokenMintPayload;
    case "spl-token:account":
      return buildSplTokenAccountPayload;
    case "spl-token:multisig":
      return buildSplTokenMultisigPayload;
    case "spl-token-2022:mint":
      return buildSplToken2022MintPayload;
    case "spl-token-2022:account":
      return buildSplToken2022AccountPayload;
    case "spl-token-2022:multisig":
      return buildSplToken2022MultisigPayload;
    case "nonce":
      return buildNoncePayload;
    case "vote":
      return buildVotePayload;
    case "sysvar":
      return buildSysvarPayload;
    case "config":
      return buildConfigPayload;
    case "address-lookup-table":
      return buildAddressLookupTablePayload;
    case "feature":
      return buildFeaturePayload;
    case "solana-attestation-service":
      return buildSolanaAttestationServicePayload;
    case "compressed-nft":
      return buildCompressedNftPayload;
    case "unknown":
      return buildUnknownPayload;
    default:
      return assertUnreachable(kind);
  }
}

export function buildAccountPayloadWithRouter(context: AccountPayloadContext): Record<string, unknown> {
  return selectBuilder(context.kind)(context);
}
