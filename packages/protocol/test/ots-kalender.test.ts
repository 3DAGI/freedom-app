/**
 * OpenTimestamps-Kalender und NIP-03 (Schritt 5.10b, B-17b1) gegen die
 * Referenz: echte Antworten von alice, bob und finney, die echte
 * Nachreichung bei alice bis Bitcoin-Block 970158 – nachgerechnet mit
 * python-opentimestamps (`scripts/ots-referenz.py`). Das Netz ersetzt eine
 * Attrappe, die jede Anfrage festhält.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { OTS_KALENDER, OTS_KALENDER_GRENZEN, reicheNach, stempele, type OtsHolen } from "../src/ots-kalender.js";
import { KIND_OTS_BEWEIS, baueOtsBeweis, leseOtsBeweis } from "../src/ots-nip03.js";
import { OtsFehler, attestierungenVon, leseOtsZeitstempel, schreibeOtsDatei, schreibeOtsZeitstempel, type OtsZeitstempel } from "../src/ots.js";
import type { NostrEvent } from "../src/event.js";

type Att = [string, string, string | number];
const REF = JSON.parse(readFileSync(new URL("./fixtures/ots-referenz.json", import.meta.url), "utf8")) as {
  digest: string;
  kalender: { name: string; antwort: string }[];
  buendel: { blaetter: string[]; nonces: string[]; spitze: string };
  stempel: { dateien: string[] };
  nachreichung: { vorher: string; commitment: string; antwort: string; nachher: string; attestierungen: Att[]; nurBitcoin: string };
};
const [ALICE, BOB, FINNEY] = OTS_KALENDER as [string, string, string];
const antwortVon = (host: string) => hexToBytes(REF.kalender.find((k) => k.name === host)!.antwort);
const fehler = (kennung: string) => (e: unknown) => e instanceof OtsFehler && e.kennung === kennung;
const alsListe = (z: OtsZeitstempel): Att[] =>
  attestierungenVon(z)
    .map(({ nachricht, attestierung: a }): Att => [bytesToHex(nachricht), a.art, a.art === "bitcoin" ? a.hoehe : a.art === "ausstehend" ? a.kalender : ""])
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));

interface Anfrage { url: string; init: RequestInit }
function attrappe(antwort: (url: string, init: RequestInit) => Response | Promise<Response>): { holen: OtsHolen; anfragen: Anfrage[] } {
  const anfragen: Anfrage[] = [];
  return { anfragen, holen: async (url, init) => { anfragen.push({ url, init }); return antwort(url, init); } };
}
const ok = (b: Uint8Array) => new Response(Uint8Array.from(b), { status: 200 });
const nonces = () => { const n = REF.buendel.nonces.map(hexToBytes); let i = 0; return () => n[i++]!; };
const blaetter = () => REF.buendel.blaetter.map(hexToBytes);

test("Stempeln bei alice, bob und finney: nur die Spitze geht hinaus, Antworten byte-gleich mit der Referenz zusammengeführt", async () => {
  const { holen, anfragen } = attrappe((url) => ok(antwortVon(new URL(url).host)));
  const s = await stempele(blaetter(), { holen, nonce: nonces() });
  assert.deepEqual(s.kalender, [ALICE, BOB, FINNEY]);
  assert.deepEqual(s.dateien.map((d) => bytesToHex(schreibeOtsDatei(d))), REF.stempel.dateien);
  assert.deepEqual(anfragen.map((a) => a.url).sort(), OTS_KALENDER.map((k) => `${k}/digest`).sort());
  for (const { init } of anfragen) {
    assert.equal(init.method, "POST");
    assert.equal(bytesToHex(init.body as Uint8Array), REF.buendel.spitze, "nur die Spitze, nie ein Wert");
    // „einfache“ Anfrage: kein Content-Type, sonst verlangte der Browser einen Preflight, den kein Kalender beantwortet
    assert.deepEqual(init.headers, { Accept: "application/vnd.opentimestamps.v1" });
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.equal(init.referrerPolicy, "no-referrer");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
  }
});

test("Unter zwei Antworten kein Stempel – eine Antwort zählt nur mit dem Versprechen genau dieses Kalenders", async () => {
  const mit = (f: (host: string) => Response) => attrappe((url) => f(new URL(url).host)).holen;
  const alice = new URL(ALICE).host, bob = new URL(BOB).host;
  await assert.rejects(stempele(blaetter(), { holen: mit((h) => (h === alice ? ok(antwortVon(h)) : h === bob ? new Response("kaputt", { status: 500 }) : (() => { throw new TypeError("Netz"); })())) }), fehler("zu-wenige-kalender"));
  // bob schickt finneys Versprechen, finney eine zu große Antwort: beides zählt nicht
  const zuGross = new Uint8Array(OTS_KALENDER_GRENZEN.antwortBytes + 1);
  await assert.rejects(stempele(blaetter(), { holen: mit((h) => (h === alice ? ok(antwortVon(h)) : h === bob ? ok(antwortVon("finney.calendar.eternitywall.com")) : ok(zuGross))) }), fehler("zu-wenige-kalender"));
  // Unsinn von finney: Stempel mit alice und bob
  const s = await stempele(blaetter(), { holen: mit((h) => (h === alice || h === bob ? ok(antwortVon(h)) : ok(Uint8Array.of(0x42)))) });
  assert.deepEqual(s.kalender, [ALICE, BOB]);
  assert.ok(attestierungenVon(s.dateien[0]!.zeitstempel).every(({ attestierung: a }) => a.art === "ausstehend" && a.kalender !== FINNEY));
  await assert.rejects(stempele([], { holen: mit(() => ok(new Uint8Array(0))) }), fehler("leeres-buendel"));
});

test("Nachreichen: alice liefert Bitcoin-Block 970158, bob und finney warten – byte-gleich mit der Referenz", async () => {
  const d = hexToBytes(REF.digest);
  const z = leseOtsZeitstempel(hexToBytes(REF.nachreichung.vorher), d);
  const { holen, anfragen } = attrappe((url) =>
    new URL(url).host === new URL(ALICE).host ? ok(hexToBytes(REF.nachreichung.antwort)) : new Response("Timestamped by transaction; waiting for 6 confirmations", { status: 404 }));
  const r = await reicheNach(z, { holen });
  assert.deepEqual(r, { neu: true, bitcoin: [970158], wartend: [BOB, FINNEY] });
  assert.equal(bytesToHex(schreibeOtsZeitstempel(z)), REF.nachreichung.nachher);
  assert.deepEqual(alsListe(z), REF.nachreichung.attestierungen);
  assert.equal(anfragen.length, 3);
  assert.ok(anfragen.some((a) => a.url === `${ALICE}/timestamp/${REF.nachreichung.commitment}`));
  assert.ok(anfragen.every((a) => a.init.method === "GET" && a.init.redirect === "error" && a.init.credentials === "omit"));
  // Fertig: kein zweites Mal fragen
  const danach = attrappe(() => ok(new Uint8Array(0)));
  assert.deepEqual(await reicheNach(z, { holen: danach.holen }), { neu: false, bitcoin: [970158], wartend: [] });
  assert.equal(danach.anfragen.length, 0);
});

test("Nachreichen fragt nur Kalender aus der Liste, höchstens acht, und übernimmt nur Lesbares", async () => {
  const d = hexToBytes(REF.digest);
  const knoten = (kalender: string[]): OtsZeitstempel => ({
    nachricht: d, attestierungen: [],
    zweige: kalender.map((k, i) => ({ op: { art: "append", arg: Uint8Array.of(i) }, weiter: { nachricht: Uint8Array.from([...d, i]), attestierungen: [{ art: "ausstehend", kalender: k }], zweige: [] } })),
  });
  const fremd = attrappe(() => ok(new Uint8Array(0)));
  const z1 = knoten(["https://a.pool.opentimestamps.org", "https://evil.example"]);
  assert.deepEqual(await reicheNach(z1, { holen: fremd.holen }), { neu: false, bitcoin: [], wartend: [] });
  assert.equal(fremd.anfragen.length, 0, "fremde Adressen im Beweis werden nie gefragt");
  const viele = attrappe(() => new Response(null, { status: 404 }));
  assert.deepEqual(await reicheNach(knoten(Array(10).fill(ALICE)), { holen: viele.holen }), { neu: false, bitcoin: [], wartend: [ALICE] });
  assert.equal(viele.anfragen.length, 8);
  const unsinn = attrappe(() => ok(Uint8Array.of(0x42)));
  const z3 = knoten([`${BOB}/`]);
  assert.deepEqual(await reicheNach(z3, { holen: unsinn.holen }), { neu: false, bitcoin: [], wartend: [] });
  assert.equal(unsinn.anfragen[0]!.url.startsWith(`${BOB}/timestamp/`), true, "Schrägstrich am Ende ändert nichts");
});

test("NIP-03: nur der Weg zu Bitcoin, byte-gleich mit der Referenz, streng gelesen", () => {
  const d = hexToBytes(REF.digest);
  const datei = { digest: d, zeitstempel: leseOtsZeitstempel(hexToBytes(REF.nachreichung.nachher), d) };
  const autor = "ab".repeat(32);
  const ev = baueOtsBeweis(autor, { id: REF.digest, kind: 38067 }, datei, 1_790_000_000);
  assert.equal(ev.kind, KIND_OTS_BEWEIS);
  assert.deepEqual(ev.tags, [["e", REF.digest], ["k", "38067"]]);
  assert.equal(bytesToHex(Uint8Array.from(atob(ev.content), (c) => c.charCodeAt(0))), REF.nachreichung.nurBitcoin);
  const signiert = (e: { kind: number; tags: string[][]; content: string }): NostrEvent => ({ ...ev, ...e, id: "00".repeat(32), sig: "00".repeat(64) });
  const b = leseOtsBeweis(signiert(ev));
  assert.deepEqual({ eventId: b.eventId, kind: b.kind, hoehe: b.hoehe }, { eventId: REF.digest, kind: 38067, hoehe: 970158 });
  assert.equal(bytesToHex(schreibeOtsDatei(b.datei)), REF.nachreichung.nurBitcoin);

  // Bauen nur mit Bitcoin und nur für die bewiesene Kennung
  const offen = { digest: d, zeitstempel: leseOtsZeitstempel(hexToBytes(REF.nachreichung.vorher), d) };
  assert.throws(() => baueOtsBeweis(autor, { id: REF.digest, kind: 38067 }, offen), fehler("nicht-verankert"));
  assert.throws(() => baueOtsBeweis(autor, { id: "11".repeat(32), kind: 38067 }, datei), fehler("anderes-event"));
  assert.throws(() => baueOtsBeweis(autor, { id: REF.digest, kind: 70000 }, datei), fehler("art"));

  // Lesen: Art, Tags, Base64, Größe, Kennung, nur ausstehend
  const b64 = (x: Uint8Array) => btoa(String.fromCharCode(...x));
  assert.throws(() => leseOtsBeweis(signiert({ ...ev, kind: 1 })), fehler("kein-beweis"));
  assert.throws(() => leseOtsBeweis(signiert({ ...ev, tags: [["e", REF.digest], ["e", REF.digest], ["k", "1"]] })), fehler("anderes-event"));
  assert.throws(() => leseOtsBeweis(signiert({ ...ev, tags: [["e", REF.digest.toUpperCase()], ["k", "1"]] })), fehler("anderes-event"));
  assert.throws(() => leseOtsBeweis(signiert({ ...ev, tags: [["e", REF.digest]] })), fehler("art"));
  assert.throws(() => leseOtsBeweis(signiert({ ...ev, tags: [["e", REF.digest], ["k", "abc"]] })), fehler("art"));
  assert.throws(() => leseOtsBeweis(signiert({ ...ev, content: "@@@@" })), fehler("base64"));
  assert.throws(() => leseOtsBeweis(signiert({ ...ev, content: "A".repeat(100_000) })), fehler("zu-gross"));
  assert.throws(() => leseOtsBeweis(signiert({ ...ev, tags: [["e", "11".repeat(32)], ["k", "38067"]] })), fehler("anderes-event"));
  assert.throws(() => leseOtsBeweis(signiert({ ...ev, content: b64(schreibeOtsDatei(offen)) })), fehler("nicht-verankert"));
  assert.throws(() => leseOtsBeweis(signiert({ ...ev, content: b64(new TextEncoder().encode("hallo")) })), fehler("zu-kurz"));
});
