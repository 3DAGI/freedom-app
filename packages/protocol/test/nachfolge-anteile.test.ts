/**
 * Schritt 8.11a: Nachfolge mit versiegelten Anteilen – durchgespielt mit
 * einem Besitzer und drei Vertrauten (Schwelle 2 von 3).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, type NostrEvent } from "../src/event.js";
import { LocalSigner } from "../src/signer.js";
import {
  buildHeartbeat, buildRecoveryClaim, buildSuccessionPlan, parseSuccessionPlan, secretHashOf, splitSecret,
} from "../src/succession.js";
import {
  baueAnteilAnfrage, baueAnteilUebergabe, baueAnteilUmschlag, darfUebergeben, neueTeilung, oeffneAnteil,
  oeffneAnteilAnfrage, oeffneAnteilUebergabe, setzeNachfolgeZusammen, type GehaltenerAnteil,
} from "../src/nachfolge-anteile.js";
import { regelAutorNicht, regelKeinKlartext, regelPTagsNur } from "../src/leak-rules.js";

const TAG = 86_400;
const T0 = 1_790_000_000;
const besitzer = generateKeypair();
const [b, c, d] = [generateKeypair(), generateKeypair(), generateKeypair()];
const fremd = generateKeypair();
const signer = (k: { sk: Uint8Array }) => new LocalSigner(k.sk);
const hex = (x: Uint8Array) => Buffer.from(x).toString("hex");

/** Besitzer richtet ein: Plan oeffentlich, Anteile versiegelt an B, C, D. */
async function einrichten(teilung = neueTeilung()) {
  const guardians = [b.pk, c.pk, d.pk];
  const teile = splitSecret(besitzer.sk, 3, 2);
  const secretHash = secretHashOf(besitzer.sk);
  const planEv = signEvent(buildSuccessionPlan({ ownerPubkey: besitzer.pk, guardians, threshold: 2, inactivityDays: 180, graceDays: 30, secretHash }, T0), besitzer.sk);
  const umschlaege = await Promise.all(teile.map((t, i) => baueAnteilUmschlag({
    von: signer(besitzer), an: guardians[i]!, anteil: t, schwelle: 2, anzahl: 3, secretHash, teilung, nowSecs: T0,
  })));
  return { planEv, plan: parseSuccessionPlan(planEv), umschlaege, teile };
}

const meldung = (k: { pk: string; sk: Uint8Array }, at: number) => signEvent(buildRecoveryClaim(k.pk, besitzer.pk, "seit Monaten still", at), k.sk);

test("8.11a: jeder Vertraute oeffnet genau seinen Anteil – versiegelt, ohne Klartext", async () => {
  const { umschlaege, teile, planEv } = await einrichten();
  const [ab, ac, ad] = await Promise.all([oeffneAnteil(umschlaege[0]!, signer(b)), oeffneAnteil(umschlaege[1]!, signer(c)), oeffneAnteil(umschlaege[2]!, signer(d))]);
  assert.deepEqual([ab?.index, ac?.index, ad?.index], [1, 2, 3]);
  assert.equal(ab?.besitzer, besitzer.pk);
  assert.equal(ab?.daten, hex(teile[0]!.data));
  // Fremde Umschlaege oeffnet niemand
  assert.equal(await oeffneAnteil(umschlaege[0]!, signer(c)), null);
  assert.equal(await oeffneAnteil(umschlaege[0]!, signer(fremd)), null);
  // Oeffentlich: Plan und Umschlaege – kein Anteil, kein Schluessel, Besitzer nicht Autor der Umschlaege
  const oeffentlich = [planEv, ...umschlaege];
  assert.deepEqual(regelKeinKlartext(oeffentlich, [...teile.map((t) => hex(t.data)), hex(besitzer.sk)]), []);
  assert.deepEqual(regelAutorNicht(umschlaege, besitzer.pk), []);
  assert.ok(umschlaege.every((w) => w.kind === 1059));
  // Die Grenze: Der Plan nennt die Vertrauten oeffentlich – genau sie, niemanden sonst
  assert.deepEqual(regelPTagsNur([planEv], [b.pk, c.pk, d.pk]), []);
  assert.equal(planEv.tags.filter((t) => t[0] === "p").length, 3);
});

test("8.11a: uebergeben erst nach Frist, Schwelle und Wartezeit – ein Lebenszeichen sperrt wieder", async () => {
  const { umschlaege, plan } = await einrichten();
  const ac = (await oeffneAnteil(umschlaege[1]!, signer(c)))!;
  const meldungen = [meldung(b, T0 + 181 * TAG), meldung(c, T0 + 182 * TAG)];
  const frage = (events: NostrEvent[], jetzt: number, sammler = b.pk, anteil: GehaltenerAnteil = ac) =>
    darfUebergeben({ plan, events, anteil, ich: c.pk, sammler, nowSecs: jetzt });
  assert.equal(frage([], T0 + 100 * TAG).ok, false, "Besitzer aktiv");
  assert.equal(frage(meldungen, T0 + 190 * TAG).ok, false, "Wartefrist läuft");
  assert.equal(frage(meldungen, T0 + 213 * TAG).ok, true, "freigegeben");
  assert.equal(frage(meldungen, T0 + 213 * TAG, fremd.pk).ok, false, "Sammler kein Vertrauter");
  assert.equal(frage(meldungen, T0 + 213 * TAG, c.pk).ok, false, "nicht an sich selbst");
  assert.equal(frage(meldungen, T0 + 213 * TAG, b.pk, { ...ac, secretHash: "0".repeat(64) }).ok, false, "fremder Plan");
  const lebenszeichen = signEvent(buildHeartbeat(besitzer.pk, T0 + 212 * TAG), besitzer.sk);
  const r = frage([...meldungen, lebenszeichen], T0 + 213 * TAG);
  assert.equal(r.ok, false);
  assert.match((r as { grund: string }).grund, /Noch nicht freigegeben/);
});

