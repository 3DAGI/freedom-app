/**
 * Solana-RPC über `@solana/kit` auf dem `RpcPool` (A-21c, `docs/KIT-PLAN.md`): kit baut die
 * Anfragen und liest die Antworten, gesendet wird nur über den Pool – mit Ausweichen, Sperrfrist
 * und eigenen Endpunkten zuerst; die Stichprobe (5.8) bleibt beim Pool. Lesepfade (Sperren,
 * Deposits, Kanäle) nehmen eine `SolRpc`; die Schreibpfade folgen mit A-21d/e.
 */
import { address, createSolanaRpcFromTransport, type Base58EncodedBytes, type Rpc, type RpcTransport, type SolanaRpcApi } from "@solana/kit";
import type { RpcPool } from "./rpc-pool.js";

export type SolRpc = Rpc<SolanaRpcApi>;

/** BigInt aus kit als Zahl – größere als 2^53 hält kit schon vorher an (`onIntegerOverflow`). */
function alsJson(x: unknown): unknown {
  if (typeof x === "bigint") {
    if (x > BigInt(Number.MAX_SAFE_INTEGER) || x < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError("Ganzzahl zu groß für JSON");
    return Number(x);
  }
  if (Array.isArray(x)) return x.map(alsJson);
  if (x !== null && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype) {
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, alsJson(v)]));
  }
  return x;
}

/**
 * Transport für kit: jede Anfrage über `pool.call()`. Fachliche Fehler der Kette gehen als
 * JSON-RPC-Fehler zurück (kit macht daraus seinen `SolanaError`); ist kein Endpunkt erreichbar,
 * wirft der Pool wie bisher `rpc-unerreichbar`. Ganzzahlen über 2^53 (etwa `rentEpoch` =
 * u64::MAX) kommen wie bei web3.js gerundet an – die Lesepfade hier nutzen keine.
 */
export function poolTransport(pool: RpcPool): RpcTransport {
  return (async ({ payload }: { payload: unknown }) => {
    const { id, method, params } = payload as { id: string; method: string; params?: unknown[] };
    try {
      return { jsonrpc: "2.0", id, result: await pool.call(method, alsJson(params ?? []) as unknown[]) };
    } catch (e) {
      const f = e as Error & { rpcLevel?: boolean; code?: number; data?: unknown };
      if (!f.rpcLevel) throw e;
      return { jsonrpc: "2.0", id, error: { code: f.code ?? -32603, message: f.message, data: f.data } };
    }
  }) as RpcTransport;
}

/** kit-RPC auf dem Pool – der einzige Weg, auf dem kit die Kette fragt. */
export function poolRpc(pool: RpcPool): SolRpc {
  return createSolanaRpcFromTransport(poolTransport(pool));
}

/** Ein Konto, wie die Lesepfade es brauchen: Daten als Bytes, Beträge als BigInt. */
export interface SolKonto {
  daten: Uint8Array;
  eigentuemer: string;
  ausfuehrbar: boolean;
  lamports: bigint;
}

function kontoAus(k: { data: readonly [string, string]; owner: string; executable: boolean; lamports: bigint }): SolKonto {
  return { daten: new Uint8Array(Buffer.from(k.data[0], "base64")), eigentuemer: k.owner, ausfuehrbar: k.executable, lamports: k.lamports };
}

/** Ein Konto der Kette (bestätigt); null, solange es nicht besteht. Die Adresse prüft `address()`. */
export async function leseKonto(rpc: SolRpc, adresse: string): Promise<SolKonto | null> {
  const { value } = await rpc.getAccountInfo(address(adresse), { encoding: "base64", commitment: "confirmed" }).send();
  return value ? kontoAus(value) : null;
}

/**
 * Konten eines Programms mit genau dieser Größe und – wahlweise – dieser Adresse an einer Stelle
 * (beide prüft `address()`). Der RPC filtert; was er liefert, muss der Aufrufer selbst prüfen.
 */
export async function leseProgrammKonten(
  rpc: SolRpc, programm: string, filter: { groesse: number; adresseAb?: { ab: number; adresse: string } },
): Promise<Array<SolKonto & { adresse: string }>> {
  const a = filter.adresseAb;
  const gleich = a ? [{ memcmp: { offset: BigInt(a.ab), bytes: address(a.adresse) as string as Base58EncodedBytes, encoding: "base58" as const } }] : [];
  const konten = await rpc.getProgramAccounts(address(programm), {
    encoding: "base64", commitment: "confirmed", filters: [{ dataSize: BigInt(filter.groesse) }, ...gleich],
  }).send();
  return konten.map((k) => ({ adresse: k.pubkey, ...kontoAus(k.account) }));
}

/** Guthaben in Lamports (bestätigt). */
export async function leseGuthaben(rpc: SolRpc, adresse: string): Promise<bigint> {
  return (await rpc.getBalance(address(adresse), { commitment: "confirmed" }).send()).value;
}
