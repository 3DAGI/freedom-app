/**
 * „In Bitcoin verankert“ (Schritt 5.10b, B-17b2) gegen die Referenz: der echte
 * Blockkopf zu Block 970158 (von mempool.space und blockstream.info gleich),
 * gegen den python-opentimestamps den Beweis von B-17b1 prüft, und der
 * Genesis-Block – nachgerechnet mit python-bitcoinlib
 * (`scripts/ots-referenz.py`). Die Explorer ersetzt eine Attrappe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { BLOCKKOPF_GRENZEN, OTS_EXPLORER, leseBlockkopf, pruefeVerankerung } from "../src/ots-bitcoin.js";
import type { OtsHolen } from "../src/ots-kalender.js";
import { OtsFehler, leseOtsZeitstempel, type OtsZeitstempel } from "../src/ots.js";

interface Kopf { hash: string; kopf: string; zeit: number; bits: number }
const REF = JSON.parse(readFileSync(new URL("./fixtures/ots-referenz.json", import.meta.url), "utf8")) as {
  digest: string;
  alleOps: { nachricht: string; bytes: string };
  nachreichung: { vorher: string; nachher: string };
  blockkopf: Kopf & { hoehe: number; wurzel: string; genesis: Kopf };
};
const K = REF.blockkopf;
const fehler = (kennung: string) => (e: unknown) => e instanceof OtsFehler && e.kennung === kennung;
const beweis = (hex: string): OtsZeitstempel => leseOtsZeitstempel(hexToBytes(hex), hexToBytes(REF.digest));

/** Esplora-Attrappe: je Explorer eine Karte Höhe → Kopf; hält jede Anfrage fest. */
function explorer(je: Record<string, (hoehe: number) => Kop | undefined>): { holen: OtsHolen; anfragen: { url: string; init: RequestInit }[] } {
  const anfragen: { url: string; init: RequestInit }[] = [];
  const holen: OtsHolen = async (url, init) => {
    anfragen.push({ url, init });
    const basis = Object.keys(je).find((b) => url.startsWith(`${b}/`));
    if (!basis) return new Response("unbekannt", { status: 404 });
    const rest = url.slice(basis.length);
    const h = /^\/block-height\/(\d+)$/.exec(rest);
    if (h) { const k = je[basis]!(Number(h[1])); return k ? new Response(k.hash) : new Response("Block not found", { status: 404 }); }
    const b = /^\/block\/([0-9a-f]{64})\/header$/.exec(rest);
    for (const n of [0, 970158, 123456]) { const k = je[basis]!(n); if (b && k?.hash === b[1]) return new Response(k.kopf); }
    return new Response("Block not found", { status: 404 });
  };
  return { holen, anfragen };
}
type Kop = { hash: string; kopf: string };
const [MEMPOOL, BLOCKSTREAM] = OTS_EXPLORER as [string, string];
const beide = (f: (hoehe: number) => Kop | undefined) => ({ [MEMPOOL]: f, [BLOCKSTREAM]: f });

test("Blockkopf: Hash, Zeit, Ziel und Wurzel wie python-bitcoinlib – 970158 und Genesis", () => {
  const k = leseBlockkopf(hexToBytes(K.kopf));
  assert.deepEqual({ hash: k.hash, zeit: k.zeit, bits: k.bits, wurzel: bytesToHex(k.wurzel) }, { hash: K.hash, zeit: K.zeit, bits: K.bits, wurzel: K.wurzel });
  const g = leseBlockkopf(hexToBytes(K.genesis.kopf));
  assert.deepEqual({ hash: g.hash, zeit: g.zeit, bits: g.bits }, { hash: K.genesis.hash, zeit: K.genesis.zeit, bits: K.genesis.bits });
  assert.equal(g.hash, "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f");
});

test("Blockkopf prüft sich selbst: Länge, Ziel des Hauptnetzes, Arbeit", () => {
  const kopf = hexToBytes(K.kopf);
  assert.throws(() => leseBlockkopf(kopf.slice(0, 79)), fehler("blockkopf-laenge"));
  const nonce = Uint8Array.from(kopf); nonce[79] ^= 1;
  assert.throws(() => leseBlockkopf(nonce), fehler("blockkopf-arbeit"), "eine andere Nonce: keine Arbeit mehr");
  const regtest = Uint8Array.from(kopf); new DataView(regtest.buffer).setUint32(72, 0x207fffff, true);
  assert.throws(() => leseBlockkopf(regtest), fehler("blockkopf-ziel"), "leichteres Ziel als das Hauptnetz");
  const negativ = Uint8Array.from(kopf); new DataView(negativ.buffer).setUint32(72, 0x1d80ffff, true);
  assert.throws(() => leseBlockkopf(negativ), fehler("blockkopf-ziel"));
  const leer = Uint8Array.from(kopf); new DataView(leer.buffer).setUint32(72, 0x1d000000, true);
  assert.throws(() => leseBlockkopf(leer), fehler("blockkopf-ziel"));
});

