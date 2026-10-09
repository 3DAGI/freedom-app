/**
 * Schritt 8.11a: Nachfolge mit versiegelten Anteilen – durchgespielt mit
 * einem Besitzer und drei Vertrauten (Schwelle 2 von 3). Seit SH1 entstehen
 * Anteile in Fassung 2 (Bibliothek von Privy); die Tests aus 8.11a laufen mit
 * Fassung 1 weiter – alte Anteile bleiben lesbar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, type NostrEvent } from "../src/event.js";
import { LocalSigner } from "../src/signer.js";
import {
  buildHeartbeat, buildRecoveryClaim, buildSuccessionPlan, parseSuccessionPlan, secretHashOf, splitSecret, teileGeheimnis,
} from "../src/succession.js";
import { giftUnwrapMitSigner } from "../src/gift-wrap.js";
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

/** Besitzer richtet ein: Plan oeffentlich, Anteile versiegelt an B, C, D – Fassung 1 (bis SH1) oder 2. */
async function einrichten(teilung = neueTeilung(), fassung: 1 | 2 = 1) {
  const guardians = [b.pk, c.pk, d.pk];
  const teile = fassung === 2 ? await teileGeheimnis(besitzer.sk, 3, 2) : splitSecret(besitzer.sk, 3, 2);
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
  // Kennungen (8.16g2b3b): Daraus bildet die App den Grund in ihrer Sprache – mit dem Stand der Nachfolge.
  assert.deepEqual(!r.ok && [r.fall, r.stand?.status], ["nicht-freigegeben", "aktiv"]);
  const fall = (x: ReturnType<typeof frage>) => (x.ok ? "ok" : x.fall);
  assert.deepEqual([
    fall(frage(meldungen, T0 + 213 * TAG, fremd.pk)), fall(frage(meldungen, T0 + 213 * TAG, c.pk)),
    fall(frage(meldungen, T0 + 213 * TAG, b.pk, { ...ac, secretHash: "0".repeat(64) })),
  ], ["anfragender", "anfragender", "anderer-plan"]);
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
  const erhalten = (await oeffneAnteilUebergabe(uebergabe, signer(b), [plan]))!;
  assert.equal(erhalten.von, c.pk);
  assert.equal(erhalten.anfrageId, anfrage.anfrageId);
  assert.equal(await oeffneAnteilUebergabe(uebergabe, signer(b), []), null, "ohne Plan dieses Besitzers nichts");
  const schluessel = await setzeNachfolgeZusammen([ab, erhalten], plan);
  assert.equal(hex(schluessel), hex(besitzer.sk));
});

