import { AnchorProvider, type Idl, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";

import { RPC_REQUEST_TIMEOUT_MS, type SupportedCluster } from "./constants";
import { resolveRpcEndpoint } from "./rpc";

const READONLY_WALLET_KEYPAIR = Keypair.generate();

class ReadOnlyWallet {
  get publicKey(): PublicKey {
    return READONLY_WALLET_KEYPAIR.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return txs;
  }
}

export function createReadOnlyProvider(cluster: SupportedCluster): AnchorProvider {
  const endpoint = resolveRpcEndpoint(cluster);
  const connection = new Connection(endpoint, {
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        signal: AbortSignal.timeout(RPC_REQUEST_TIMEOUT_MS),
      }),
  });
  return new AnchorProvider(connection, new ReadOnlyWallet(), {});
}

export async function fetchAnchorIdl(programId: string, provider: AnchorProvider): Promise<Idl | null> {
  return Program.fetchIdl<Idl>(new PublicKey(programId), provider);
}

export async function createAnchorProgram(idl: Idl, provider: AnchorProvider): Promise<Program<Idl>> {
  return new Program(idl, provider);
}
