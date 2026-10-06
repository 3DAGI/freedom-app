/**
 * Mandate von Kontakten gegen Bitcoin (Schritt 5.10b, B-17b3b): nur bei
 * Streit, nur Beweise zu genau diesen Mandaten, Prüfung über zwei Explorer
 * (hier echt: `pruefeVerankerung()` mit dem Kopf zu Block 970158 aus der
 * Referenz, die Explorer als Attrappe), Ergebnis entscheidet `merkeMandate()`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_OTS_BEWEIS, KIND_ROTATION_MANDATE, OTS_EXPLORER, PRIVACY_FACTS, baueOtsBeweis, buildRotationMandate, generateKeypair,
  leseOtsZeitstempel, pruefeVerankerung, signEvent, type NostrEvent, type OtsHolen, type Verankerung,
} from "@freedomstack/protocol";
import { hexToBytes } from "@noble/hashes/utils.js";
import { MANDAT_ANKER_GRENZEN, ankerZeiten, streitigeMandate } from "../src/mandat-anker.js";
import { leseGemerkt, pruefeKontakte } from "../src/schluessel-status.js";

const REF = JSON.parse(readFileSync(new URL("../../protocol/test/fixtures/ots-referenz.json", import.meta.url), "utf8")) as {
  digest: string; nachreichung: { nachher: string };
  blockkopf: { hoehe: number; hash: string; kopf: string; zeit: number };
};
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const NOW = 1_800_000_000, TAG = 86400;
const ALT = generateKeypair(), NEU = generateKeypair(), DIEB = generateKeypair();
const mandat = (an: string, at: number) => signEvent(buildRotationMandate(ALT.pk, an, at), ALT.sk);
/** Ein „Mandat“ mit der Kennung aus der Referenz – so passt der echte Beweis (Block 970158) genau zu ihm. */
const mitKennung = (ev: NostrEvent, id: string): NostrEvent => ({ ...ev, id });
const beweisZu = (id: string, kind = KIND_ROTATION_MANDATE): NostrEvent => ({
  ...baueOtsBeweis(DIEB.pk, { id, kind }, { digest: hexToBytes(REF.digest), zeitstempel: leseOtsZeitstempel(hexToBytes(REF.nachreichung.nachher), hexToBytes(REF.digest)) }, NOW),
  id: "11".repeat(32), sig: "22".repeat(64),
});
/** Beide Explorer liefern den Kopf zu Block 970158. */
const explorer = (): { holen: OtsHolen; n: () => number } => {
  let n = 0;
  return {
    n: () => n,
    holen: async (url) => {
      n++;
      if (url.endsWith(`/block-height/${REF.blockkopf.hoehe}`)) return new Response(REF.blockkopf.hash);
      if (url.endsWith(`/block/${REF.blockkopf.hash}/header`)) return new Response(REF.blockkopf.kopf);
      return new Response("nicht gefunden", { status: 404 });
    },
  };
};

test("Streit nur, wo ein alter Schlüssel mehr als einen Nachfolger hat – in den Mandaten oder gemerkt", () => {
  const echt = mandat(NEU.pk, NOW - 10 * TAG), dieb = mandat(DIEB.pk, NOW);
  assert.deepEqual(streitigeMandate([echt], {}), [], "ein Mandat: kein Streit, kein Netz");
  assert.deepEqual(streitigeMandate([echt, echt], {}), []);
  assert.deepEqual(streitigeMandate([echt, dieb], {}).map((e) => e.id).sort(), [echt.id, dieb.id].sort());
  assert.deepEqual(streitigeMandate([dieb], { [ALT.pk]: { neu: NEU.pk, gesehen: NOW - 9 * TAG } }).map((e) => e.id), [dieb.id], "gegen das gemerkte");
});

test("Anker: der echte Beweis zu Block 970158 – beide Explorer gleich → geprüfte Blockzeit, gemerkt für die Sitzung", async () => {
  const echt = mitKennung(mandat(NEU.pk, NOW - 10 * TAG), REF.digest);
  const ex = explorer();
  const gedaechtnis = new Map<string, number | null>();
  const pruefe = (z: Parameters<typeof pruefeVerankerung>[0]) => pruefeVerankerung(z, { holen: ex.holen });
  const zeiten = await ankerZeiten([echt], [beweisZu(REF.digest)], pruefe, gedaechtnis);
  assert.deepEqual([...zeiten], [[REF.digest, REF.blockkopf.zeit]]);
  assert.equal(ex.n(), 2 * OTS_EXPLORER.length, "je Explorer Höhe und Kopf");
  await ankerZeiten([echt], [beweisZu(REF.digest)], pruefe, gedaechtnis);
  assert.equal(ex.n(), 4, "geprüft ist geprüft – kein zweites Mal");
});

