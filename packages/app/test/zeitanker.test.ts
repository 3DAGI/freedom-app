/**
 * Zeitanker in der App (Schritt 5.10b, B-17b3a): vormerken, stempeln,
 * nachreichen, den Beweis zum Mandat veröffentlichen – mit den echten
 * Kalender-Antworten aus der Referenz (`protocol/test/fixtures/ots-referenz.json`,
 * Bitcoin-Block 970158). Das Netz ersetzt eine Attrappe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_OTS_BEWEIS, OTS_KALENDER, PRIVACY_FACTS, SICHERUNG_NIE, filtereWiederherstellung, leseOtsBeweis, leseOtsZeitstempel,
  reicheNach, type NostrEvent, type OtsHolen, type Quittung, type UnsignedEvent,
} from "@freedomstack/protocol";
import { hexToBytes } from "@noble/hashes/utils.js";
import { EXPORT_ZUSAETZLICH } from "../src/datenexport.js";
import { LS_ZEITANKER, ZEITANKER_GRENZEN, ZeitankerBuch, mitGedaechtnis, quittungsDigest, zeitankerTakt, type ZeitankerDienste } from "../src/zeitanker.js";

const REF = JSON.parse(readFileSync(new URL("../../protocol/test/fixtures/ots-referenz.json", import.meta.url), "utf8")) as {
  digest: string;
  nachreichung: { vorher: string; commitment: string; antwort: string; nurBitcoin: string };
};
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
function speicher(werte: Record<string, string> = {}) {
  const m = new Map(Object.entries(werte));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v), m };
}
const T0 = 1_791_280_000;
const ALICE = OTS_KALENDER[0]!;

/** Kalender-Attrappe: alice reicht Block 970158 nach, die anderen warten noch. */
function kalender(): { holen: OtsHolen; anfragen: string[] } {
  const anfragen: string[] = [];
  return {
    anfragen,
    holen: async (url) => {
      anfragen.push(url);
      return url === `${ALICE}/timestamp/${REF.nachreichung.commitment}`
        ? new Response(Uint8Array.from(hexToBytes(REF.nachreichung.antwort)))
        : new Response("waiting for 6 confirmations", { status: 404 });
    },
  };
}
/** Stempel-Attrappe: der Wert aus der Referenz, so wie alice, bob und finney ihn am 06.10. stempelten. */
const stempelWieAm0610: ZeitankerDienste["stempele"] = async (d) => {
  assert.deepEqual(d.map((x) => Buffer.from(x).toString("hex")), [REF.digest]);
  return { dateien: [{ digest: hexToBytes(REF.digest), zeitstempel: leseOtsZeitstempel(hexToBytes(REF.nachreichung.vorher), hexToBytes(REF.digest)) }], kalender: [...OTS_KALENDER] };
};

test("Quittung: Wert über alle Felder in fester Reihenfolge, ohne den Stand", () => {
  const q: Quittung = { art: "kanal", provider: "ab".repeat(32), auftraege: 1, zeit: 1, stand: "angekuendigt", preisLamports: 5000, kanal: "K", gutschrift: "10", anfrage: "cd".repeat(32) };
  const umgestellt = { anfrage: q.anfrage, gutschrift: q.gutschrift, kanal: q.kanal, preisLamports: 5000, stand: "belegt", zeit: 1, auftraege: 1, provider: q.provider, art: "kanal" } as Quittung;
  assert.match(quittungsDigest(q), /^[0-9a-f]{64}$/);
  assert.equal(quittungsDigest(umgestellt), quittungsDigest(q), "Reihenfolge und Stand ändern den Wert nicht");
  assert.notEqual(quittungsDigest({ ...q, preisLamports: 5001 }), quittungsDigest(q));
});