test("8.11a: Uebergaben nur von Vertrauten; Anteile verschiedener Teilungen werden nicht gemischt", async () => {
  const alt = await einrichten();
  const neu = await einrichten();
  const altB = (await oeffneAnteil(alt.umschlaege[0]!, signer(b)))!;
  const neuC = (await oeffneAnteil(neu.umschlaege[1]!, signer(c)))!;
  assert.notEqual(altB.teilung, neuC.teilung);
  await assert.rejects(setzeNachfolgeZusammen([altB, neuC], neu.plan), /Erst 1 von 2/);
  await assert.rejects(setzeNachfolgeZusammen([altB], neu.plan), /Erst 1 von 2/);
  // Ein Fremder schickt einen „Anteil“ – wird nicht angenommen
  const anfrage = { von: b.pk, besitzer: besitzer.pk, teilung: neuC.teilung, anfrageId: "ab".repeat(32), zeit: T0 };
  const falsch = await baueAnteilUebergabe({ von: signer(fremd), anfrage, anteil: neuC });
  assert.equal(await oeffneAnteilUebergabe(falsch, signer(b), [neu.plan]), null);
  // Gefaelschte Daten passen nicht zur Pruefsumme
  const neuB = (await oeffneAnteil(neu.umschlaege[0]!, signer(b)))!;
  await assert.rejects(setzeNachfolgeZusammen([neuB, { ...neuC, daten: "00".repeat(32) }], neu.plan), /passen nicht/);
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

const inneres = async (w: NostrEvent, k: { sk: Uint8Array }) => (await giftUnwrapMitSigner(w, signer(k))).inner!;
const fassungTag = (ev: { tags: string[][] }) => ev.tags.find((t) => t[0] === "fassung")?.[1];

test("SH1: neue Anteile in Fassung 2 – Tag im Anteil und in der Übergabe, durchgespielt bis zum Schlüssel", async () => {
  const { umschlaege, plan, teile } = await einrichten(neueTeilung(), 2);
  assert.ok(teile.every((t) => t.fassung === 2 && t.data.length === 33), "Geheimnis plus ein Byte mit der Stelle");
  assert.equal(fassungTag(await inneres(umschlaege[0]!, b)), "2");
  const ab = (await oeffneAnteil(umschlaege[0]!, signer(b)))!;
  const ac = (await oeffneAnteil(umschlaege[1]!, signer(c)))!;
  assert.equal(ab.fassung, 2);
  const jetzt = T0 + 213 * TAG;
  const { wrap } = await baueAnteilAnfrage({ von: signer(b), an: c.pk, besitzer: besitzer.pk, teilung: ab.teilung, nowSecs: jetzt });
  const uebergabe = await baueAnteilUebergabe({ von: signer(c), anfrage: (await oeffneAnteilAnfrage(wrap, signer(c)))!, anteil: ac, nowSecs: jetzt });
  assert.equal(fassungTag(await inneres(uebergabe, b)), "2", "die Fassung reist mit");
  const erhalten = (await oeffneAnteilUebergabe(uebergabe, signer(b), [plan]))!;
  assert.equal(erhalten.fassung, 2);
  assert.equal(hex(await setzeNachfolgeZusammen([ab, erhalten], plan)), hex(besitzer.sk));
  // Ohne Tag gelesen (als Fassung 1) passt es nicht – die Fassung entscheidet, wie zusammengesetzt wird
  const { fassung: _f, ...alsAlt } = erhalten;
  await assert.rejects(setzeNachfolgeZusammen([ab, alsAlt], plan), /passen nicht/);
});

test("SH1: alte Anteile (Fassung 1) ohne Tag bleiben lesbar; eine unbekannte Fassung wird abgelehnt", async () => {
  const alt = await einrichten();
  assert.equal(fassungTag(await inneres(alt.umschlaege[0]!, b)), undefined, "Fassung 1 im alten Format");
  const ab = (await oeffneAnteil(alt.umschlaege[0]!, signer(b)))!;
  assert.equal(ab.fassung, undefined);
  const ad = (await oeffneAnteil(alt.umschlaege[2]!, signer(d)))!;
  assert.equal(hex(await setzeNachfolgeZusammen([ab, ad], alt.plan)), hex(besitzer.sk));
  // Ein Anteil mit unbekannter Fassung – der Vertraute nimmt ihn nicht an
  const [t] = await teileGeheimnis(besitzer.sk, 3, 2);
  const teilung = neueTeilung();
  const kern = {
    pubkey: besitzer.pk, kind: 38077, created_at: T0, content: hex(t!.data),
    tags: [["p", b.pk], ["index", "1"], ["schwelle", "2"], ["anzahl", "3"], ["secret_hash", secretHashOf(besitzer.sk)], ["teilung", teilung], ["fassung", "3"]],
  };
  const { giftWrapMitSigner } = await import("../src/gift-wrap.js");
  assert.equal(await oeffneAnteil(await giftWrapMitSigner(kern, signer(besitzer), b.pk, { fixedJitter: 0, nowSecs: T0 }), signer(b)), null);
  await assert.rejects(baueAnteilUmschlag({
    von: signer(besitzer), an: b.pk, anteil: { index: 1, data: new Uint8Array([7]), fassung: 2 }, schwelle: 2, anzahl: 3,
    secretHash: secretHashOf(besitzer.sk), teilung,
  }), /Anteil/, "Fassung 2 braucht mindestens zwei Byte");
});
