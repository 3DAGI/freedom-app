/**
 * A-21c: kit fragt die Kette nur über den RpcPool (`poolRpc()`). Geprüft wird der ganze
 * Weg – kit baut die Anfrage, der Pool sendet und weicht aus, kit liest die Antwort: BigInt
 * geht als Zahl hinaus, ein fachlicher Fehler der Kette bleibt beim ersten Endpunkt und kommt
 * als `SolanaError` mit Code zurück, ein toter Endpunkt wird übersprungen, ohne Endpunkt
 * bleibt es `rpc-unerreichbar`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSolanaError, SOLANA_ERROR__JSON_RPC__INVALID_PARAMS } from "@solana/kit";
import { Keypair } from "@solana/web3.js";
import { leseGuthaben, leseKonto, leseProgrammKonten, poolRpc } from "../src/kit-rpc.js";
import { RpcPool } from "../src/rpc-pool.js";
import { ProtokollFehler } from "../src/fehler.js";

type Aufruf = { url: string; method: string; params: unknown[] };
const E = (n: number) => `https://rpc${n}.test`;

/** Endpunkte als Attrappe: „tot“ (Netzfehler), „fehler“ (Fehler der Kette) oder eine Antwort je Methode. */
function pool(verhalten: Record<string, "tot" | "fehler" | ((method: string, params: unknown[]) => unknown)>, log: Aufruf[] = []) {
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const { id, method, params } = JSON.parse(String(init!.body)) as Aufruf & { id: number };
    log.push({ url: String(url), method, params });
    const v = verhalten[String(url)];
    if (!v || v === "tot") throw new TypeError("fetch failed");
    if (v === "fehler") return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid param", data: { grund: "x" } } }));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: v(method, params) }));
  }) as typeof fetch;
  return new RpcPool(Object.keys(verhalten).map((url) => ({ url })), { fetchImpl });
}

const adr = () => Keypair.generate().publicKey.toBase58();
const konto = (daten: Buffer, owner: string, executable = false) => ({
  data: [daten.toString("base64"), "base64"], executable, lamports: 2_039_280, owner, rentEpoch: 0, space: daten.length,
});

test("kit über den Pool: Konten eines Programms – BigInt als Zahl hinaus, Bytes und BigInt zurück", async () => {
  const [programm, provider, k1] = [adr(), adr(), adr()];
  const log: Aufruf[] = [];
  const p = pool({ [E(1)]: () => [{ pubkey: k1, account: konto(Buffer.from([1, 2, 3]), programm) }] }, log);
  const konten = await leseProgrammKonten(poolRpc(p), programm, { groesse: 3, adresseAb: { ab: 40, adresse: provider } });
  assert.deepEqual(konten, [{ adresse: k1, daten: new Uint8Array([1, 2, 3]), eigentuemer: programm, ausfuehrbar: false, lamports: 2_039_280n }]);
  assert.deepEqual(log, [{
    url: E(1), method: "getProgramAccounts",
    params: [programm, { encoding: "base64", commitment: "confirmed", filters: [{ dataSize: 3 }, { memcmp: { offset: 40, bytes: provider, encoding: "base58" } }] }],
  }]);
});

test("kit über den Pool: Konto, Guthaben, fehlendes Konto; eine ungültige Adresse fragt gar nicht erst", async () => {
  const [a, owner] = [adr(), adr()];
  const log: Aufruf[] = [];
  const p = pool({
    [E(1)]: (method, params) => method === "getBalance"
      ? { context: { slot: 1 }, value: 1_500_000_000 }
      : { context: { slot: 1 }, value: params[0] === a ? konto(Buffer.alloc(0), owner, true) : null },
  }, log);
  const rpc = poolRpc(p);
  assert.deepEqual(await leseKonto(rpc, a), { daten: new Uint8Array(0), eigentuemer: owner, ausfuehrbar: true, lamports: 2_039_280n });
  assert.equal(await leseKonto(rpc, adr()), null);
  assert.equal(await leseGuthaben(rpc, a), 1_500_000_000n);
  assert.deepEqual(log.map((x) => x.params), [
    [a, { encoding: "base64", commitment: "confirmed" }], [log[1]!.params[0], { encoding: "base64", commitment: "confirmed" }], [a, { commitment: "confirmed" }],
  ]);
  await assert.rejects(leseKonto(rpc, "keine-adresse"));
  await assert.rejects(leseProgrammKonten(rpc, a, { groesse: 1, adresseAb: { ab: 0, adresse: "keine-adresse" } }));
  assert.equal(log.length, 3, "keine Anfrage mit kaputter Adresse");
});

test("kit über den Pool: toter Endpunkt wird übersprungen, ein Fehler der Kette nicht – er kommt als SolanaError mit Code", async () => {
  const a = adr();
  const log: Aufruf[] = [];
  const guthaben = () => ({ context: { slot: 1 }, value: 7 });
  assert.equal(await leseGuthaben(poolRpc(pool({ [E(1)]: "tot", [E(2)]: guthaben }, log)), a), 7n);
  assert.deepEqual(log.map((x) => x.url), [E(1), E(2)]);

  const log2: Aufruf[] = [];
  const fehler = await leseGuthaben(poolRpc(pool({ [E(1)]: "fehler", [E(2)]: guthaben }, log2)), a).then(() => undefined, (e: unknown) => e);
  assert.ok(isSolanaError(fehler, SOLANA_ERROR__JSON_RPC__INVALID_PARAMS), String(fehler));
  assert.deepEqual(log2.map((x) => x.url), [E(1)], "derselbe Fehler käme überall – nicht weiterreichen");

  const weg = await leseGuthaben(poolRpc(pool({ [E(1)]: "tot", [E(2)]: "tot" })), a).then(() => undefined, (e: unknown) => e);
  assert.ok(weg instanceof ProtokollFehler && weg.kennung === "rpc-unerreichbar", String(weg));
});