test("Buch: vormerken ohne Doppel, nur 64 Hex, streng gelesen, höchstens die neuesten", async () => {
  const s = speicher();
  const buch = new ZeitankerBuch(s);
  assert.equal(await buch.vormerken({ art: "mandat", digest: REF.digest, kind: 38067 }, T0), true);
  assert.equal(await buch.vormerken({ art: "mandat", digest: REF.digest, kind: 38067 }, T0 + 5), false, "derselbe Wert bleibt, wie er ist");
  assert.equal(await buch.vormerken({ art: "quittung", digest: "XYZ" }, T0), false);
  assert.equal(await buch.vormerken({ art: "quittung", digest: "ab".repeat(32), kind: 1 }, T0 + 1), true);
  assert.deepEqual(buch.alle().map((a) => [a.art, a.kind]), [["mandat", 38067], ["quittung", undefined]], "eine Quittung trägt keine Art");
  s.m.set(LS_ZEITANKER, JSON.stringify([{ art: "mandat", digest: REF.digest, angelegt: T0, ots: "zz" }, { art: "fremd", digest: REF.digest, angelegt: 1 }, 7]));
  assert.deepEqual(buch.alle(), [{ art: "mandat", digest: REF.digest, angelegt: T0 }], "unlesbares fällt weg");
  s.m.clear();
  for (let i = 0; i < ZEITANKER_GRENZEN.anker + 3; i++) await buch.vormerken({ art: "quittung", digest: i.toString(16).padStart(64, "0") }, T0 + i);
  assert.equal(buch.alle().length, ZEITANKER_GRENZEN.anker);
  assert.equal(buch.alle()[0]!.angelegt, T0 + 3, "die ältesten fallen weg");
  assert.equal(buch.zumStempeln().length, ZEITANKER_GRENZEN.jeStempel, "ein Bündel je Schlag");
});

test("Takt: stempeln, nach einer Stunde Block 970158 nachreichen, dann den Beweis zum Mandat als NIP-03 veröffentlichen", async () => {
  const buch = new ZeitankerBuch(speicher());
  await buch.vormerken({ art: "mandat", digest: REF.digest, kind: 38067 }, T0);
  const k = kalender();
  const gesendet: UnsignedEvent[] = [];
  const dienste = (jetzt: number): ZeitankerDienste => ({
    stempele: stempelWieAm0610, reicheNach: (z, h) => reicheNach(z, { holen: h }), holen: k.holen,
    autor: "ee".repeat(32), veroeffentliche: async (ev) => void gesendet.push(ev), jetzt,
  });
  assert.deepEqual(await zeitankerTakt(buch, dienste(T0)), { gestempelt: 1, nachgereicht: 0, veroeffentlicht: 0 });
  assert.equal(k.anfragen.length, 0, "vor einer Stunde fragt niemand nach");
  assert.deepEqual(await zeitankerTakt(buch, dienste(T0 + 600)), { gestempelt: 0, nachgereicht: 0, veroeffentlicht: 0 });
  assert.deepEqual(await zeitankerTakt(buch, dienste(T0 + 3600)), { gestempelt: 0, nachgereicht: 1, veroeffentlicht: 1 });
  assert.equal(new Set(k.anfragen).size, 3, "alice, bob, finney – je ein Versprechen");
  assert.ok(k.anfragen.every((u) => OTS_KALENDER.some((kal) => u.startsWith(`${kal}/timestamp/`))), "nur Kalender aus der Liste");
  const [anker] = buch.alle();
  assert.equal(anker!.hoehe, 970158);
  assert.equal(anker!.veroeffentlicht, true);
  assert.equal(gesendet.length, 1);
  assert.equal(gesendet[0]!.kind, KIND_OTS_BEWEIS);
  const ev: NostrEvent = { ...gesendet[0]!, id: "00".repeat(32), sig: "00".repeat(64) };
  const b = leseOtsBeweis(ev);
  assert.deepEqual({ eventId: b.eventId, kind: b.kind, hoehe: b.hoehe }, { eventId: REF.digest, kind: 38067, hoehe: 970158 });
  assert.equal(Buffer.from(ev.content, "base64").toString("hex"), REF.nachreichung.nurBitcoin, "nur der Weg zu Bitcoin");
  // Fertig: kein Netz, nichts doppelt
  const vorher = k.anfragen.length;
  assert.deepEqual(await zeitankerTakt(buch, dienste(T0 + 7200)), { gestempelt: 0, nachgereicht: 0, veroeffentlicht: 0 });
  assert.equal(k.anfragen.length, vorher);
  assert.equal(gesendet.length, 1);
});

