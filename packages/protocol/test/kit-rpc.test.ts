/**
 * A-21c: kit fragt die Kette nur über den RpcPool (`poolRpc()`). Geprüft wird der ganze
 * Weg – kit baut die Anfrage, der Pool sendet und weicht aus, kit liest die Antwort: BigInt
 * geht als Zahl hinaus, ein fachlicher Fehler der Kette bleibt beim ersten Endpunkt und kommt
 * als `SolanaError` mit Code zurück, ein toter Endpunkt wird übersprungen, ohne Endpunkt
 * bleibt es `rpc-unerreichbar`. Seit A-21d3a ebenso senden (Base64, immer mit Vorabsimulation) und
 * bestätigen durch Nachfragen bis zur letzten Blockhöhe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getBase58Decoder, isSolanaError, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM, SOLANA_ERROR__JSON_RPC__INVALID_PARAMS,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
} from "@solana/kit";
import { Keypair } from "@solana/web3.js";
import {
  leseGuthaben, leseKonto, leseProgrammKonten, neuesterBlockhash, poolRpc, sendeTransaktion, txFehlerText, warteAufBestaetigung,
} from "../src/kit-rpc.js";
import { alsDraht, baueTransaktion, neuerKontoSchluessel, signiereMit } from "../src/kit-transaktion.js";
import { erstatteKanalAnweisung } from "../src/channel.js";
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

// ── A-21d3a: senden und bestätigen über den Pool ──────────────────────────────────────────────

const signierte = () => {
  const zahler = neuerKontoSchluessel();
  const tx = baueTransaktion({
    zahler: zahler.adresse, anweisungen: [erstatteKanalAnweisung({ kunde: zahler.adresse, kanal: adr() })],
    lebensdauer: { blockhash: Keypair.generate().publicKey.toBase58(), letzteHoehe: 500n },
  });
  return signiereMit(tx, zahler.geheim)!;
};
const stand = (s: unknown) => ({ context: { slot: 1 }, value: [s] });

test("A-21d3a: Blockhash mit letzter Höhe als BigInt; gesendet wird Base64 mit Vorabsimulation, zurück kommt die Signatur", async () => {
  const tx = signierte();
  const [sig] = Object.values(tx.signatures);
  const signaturText = getBase58Decoder().decode(sig!);
  const log: Aufruf[] = [];
  const rpc = poolRpc(pool({
    [E(1)]: (method) => method === "getLatestBlockhash"
      ? { context: { slot: 1 }, value: { blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM", lastValidBlockHeight: 812 } }
      : signaturText,
  }, log));
  assert.deepEqual(await neuesterBlockhash(rpc), { blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM", letzteHoehe: 812n });
  assert.equal(await sendeTransaktion(rpc, alsDraht(tx)), signaturText);
  assert.deepEqual(log.map((x) => [x.method, x.params]), [
    ["getLatestBlockhash", [{ commitment: "confirmed" }]],
    ["sendTransaction", [Buffer.from(alsDraht(tx)).toString("base64"), { encoding: "base64", preflightCommitment: "confirmed" }]],
  ]);
  assert.ok(!JSON.stringify(log).includes("skipPreflight"));
});

test("A-21d3a: lehnt die Vorabsimulation ab, wirft kit – mit dem Fehler der Kette als Ursache, gesendet nur einmal", async () => {
  const log: Aufruf[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const { id, method, params } = JSON.parse(String(init!.body)) as Aufruf & { id: number };
    log.push({ url: String(url), method, params });
    return new Response(JSON.stringify({
      jsonrpc: "2.0", id,
      error: { code: -32002, message: "Transaction simulation failed", data: { err: { InstructionError: [0, { Custom: 6002 }] }, logs: [], accounts: null, unitsConsumed: 0 } },
    }));
  }) as typeof fetch;
  const rpc = poolRpc(new RpcPool([{ url: E(1) }, { url: E(2) }], { fetchImpl }));
  const f = await sendeTransaktion(rpc, alsDraht(signierte())).then(() => undefined, (e: unknown) => e);
  assert.ok(isSolanaError(f, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE), String(f));
  assert.ok(isSolanaError((f as Error).cause, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM), String((f as Error).cause));
  assert.equal(((f as Error).cause as { context: { code: number } }).context.code, 6002);
  assert.deepEqual(log.map((x) => x.url), [E(1)], "eine Ablehnung der Kette nicht an den nächsten Endpunkt");
});

test("A-21d3a: Bestätigen fragt nach, bis die Kette bestätigt – ohne Fehler null, mit Fehler dieser (BigInt als Zahl im Text)", async () => {
  const sig = getBase58Decoder().decode(new Uint8Array(64).fill(3));
  let runde = 0;
  const pausen: number[] = [];
  const rpc = poolRpc(pool({
    [E(1)]: (method) => {
      if (method === "getBlockHeight") return 100;
      runde++;
      return stand(runde < 3 ? (runde === 1 ? null : { slot: 9, confirmations: 0, err: null, confirmationStatus: "processed" })
        : { slot: 9, confirmations: 1, err: null, confirmationStatus: "confirmed" });
    },
  }));
  assert.equal(await warteAufBestaetigung(rpc, sig, 150n, { abstandMs: 5, warte: async (ms) => { pausen.push(ms); } }), null);
  assert.deepEqual(pausen, [5, 5]);

  const mitFehler = poolRpc(pool({
    [E(1)]: (method) => method === "getBlockHeight" ? 100
      : stand({ slot: 9, confirmations: null, err: { InstructionError: [1, { Custom: 6004 }] }, confirmationStatus: "finalized" }),
  }));
  const err = await warteAufBestaetigung(mitFehler, sig, 150n, { warte: async () => assert.fail("nicht warten") });
  assert.ok(err);
  assert.equal(txFehlerText(err), '{"InstructionError":[1,{"Custom":6004}]}');
  assert.equal(typeof (err as { InstructionError: [bigint | number, { Custom: unknown }] }).InstructionError[1].Custom, "bigint", "kit liefert BigInt");
});

test("A-21d3a: Über der letzten Höhe ohne Bestätigung – tx-abgelaufen; kam sie zwischen beiden Fragen doch, zählt das", async () => {
  const sig = getBase58Decoder().decode(new Uint8Array(64).fill(4));
  const log: Aufruf[] = [];
  const weg = poolRpc(pool({ [E(1)]: (method) => method === "getBlockHeight" ? 151 : stand(null) }, log));
  const f = await warteAufBestaetigung(weg, sig, 150n, { warte: async () => assert.fail("nicht warten") }).then(() => undefined, (e: unknown) => e);
  assert.ok(f instanceof ProtokollFehler && f.kennung === "tx-abgelaufen", String(f));
  assert.deepEqual(log.map((x) => x.method), ["getSignatureStatuses", "getBlockHeight", "getSignatureStatuses"]);
  assert.deepEqual(log[0]!.params, [[sig]]);
  assert.deepEqual(log[1]!.params, [{ commitment: "confirmed" }]);

  let fragen = 0;
  const spaet = poolRpc(pool({
    [E(1)]: (method) => method === "getBlockHeight" ? 151
      : stand(++fragen === 1 ? null : { slot: 9, confirmations: 1, err: null, confirmationStatus: "confirmed" }),
  }));
  assert.equal(await warteAufBestaetigung(spaet, sig, 150n, { warte: async () => assert.fail("nicht warten") }), null);

  // Genau auf der letzten Höhe gilt sie noch
  let hoehe = 150;
  const knapp = poolRpc(pool({ [E(1)]: (method) => method === "getBlockHeight" ? hoehe++ : stand(null) }));
  const g = await warteAufBestaetigung(knapp, sig, 150n, { warte: async () => {} }).then(() => undefined, (e: unknown) => e);
  assert.ok(g instanceof ProtokollFehler && g.kennung === "tx-abgelaufen");
  assert.equal(hoehe, 152, "erst bei 151 aufgegeben");
});
