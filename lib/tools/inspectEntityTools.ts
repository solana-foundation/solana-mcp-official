import type { SolanaTool } from "./types";
import { handleInspectEntity, inspectEntityInputSchema } from "../solana/inspect-entity";

const INSPECT_ENTITY_DESCRIPTION = [
  "Retrieve detailed on-chain data for any Solana account or transaction.",
  "Use this tool when a user asks about a Solana address, transaction, program, token, NFT, wallet, or other blockchain entity.",
  "",
  "IDENTIFIER: A base58-encoded string. Accepts account addresses (32-byte) and transaction signatures (64-byte) — the tool detects which type was provided.",
  "",
  "CLUSTER: Solana network to query (mainnet-beta, devnet, testnet, simd296). Defaults to mainnet-beta.",
  "",
  "ACCOUNT TYPES RETURNED (by entity.kind):",
  '- "bpf-upgradeable-loader": Executable programs — address, label, balance, executable status, upgrade authority, last deployed slot, verification status, security metadata, IDL discovery, multisig details.',
  '- "spl-token:mint" / "spl-token-2022:mint": Token mints — address, supply, decimals, mint/freeze authorities, supply type (fixed/variable), token program. Token-2022 mints also include parsed extensions.',
  '- "spl-token:account" / "spl-token-2022:account": Token accounts — mint, owner, token program.',
  '- "spl-token:multisig" / "spl-token-2022:multisig": Token multisigs — signers, threshold, initialization status.',
  '- "compressed-nft": Compressed NFTs — asset ID, owner, merkle tree.',
  '- "stake", "vote", "nonce", "sysvar", "config", "address-lookup-table", "feature", "nftoken", "solana-attestation-service": Recognized system account types.',
  '- "unknown": Unrecognized account type.',
  "",
  "TRANSACTION DATA (entity.kind = transaction):",
  'signature, slot, block time, status (success/failed/unknown), fee in lamports, ordered signer list, transaction version, recent blockhash, compute units consumed, confirmation status and confirmations (numeric count or "max" when finalized), error detail (when failed), program log messages, accounts with signer/writable roles, instructions with resolved program addresses and nested CPI (inner instructions). Numeric fields that exceed safe integer range are returned as decimal strings.',
  "",
  "OUTPUT: Responses use { payload: { entity: { kind, ...fields } }, errors: [] }. Unresolvable fields return explicit unknown markers instead of being silently omitted.",
].join("\n");

export const inspectEntityTools: SolanaTool[] = [
  {
    title: "inspect_entity",
    description: INSPECT_ENTITY_DESCRIPTION,
    parameters: inspectEntityInputSchema,
    annotations: {
      title: "Inspect Solana Entity",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    func: async input => handleInspectEntity(input),
  },
];
