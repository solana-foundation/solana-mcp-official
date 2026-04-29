export type SectionId =
  | "core"
  | "programs"
  | "frameworks"
  | "clients"
  | "tokens"
  | "nft"
  | "defi"
  | "liquid-staking"
  | "oracles"
  | "infra"
  | "data"
  | "wallets"
  | "mobile"
  | "governance"
  | "testing"
  | "tooling"
  | "zk"
  | "bridges"
  | "identity"
  | "examples"
  | "vm";

export const SECTION_IDS: readonly SectionId[] = [
  "core",
  "programs",
  "frameworks",
  "clients",
  "tokens",
  "nft",
  "defi",
  "liquid-staking",
  "oracles",
  "infra",
  "data",
  "wallets",
  "mobile",
  "governance",
  "testing",
  "tooling",
  "zk",
  "bridges",
  "identity",
  "examples",
  "vm",
] as const;

export const SECTION_DESCRIPTIONS: Readonly<Record<SectionId, string>> = {
  core: "Solana protocol fundamentals (accounts, txs, fees, rent, sysvars).",
  programs: "Writing on-chain programs (any framework).",
  frameworks: "Anchor, Pinocchio, Steel, native program patterns.",
  clients: "RPC, signers, tx building, off-chain SDKs.",
  tokens: "SPL token, token-2022, ATA, token metadata.",
  nft: "NFT standards, marketplaces, compressed NFTs.",
  defi: "AMMs, perps, lending, aggregators, yield.",
  "liquid-staking": "Stake pools, LST routers, restaking.",
  oracles: "Price feeds, randomness, off-chain data.",
  infra: "RPC providers, validators, block engines.",
  data: "Explorers, indexers, on-chain analytics.",
  wallets: "Wallet adapters, MWA, multisig signers.",
  mobile: "Solana Mobile, MWA, dApp store.",
  governance: "DAOs, multisig, voting, treasury.",
  testing: "Local validators, simulation harnesses.",
  tooling: "CLI, IDL gen, codama, helpers, dev utilities.",
  zk: "ZK compression, light protocol, ZK programs.",
  bridges: "Cross-chain bridges, token portals.",
  identity: "Attestation, proof-of-identity, on-chain records.",
  examples: "Tutorial repos, reference programs.",
  vm: "Sealevel, sBPF asm, firedancer internals.",
};

export interface RawSource {
  readonly id: string;
  readonly name: string;
  readonly kind: "github" | "web" | "openapi";
  readonly enabled: boolean;
  readonly primary_url: string;
  readonly sections: readonly SectionId[];
  readonly use_cases: string;
}