test("8.11a: NACHFOLGE DURCHGESPIELT – B sammelt von C, setzt zusammen, hat den Schluessel des Besitzers", async () => {
  const { umschlaege, plan } = await einrichten();
  const ab = (await oeffneAnteil(umschlaege[0]!, signer(b)))!;
  const ac = (await oeffneAnteil(umschlaege[1]!, signer(c)))!;
  const events = [meldung(b, T0 + 181 * TAG), meldung(c, T0 + 182 * TAG)];
  const jetzt = T0 + 213 * TAG;

  // B fragt C an – versiegelt
  const { wrap: anfrageWrap } = await baueAnteilAnfrage({ von: signer(b), an: c.pk, besitzer: besitzer.pk, teilung: ab.teilung, nowSecs: jetzt });
  assert.equal(await oeffneAnteilAnfrage(anfrageWrap, signer(d)), null, "nur der Gefragte liest die Anfrage");
  const anfrage = (await oeffneAnteilAnfrage(anfrageWrap, signer(c)))!;
  assert.equal(anfrage.von, b.pk);

  // C prueft und uebergibt
  assert.deepEqual(darfUebergeben({ plan, events, anteil: ac, ich: c.pk, sammler: anfrage.von, nowSecs: jetzt }), { ok: true });
  const uebergabe = await baueAnteilUebergabe({ von: signer(c), anfrage, anteil: ac, nowSecs: jetzt });
  assert.deepEqual(regelKeinKlartext([anfrageWrap, uebergabe], [ac.daten, ab.daten]), []);

  // B oeffnet und setzt zusammen
  const erhalten = (await oeffneAnteilUebergabe(uebergabe, signer(b), plan))!;
  assert.equal(erhalten.von, c.pk);
  assert.equal(erhalten.anfrageId, anfrage.anfrageId);
  const schluessel = setzeNachfolgeZusammen([ab, erhalten], plan);
  assert.equal(hex(schluessel), hex(besitzer.sk));
});

test("8.11a: Uebergaben nur von Vertrauten; Anteile verschiedener Teilungen werden nicht gemischt", async () => {
  const alt = await einrichten();
  const neu = await einrichten();
  const altB = (await oeffneAnteil(alt.umschlaege[0]!, signer(b)))!;
  const neuC = (await oeffneAnteil(neu.umschlaege[1]!, signer(c)))!;
  assert.notEqual(altB.teilung, neuC.teilung);
  assert.throws(() => setzeNachfolgeZusammen([altB, neuC], neu.plan), /Erst 1 von 2/);
  assert.throws(() => setzeNachfolgeZusammen([altB], neu.plan), /Erst 1 von 2/);
  // Ein Fremder schickt einen „Anteil“ – wird nicht angenommen
  const anfrage = { von: b.pk, besitzer: besitzer.pk, teilung: neuC.teilung, anfrageId: "ab".repeat(32), zeit: T0 };
  const falsch = await baueAnteilUebergabe({ von: signer(fremd), anfrage, anteil: neuC });
  assert.equal(await oeffneAnteilUebergabe(falsch, signer(b), neu.plan), null);
  // Gefaelschte Daten passen nicht zur Pruefsumme
  const neuB = (await oeffneAnteil(neu.umschlaege[0]!, signer(b)))!;
  assert.throws(() => setzeNachfolgeZusammen([neuB, { ...neuC, daten: "00".repeat(32) }], neu.plan), /passen nicht/);
});

test("8.11a: unsinnige Anteile werden abgelehnt", async () => {
  const teilung = neueTeilung();
  const secretHash = secretHashOf(besitzer.sk);
  const [t] = splitSecret(besitzer.sk, 3, 2);
  const basis = { von: signer(besitzer), an: b.pk, anteil: t!, schwelle: 2, anzahl: 3, secretHash, teilung };
  await assert.rejects(baueAnteilUmschlag({ ...basis, schwelle: 1 }), /Schwelle/);
  await assert.rejects(baueAnteilUmschlag({ ...basis, an: besitzer.pk }), /Vertrauter/);
  await assert.rejects(baueAnteilUmschlag({ ...basis, teilung: "kurz" }), /Teilung/);
  await assert.rejects(baueAnteilUmschlag({ ...basis, anteil: { index: 0, data: t!.data } }), /Anteil/);
});