test("Takt: Quittungen gehen nie hinaus, ohne Identität kein NIP-03, Fehler warten auf den nächsten Schlag", async () => {
  const buch = new ZeitankerBuch(speicher());
  await buch.vormerken({ art: "quittung", digest: REF.digest }, T0);
  const gesendet: UnsignedEvent[] = [];
  const k = kalender();
  const basis = { reicheNach: (z: Parameters<typeof reicheNach>[0], h: OtsHolen) => reicheNach(z, { holen: h }), holen: k.holen };
  // Kalender nicht erreichbar: bleibt vorgemerkt
  assert.deepEqual(await zeitankerTakt(buch, { ...basis, stempele: async () => { throw new Error("zu-wenige-kalender"); }, jetzt: T0 }), { gestempelt: 0, nachgereicht: 0, veroeffentlicht: 0 });
  assert.equal(buch.zumStempeln().length, 1);
  await zeitankerTakt(buch, { ...basis, stempele: stempelWieAm0610, autor: "ee".repeat(32), veroeffentliche: async (ev) => void gesendet.push(ev), jetzt: T0 });
  assert.deepEqual(await zeitankerTakt(buch, { ...basis, stempele: stempelWieAm0610, autor: "ee".repeat(32), veroeffentliche: async (ev) => void gesendet.push(ev), jetzt: T0 + 3600 }), { gestempelt: 0, nachgereicht: 1, veroeffentlicht: 0 });
  assert.equal(gesendet.length, 0, "der Beweis zur Quittung bleibt im Tresor (K3 A)");
  // Mandat als Gerät (ohne Autor): verankert, aber nicht veröffentlicht – das bleibt offen für die Hauptidentität
  const geraet = new ZeitankerBuch(speicher());
  await geraet.vormerken({ art: "mandat", digest: REF.digest, kind: 38067 }, T0);
  await zeitankerTakt(geraet, { ...basis, stempele: stempelWieAm0610, jetzt: T0 });
  await zeitankerTakt(geraet, { ...basis, stempele: stempelWieAm0610, jetzt: T0 + 3600 });
  assert.equal(geraet.zumVeroeffentlichen().length, 1);
});

test("Gedächtnis je Schlag: dieselbe Adresse nur einmal, POST nie aus dem Gedächtnis", async () => {
  let n = 0;
  const h = mitGedaechtnis(async () => { n++; return new Response("x", { status: 404 }); });
  const a = await h("https://alice.btc.calendar.opentimestamps.org/timestamp/ab", { method: "GET" });
  const b = await h("https://alice.btc.calendar.opentimestamps.org/timestamp/ab", { method: "GET" });
  assert.equal(a.status, 404);
  assert.equal(await b.text(), "x");
  assert.equal(n, 1);
  await h("https://alice.btc.calendar.opentimestamps.org/digest", { method: "POST" });
  await h("https://alice.btc.calendar.opentimestamps.org/digest", { method: "POST" });
  assert.equal(n, 3);
});

test("Verdrahtet: Mandat nach dem Veröffentlichen, Quittung nach dem Ablegen, Takt im Abruftakt; Tresor, nie Sicherung, im Export", () => {
  assert.match(src("../src/shell/tabs/sicherung.ts"), /await \(await ensurePool\(\)\)\.publish\(mandat\);\n\s+\/\/[^\n]*\n\s+await ankereMandat\(mandat\);/);
  assert.equal(src("../src/shell/quittungen.ts").match(/quittungsBuch\.lege\(q\)\.then\(\(\) => ankereQuittung\(q\)\)/g)?.length, 2);
  assert.match(src("../src/shell/app.ts"), /abrufTakt\.melde\("zeitanker", \(\) => import\("\.\/zeitanker-takt\.js"\)\.then\(\(z\) => z\.zeitankerSchlag\(\)\), 20\)/);
  assert.match(src("../src/shell/tresor.ts"), /"freedom\.zeitanker"/, "nur in geheim");
  assert.ok(SICHERUNG_NIE.some((r) => r.test(LS_ZEITANKER)));
  assert.deepEqual(filtereWiederherstellung({ [LS_ZEITANKER]: "[]" }), {});
  assert.ok(EXPORT_ZUSAETZLICH.includes(LS_ZEITANKER), "Beweise gehören zu den Quittungen im Export");
  const f = PRIVACY_FACTS.find((x) => x.id === "zeitanker")!;
  for (const k of OTS_KALENDER) assert.ok(f.aussage.includes(new URL(k).host.split(".")[0]!), `Bericht nennt ${k}`);
});