test("Anker: fremde Kennung, falsche Art, unlesbar – nichts; keine Aussage wird nie gemerkt; höchstens vier Prüfungen", async () => {
  const echt = mitKennung(mandat(NEU.pk, NOW), REF.digest);
  let n = 0;
  const zaehle = async (): Promise<Verankerung> => { n++; return { ok: false, fall: "uneinig" }; };
  assert.equal((await ankerZeiten([echt], [beweisZu(REF.digest, 1)], zaehle)).size, 0, "Beweis zu einem Event anderer Art");
  assert.equal((await ankerZeiten([mandat(NEU.pk, NOW)], [beweisZu(REF.digest)], zaehle)).size, 0, "Beweis zu einem anderen Mandat");
  assert.equal((await ankerZeiten([echt], [{ ...beweisZu(REF.digest), content: "kaputt" }], zaehle)).size, 0);
  assert.equal(n, 0, "nichts davon wird gegen Bitcoin geprüft");
  const g = new Map<string, number | null>();
  assert.equal((await ankerZeiten([echt], [beweisZu(REF.digest)], zaehle, g)).size, 0);
  assert.equal(g.size, 0, "„uneinig“ heißt: beim nächsten Mal neu fragen");
  await ankerZeiten([echt], [beweisZu(REF.digest)], async () => ({ ok: false, fall: "falsche-wurzel" }), g);
  assert.equal(g.get("11".repeat(32)), null, "eine falsche Wurzel bleibt falsch");
  const viele = Array.from({ length: 6 }, (_, i) => mitKennung(mandat(NEU.pk, NOW + i), i.toString(16).padStart(64, "0")));
  n = 0;
  await ankerZeiten(viele, viele.map((m, i) => ({ ...beweisZu(REF.digest), tags: [["e", m.id], ["k", String(KIND_ROTATION_MANDATE)]], id: i.toString(16).padStart(64, "a") })), zaehle);
  assert.ok(n <= MANDAT_ANKER_GRENZEN.pruefungen);
});

test("Kontakte: der Dieb wurde zuerst gesehen, das echte Mandat ist in Bitcoin früher verankert → der echte Nachfolger gilt", () => {
  const dieb = mandat(DIEB.pk, NOW - 40 * TAG), echt = mandat(NEU.pk, NOW - 30 * TAG);
  const zuerst = pruefeKontakte([ALT.pk], [dieb], {}, NOW - TAG);
  assert.equal(zuerst.gemerkt[ALT.pk]!.neu, DIEB.pk);
  const r = pruefeKontakte([ALT.pk], [dieb, echt], zuerst.gemerkt, NOW, new Map([[echt.id, NOW - 29 * TAG]]));
  assert.equal(r.geaendert, true);
  assert.equal(r.gemerkt[ALT.pk]!.neu, NEU.pk);
  // Der Anker überlebt das Speichern (streng gelesen)
  assert.deepEqual(leseGemerkt(JSON.stringify(r.gemerkt)), r.gemerkt);
  assert.deepEqual(leseGemerkt(JSON.stringify({ [ALT.pk]: { neu: NEU.pk, gesehen: 1, anker: "x" } })), { [ALT.pk]: { neu: NEU.pk, gesehen: 1 } });
});

test("Verdrahtet: Kontakte prüfen nur bei Streit; 1040 nur zu den streitigen Mandaten; Bericht nennt die Explorer", () => {
  const k = src("../src/shell/tabs/kontakte.ts");
  assert.match(k, /const anker = await ankerFuerStreit\(pool, mandate, gemerkt\)\.catch\(\(\) => new Map<string, number>\(\)\);\n\s+const r = pruefeKontakte\(kontakte, \[\.\.\.mandate, \.\.\.widerrufe\], gemerkt, undefined, anker\);/);
  const z = src("../src/shell/zeitanker-takt.ts");
  assert.match(z, /if \(streit\.length === 0\) return new Map\(\);\n\s+const beweise = await pool\.query\(\{ kinds: \[KIND_OTS_BEWEIS\], "#e": streit\.map\(\(m\) => m\.id\), limit: 50 \}\);/);
  assert.equal(KIND_OTS_BEWEIS, 1040);
  const f = PRIVACY_FACTS.find((x) => x.id === "zeitanker")!;
  for (const e of OTS_EXPLORER) assert.ok(f.aussage.includes(new URL(e).host), `Bericht nennt ${new URL(e).host}`);
});
