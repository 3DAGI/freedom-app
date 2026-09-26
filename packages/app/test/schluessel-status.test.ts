/**
 * Schritt 8.6a: Schluesselwechsel der Kontakte – erstes Mandat gemerkt,
 * Widerruf erkannt, Nachrichten nach dem Diebstahl markiert.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildEvent, buildRevocation, buildRotationMandate, generateKeypair, signEvent } from "@freedomstack/protocol";
import { leseGemerkt, nachDiebstahl, pruefeKontakte, warnt } from "../src/schluessel-status.js";

const T = 1_790_000_000;
const TAG = 86_400;
const [a, neu, dieb, b] = [generateKeypair(), generateKeypair(), generateKeypair(), generateKeypair()];
const mandat = (an: string, at: number) => signEvent(buildRotationMandate(a.pk, an, at), a.sk);
const widerruf = (k: { pk: string; sk: Uint8Array }, at: number, seit?: number) =>
  signEvent(buildRevocation({ oldPubkey: a.pk, newPubkey: k.pk, reason: "gestohlen", note: "", ...(seit ? { compromisedSince: seit } : {}) }, at), k.sk);

test("8.6a: erstes Mandat gemerkt; zurueckdatiertes des Diebs aendert nichts; Widerruf zeigt den echten Nachfolger", () => {
  const echt = mandat(neu.pk, T - 10 * TAG);
  const r1 = pruefeKontakte([a.pk, b.pk], [echt], {}, T - 9 * TAG);
  assert.equal(r1.geaendert, true);
  assert.equal(warnt(r1.stand.get(a.pk)), false, "noch gueltig");
  const events = [echt, mandat(dieb.pk, 1_577_836_800), widerruf(dieb, T), widerruf(neu, T + 5, T - TAG)];
  const r2 = pruefeKontakte([a.pk, b.pk], events, r1.gemerkt, T + 10);
  assert.equal(r2.geaendert, false);
  const st = r2.stand.get(a.pk)!;
  assert.equal(st.status, "widerrufen");
  assert.equal(st.currentPubkey, neu.pk);
  assert.equal(warnt(st), true);
  assert.equal(warnt(r2.stand.get(b.pk)), false, "andere Kontakte unberuehrt");
  // Nachricht vom alten Schluessel nach dem Diebstahl: nicht glauben; davor schon
  const nachher = signEvent(buildEvent(a.pk, 14, [], "schick mir Geld", T), a.sk);
  const vorher = signEvent(buildEvent(a.pk, 14, [], "bis morgen", T - 3 * TAG), a.sk);
  assert.equal(nachDiebstahl(nachher, st), true);
  assert.equal(nachDiebstahl(vorher, st), false);
  assert.equal(nachDiebstahl({ created_at: T, pubkey: b.pk }, st), false, "nur Nachrichten dieses Schluessels");
});

test("8.6a: Gedaechtnis streng lesen", () => {
  assert.deepEqual(leseGemerkt(null), {});
  assert.deepEqual(leseGemerkt("{kaputt"), {});
  assert.deepEqual(leseGemerkt(JSON.stringify({ [a.pk]: { neu: "zz", gesehen: 1 }, kurz: { neu: neu.pk, gesehen: 1 } })), {});
  assert.deepEqual(leseGemerkt(JSON.stringify({ [a.pk]: { neu: neu.pk, gesehen: T } })), { [a.pk]: { neu: neu.pk, gesehen: T } });
});

test("8.6a: verdrahtet – Widerruf prueft Eingaben und Mandat, Chat wertet Widerrufe aus", () => {
  const settings = readFileSync(new URL("../src/shell/tabs/settings.ts", import.meta.url), "utf8");
  const f = settings.slice(settings.indexOf("async function widerrufeSchluessel("), settings.indexOf("/** Geraete anzeigen. */"));
  assert.match(f, /if \(!\/\^\[0-9a-f\]\{64\}\$\/\.test\(ersatzHex\)\)/, "Hex vor fromHex pruefen");
  assert.ok(f.indexOf("test(ersatzHex)") < f.indexOf("fromHex(ersatzHex)"));
  assert.match(f, /parseRotationMandate\(ev\)\.newPubkey === pk/, "nur mit passendem Mandat");
  assert.match(f, /sk\.fill\(0\)/);
  const kom = readFileSync(new URL("../src/shell/tabs/kommunikation.ts", import.meta.url), "utf8");
  assert.match(kom, /await aktualisiereSchluessel\(\);/);
  assert.match(kom, /pruefeKontakte\(kontakte, \[\.\.\.mandate, \.\.\.widerrufe\], leseGemerkt\(geheim\.getItem\(LS_MANDATE\)\)\)/);
  assert.match(kom, /nachDiebstahl\(ev, schluesselStand\.get\(c\.id\)\)/);
  const tresor = readFileSync(new URL("../src/shell/tresor.ts", import.meta.url), "utf8");
  assert.match(tresor, /"freedom\.mandate"\]/, "Gedaechtnis liegt im Tresor");
});