test("Beweis vom 06.10. gegen Bitcoin: beide Explorer gleich → verankert in Block 970158", async () => {
  const { holen, anfragen } = explorer(beide((h) => (h === 970158 ? K : undefined)));
  const r = await pruefeVerankerung(beweis(REF.nachreichung.nachher), { holen });
  assert.deepEqual(r, { ok: true, hoehe: 970158, zeit: K.zeit, blockHash: K.hash });
  assert.deepEqual(anfragen.map((a) => a.url).sort(), [
    `${BLOCKSTREAM}/block-height/970158`, `${BLOCKSTREAM}/block/${K.hash}/header`,
    `${MEMPOOL}/block-height/970158`, `${MEMPOOL}/block/${K.hash}/header`,
  ]);
  for (const { init } of anfragen) {
    assert.equal(init.method, "GET");
    assert.equal(init.headers, undefined, "einfache Anfrage – nur die Höhe geht hinaus, nie der Beweis");
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.referrerPolicy, "no-referrer");
  }
});

test("Keine Aussage ohne beide Explorer: einer fehlt, lügt beim Hash, liefert Unsinn oder zu viel", async () => {
  const z = beweis(REF.nachreichung.nachher);
  const nurMempool = explorer({ [MEMPOOL]: (h) => (h === 970158 ? K : undefined), [BLOCKSTREAM]: () => undefined });
  assert.deepEqual(await pruefeVerankerung(z, { holen: nurMempool.holen }), { ok: false, fall: "nicht-erreichbar" });
  // Kopf passt nicht zum genannten Hash
  const falscherHash = explorer({ [MEMPOOL]: () => K, [BLOCKSTREAM]: () => ({ hash: K.genesis.hash, kopf: K.kopf }) });
  assert.deepEqual(await pruefeVerankerung(z, { holen: falscherHash.holen }), { ok: false, fall: "nicht-erreichbar" });
  // zu große Antwort
  const gross: OtsHolen = async (url) => (url.includes("/block-height/") ? new Response(K.hash + " ".repeat(BLOCKKOPF_GRENZEN.hashBytes)) : new Response(K.kopf));
  assert.deepEqual(await pruefeVerankerung(z, { holen: gross }), { ok: false, fall: "nicht-erreichbar" });
  // Netz weg
  const weg: OtsHolen = async () => { throw new TypeError("Netz"); };
  assert.deepEqual(await pruefeVerankerung(z, { holen: weg }), { ok: false, fall: "nicht-erreichbar" });
  // nur ein Explorer eingestellt (oder zweimal derselbe)
  const einer = explorer(beide(() => K));
  assert.deepEqual(await pruefeVerankerung(z, { holen: einer.holen, explorer: [MEMPOOL, `${MEMPOOL}/`] }), { ok: false, fall: "nicht-erreichbar" });
  assert.equal(einer.anfragen.length, 0);
});

test("Explorer uneinig, falsche Wurzel, kein Bitcoin – je ohne Aussage über die Zeit", async () => {
  const z = beweis(REF.nachreichung.nachher);
  const uneinig = explorer({ [MEMPOOL]: () => K, [BLOCKSTREAM]: () => K.genesis });
  assert.deepEqual(await pruefeVerankerung(z, { holen: uneinig.holen }), { ok: false, fall: "uneinig" });
  // Beweis nennt Höhe 123456 mit einem anderen Wert: beide Explorer einig, Wurzel passt nicht
  const fremd = leseOtsZeitstempel(hexToBytes(REF.alleOps.bytes), hexToBytes(REF.alleOps.nachricht));
  const einig = explorer(beide(() => K));
  assert.deepEqual(await pruefeVerankerung(fremd, { holen: einig.holen }), { ok: false, fall: "falsche-wurzel" });
  // nur ausstehende Versprechen: kein Explorer wird gefragt
  const still = explorer(beide(() => K));
  assert.deepEqual(await pruefeVerankerung(beweis(REF.nachreichung.vorher), { holen: still.holen }), { ok: false, fall: "keine-bitcoin" });
  assert.equal(still.anfragen.length, 0);
});
