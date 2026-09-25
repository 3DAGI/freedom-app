/**
 * Schritt 3.1a: private KI-Anfragen – versiegelt vom Sitzungsschluessel, im
 * Umschlag an den Provider, mit Rechenarbeit gegen Spam.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvent, computeEventId, generateKeypair, signEvent, type NostrEvent } from "../src/event.js";
import { buildJobFeedback, buildJobRequest, buildJobResult, parseJobResult } from "../src/dvm.js";
import { giftWrapMitSigner } from "../src/gift-wrap.js";
import {
  MAX_POW_BITS, buildPrivateDispute, buildPrivateJobRequest, buildPrivateJobResponse, buildPrivateSessionEvent,
  openPrivateJobRequest, openPrivateJobResponse, openPrivateKundenEvent,
} from "../src/private-job.js";
import { buildDispute, parseDispute } from "../src/disputes-relays.js";
import { buildSessionOpen, buildSessionPayment, parseSessionOpen } from "../src/stream.js";
import { eventDifficulty } from "../src/pow.js";
import { LocalSigner } from "../src/signer.js";
import { buildCapabilities, parseCapabilities } from "../src/tiers.js";
import {
  regelAutorNicht, regelKeinKlartext, regelKeinKlartextPrompt, regelKeineZahlungsdaten, regelKundeVerborgen,
} from "../src/leak-rules.js";

const PROMPT = "Welche Nebenwirkungen hat mein neues Medikament?";
const identitaet = generateKeypair();
const provider = new LocalSigner(generateKeypair().sk);

function anfrage(sitzung: LocalSigner) {
  return buildJobRequest({
    customerPubkey: sitzung.publicKey(), input: PROMPT, bidMsat: 21_000,
    providerPubkey: provider.publicKey(), params: [["tier", "standard"]],
  }, 1_790_000_000);
}

test("privat: Provider oeffnet genau die Anfrage, Autor ist der Sitzungsschluessel", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const req = anfrage(sitzung);
  const { wrap, requestId } = await buildPrivateJobRequest({ request: req, sessionSigner: sitzung, providerPk: provider.publicKey() });
  const r = await openPrivateJobRequest(wrap, provider);
  assert.ok(r.ok, !r.ok ? r.grund : "");
  assert.equal(r.kundePk, sitzung.publicKey());
  assert.equal(r.request.id, requestId);
  assert.equal(r.request.id, computeEventId(req));
  assert.deepEqual(r.request.tags, req.tags);
  assert.equal(r.request.kind, 5050);
});

test("privat: Relays sehen weder Prompt noch Kunde noch Sitzungsschluessel", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const { wrap } = await buildPrivateJobRequest({ request: anfrage(sitzung), sessionSigner: sitzung, providerPk: provider.publicKey() });
  assert.equal(wrap.kind, 1059);
  assert.deepEqual(regelKeinKlartextPrompt([wrap], [PROMPT]), []);
  assert.deepEqual(regelKeinKlartext([wrap], [PROMPT]), []);
  assert.deepEqual(regelKundeVerborgen([wrap], identitaet.pk), []);
  assert.deepEqual(regelKundeVerborgen([wrap], sitzung.publicKey()), []);
  assert.deepEqual(regelAutorNicht([wrap], sitzung.publicKey()), []);
  assert.deepEqual(wrap.tags.filter((t) => t[0] === "p"), [["p", provider.publicKey()]]);
});

test("privat: ein anderer Provider kann den Umschlag nicht oeffnen", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const { wrap } = await buildPrivateJobRequest({ request: anfrage(sitzung), sessionSigner: sitzung, providerPk: provider.publicKey() });
  const fremd = new LocalSigner(generateKeypair().sk);
  const r = await openPrivateJobRequest(wrap, fremd);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.grund : "", /nicht an diesen Provider/);
  // Auch mit umgeschriebenem p-Tag: die Signatur bricht, entschluesselt wird nichts.
  const umgelenkt = { ...wrap, tags: [["p", fremd.publicKey()]] };
  const r2 = await openPrivateJobRequest(umgelenkt, fremd);
  assert.equal(r2.ok, false);
  assert.match(!r2.ok ? r2.grund : "", /Signatur ungültig/);
});

test("privat: Rechenarbeit – verlangt, geleistet, zu wenig", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const { wrap } = await buildPrivateJobRequest({ request: anfrage(sitzung), sessionSigner: sitzung, providerPk: provider.publicKey(), powBits: 8 });
  const bits = eventDifficulty(wrap);
  assert.ok(bits >= 8);
  assert.ok(wrap.tags.some((t) => t[0] === "nonce" && t[2] === "8"));
  assert.equal((await openPrivateJobRequest(wrap, provider, 8)).ok, true);
  const zuWenig = await openPrivateJobRequest(wrap, provider, bits + 1);
  assert.equal(zuWenig.ok, false);
  assert.match(!zuWenig.ok ? zuWenig.grund : "", /Zu wenig Rechenarbeit/);
  await assert.rejects(
    buildPrivateJobRequest({ request: anfrage(sitzung), sessionSigner: sitzung, providerPk: provider.publicKey(), powBits: MAX_POW_BITS + 1 }),
    /außerhalb/,
  );
});

test("privat: falsche Eingaben – kein Job, fremder Sitzungsschluessel, kaputter Kern", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  // Kein Job-Kind
  await assert.rejects(buildPrivateJobRequest({
    request: buildEvent(sitzung.publicKey(), 14, [], "hallo"), sessionSigner: sitzung, providerPk: provider.publicKey(),
  }), /Keine Job-Anfrage/);
  // Anfrage eines anderen Schluessels
  await assert.rejects(buildPrivateJobRequest({
    request: anfrage(new LocalSigner(generateKeypair().sk)), sessionSigner: sitzung, providerPk: provider.publicKey(),
  }), /Sitzungsschlüssel/);
  // Eine DM im Umschlag an den Provider ist keine Anfrage
  const dm = await giftWrapMitSigner(buildEvent(sitzung.publicKey(), 14, [], "hallo"), sitzung, provider.publicKey());
  const r = await openPrivateJobRequest(dm, provider);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.grund : "", /Keine Job-Anfrage/);
  // Kern mit falschen Typen
  const kaputt = await giftWrapMitSigner({ ...anfrage(sitzung), tags: [["i", 5 as unknown as string]] }, sitzung, provider.publicKey());
  const r2 = await openPrivateJobRequest(kaputt, provider);
  assert.equal(r2.ok, false);
  assert.match(!r2.ok ? r2.grund : "", /beschädigt/);
  // Ein gewoehnliches Event ist kein Umschlag
  const offen: NostrEvent = signEvent(anfrage(sitzung), generateKeypair().sk);
  assert.equal((await openPrivateJobRequest(offen, provider)).ok, false);
});

test("Angebot: pow-Tag hin und zurueck, Fremdes wird ignoriert", () => {
  const kp = generateKeypair();
  const basis = { pubkey: kp.pk, tier: "classic" as const, models: ["m"], textRatePerKTokenMsat: 1000, tools: [], currentlyFree: false };
  const mit = parseCapabilities(signEvent(buildCapabilities({ ...basis, powBits: 12 }), kp.sk));
  assert.equal(mit.powBits, 12);
  assert.equal(parseCapabilities(signEvent(buildCapabilities(basis), kp.sk)).powBits, undefined);
  for (const roh of ["", "-1", "99", "1e1", "abc", String(MAX_POW_BITS + 1)]) {
    const ev = buildCapabilities(basis);
    ev.tags.push(["pow", roh]);
    assert.equal(parseCapabilities(signEvent(ev, kp.sk)).powBits, undefined, roh);
  }
});

// ---------------------------------------------------------------- Antworten (3.2)

// Testvektor aus BOLT 11 – oeffentlich, kein Geheimnis.
const BOLT11 = "lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp";
const ANTWORT = "Mit dem Medikament kann Schwindel auftreten.";

function ergebnis(sitzungPk: string, requestId: string) {
  return buildJobResult({
    providerPubkey: provider.publicKey(), requestId, requestKind: 5050, customerPubkey: sitzungPk,
    output: ANTWORT, amountMsat: 21_000, bolt11: BOLT11,
    usage: { model: "m", promptTokens: 5, completionTokens: 9 },
  }, 1_790_000_100);
}

test("privat 3.2: Antwort geht an den Sitzungsschluessel und kommt unveraendert an", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const res = ergebnis(sitzung.publicKey(), "a".repeat(64));
  const { wrap, responseId } = await buildPrivateJobResponse({ response: res, providerSigner: provider, sessionPk: sitzung.publicKey() });
  const r = await openPrivateJobResponse(wrap, sitzung);
  assert.ok(r.ok, !r.ok ? r.grund : "");
  assert.equal(r.providerPk, provider.publicKey());
  assert.equal(r.response.id, responseId);
  const p = parseJobResult(r.response);
  assert.equal(p.output, ANTWORT);
  assert.equal(p.amountMsat, 21_000);
  assert.equal(p.bolt11, BOLT11);
});

test("privat 3.2: Relays sehen weder Antwort noch Betrag noch Rechnung noch Empfaenger-Sitzung als Autor", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const { wrap } = await buildPrivateJobResponse({ response: ergebnis(sitzung.publicKey(), "b".repeat(64)), providerSigner: provider, sessionPk: sitzung.publicKey() });
  assert.deepEqual(regelKeineZahlungsdaten([wrap]), []);
  assert.deepEqual(regelKeinKlartext([wrap], [ANTWORT]), []);
  assert.deepEqual(regelAutorNicht([wrap], provider.publicKey()), []);
  assert.deepEqual(regelKundeVerborgen([wrap], identitaet.pk), []);
  // Zum Vergleich: das offene Ergebnis verletzt die Regel.
  assert.equal(regelKeineZahlungsdaten([signEvent(ergebnis(sitzung.publicKey(), "b".repeat(64)), generateKeypair().sk)]).length, 1);
});

test("privat 3.2: Rueckmeldung (7000) ebenso; fremde Sitzung und falsche Autoren scheitern", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const fb = buildJobFeedback(provider.publicKey(), "c".repeat(64), sitzung.publicKey(), "error", "Bid zu niedrig");
  const { wrap } = await buildPrivateJobResponse({ response: fb, providerSigner: provider, sessionPk: sitzung.publicKey() });
  const r = await openPrivateJobResponse(wrap, sitzung);
  assert.ok(r.ok);
  assert.equal(r.ok && r.response.kind, 7000);

  const fremd = new LocalSigner(generateKeypair().sk);
  const f = await openPrivateJobResponse(wrap, fremd);
  assert.equal(f.ok, false);
  assert.match(!f.ok ? f.grund : "", /nicht an diese Sitzung/);

  // Antwort, die nicht vom Provider stammt, wird gar nicht erst verpackt
  await assert.rejects(buildPrivateJobResponse({
    response: ergebnis(sitzung.publicKey(), "d".repeat(64)), providerSigner: fremd, sessionPk: sitzung.publicKey(),
  }), /nicht zum Provider/);
  // Eine Anfrage ist keine Antwort – weder beim Verpacken noch beim Oeffnen
  await assert.rejects(buildPrivateJobResponse({
    response: anfrage(sitzung), providerSigner: provider, sessionPk: sitzung.publicKey(),
  }), /Keine Antwort/);
  const falsch = await giftWrapMitSigner(buildJobRequest({ customerPubkey: provider.publicKey(), input: "x", bidMsat: 1 }), provider, sitzung.publicKey());
  const o = await openPrivateJobResponse(falsch, sitzung);
  assert.equal(o.ok, false);
  assert.match(!o.ok ? o.grund : "", /Keine Antwort/);
});

// ---------------------------------------------------------------- Sitzung und Belege (3.2d)

function sitzungsEvents(sitzung: LocalSigner) {
  const open = buildSessionOpen({
    customerPubkey: sitzung.publicKey(), providerPubkey: provider.publicKey(), sessionId: "sess-privat-1",
    maxTotalMsat: 100_000, maxRatePerKTokenMsat: 2000, settleEveryMsat: 20_000, ttlSecs: 3600,
  }, 1_790_000_000);
  const beleg = buildSessionPayment({
    customerPubkey: sitzung.publicKey(), sessionId: "sess-privat-1", seq: 1, cumulativeMsat: 20_000, unitsSinceLast: 7000,
  }, 1_790_000_060);
  return { open, beleg };
}

test("privat 3.2d: Sitzung und Beleg versiegelt – Provider oeffnet sie, Relays sehen keine Betraege", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const { open, beleg } = sitzungsEvents(sitzung);
  for (const event of [open, beleg]) {
    const { wrap, eventId } = await buildPrivateSessionEvent({ event, sessionSigner: sitzung, providerPk: provider.publicKey(), powBits: 8 });
    assert.deepEqual(regelKeineZahlungsdaten([wrap]), []);
    assert.deepEqual(regelKundeVerborgen([wrap], sitzung.publicKey()), []);
    const r = await openPrivateKundenEvent(wrap, provider, 8);
    assert.ok(r.ok, !r.ok ? r.grund : "");
    assert.equal(r.ok && r.request.id, eventId);
    assert.equal(r.ok && r.kundePk, sitzung.publicKey());
    // Nur-Anfragen-Oeffner nimmt Sitzungs-Events nicht an
    const nurJob = await openPrivateJobRequest(wrap, provider, 8);
    assert.equal(nurJob.ok, false);
  }
  const r = await openPrivateKundenEvent((await buildPrivateSessionEvent({ event: open, sessionSigner: sitzung, providerPk: provider.publicKey() })).wrap, provider);
  assert.equal(r.ok && parseSessionOpen(r.request).maxTotalMsat, 100_000);
});

test("privat 3.2d: Sitzungs-Events – falsches Kind, fremder Schluessel; Anfragen gehen weiter durch den Kunden-Oeffner", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const { open } = sitzungsEvents(sitzung);
  await assert.rejects(buildPrivateSessionEvent({ event: anfrage(sitzung), sessionSigner: sitzung, providerPk: provider.publicKey() }), /Kein Sitzungs-Event/);
  await assert.rejects(buildPrivateSessionEvent({ event: open, sessionSigner: new LocalSigner(generateKeypair().sk), providerPk: provider.publicKey() }), /Sitzungsschlüssel/);
  const { wrap } = await buildPrivateJobRequest({ request: anfrage(sitzung), sessionSigner: sitzung, providerPk: provider.publicKey() });
  const r = await openPrivateKundenEvent(wrap, provider);
  assert.equal(r.ok && r.request.kind, 5050);
  // Eine DM an den Provider ist weder Anfrage noch Sitzungs-Event
  const dm = await giftWrapMitSigner(buildEvent(sitzung.publicKey(), 14, [], "hallo"), sitzung, provider.publicKey());
  const d = await openPrivateKundenEvent(dm, provider);
  assert.equal(d.ok, false);
  assert.match(!d.ok ? d.grund : "", /Weder Anfrage noch Sitzungs-Event/);
});

// ------------------------------------------------------------ Reklamation (3.4)

const NOTIZ = "Die Antwort hat meine Frage zum Medikament ignoriert";
const JOB = "c".repeat(64);
function reklamation(sitzung: LocalSigner, providerPk = provider.publicKey()) {
  return buildDispute({
    jobId: JOB, customerPubkey: sitzung.publicKey(), providerPubkey: providerPk, reason: "unbrauchbar", amountMsat: 7000, note: NOTIZ,
  }, 1_790_000_000);
}

test("privat 3.4: Reklamation versiegelt an Provider und Pruefer – beide oeffnen sie, Relays sehen nichts", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const pruefer = new LocalSigner(generateKeypair().sk);
  const dispute = reklamation(sitzung);
  const { wraps, disputeId } = await buildPrivateDispute({
    dispute, sessionSigner: sitzung, empfaenger: [{ pk: provider.publicKey(), powBits: 8 }, { pk: pruefer.publicKey(), powBits: 4 }],
  });
  assert.equal(wraps.length, 2);
  assert.ok(eventDifficulty(wraps[0]) >= 8 && eventDifficulty(wraps[1]) >= 4, "Rechenarbeit je Empfaenger");
  for (const [w, signer] of [[wraps[0], provider], [wraps[1], pruefer]] as const) {
    const r = await openPrivateKundenEvent(w, signer, 4);
    assert.ok(r.ok, !r.ok ? r.grund : "");
    assert.equal(r.request.id, disputeId);
    assert.equal(r.kundePk, sitzung.publicKey());
    const d = parseDispute({ ...r.request, sig: "" });
    assert.deepEqual([d.jobId, d.providerPubkey, d.reason, d.amountMsat, d.note], [JOB, provider.publicKey(), "unbrauchbar", 7000, NOTIZ]);
  }
  // Ein Dritter kann keinen der Umschlaege oeffnen; die Anfrage-Oeffnung nimmt keine Reklamation.
  const dritter = new LocalSigner(generateKeypair().sk);
  assert.equal((await openPrivateKundenEvent(wraps[0], dritter)).ok, false);
  assert.equal((await openPrivateJobRequest(wraps[0], provider)).ok, false);
  // Relays: kein Betrag, kein Grund, keine Notiz, weder Identitaet noch Sitzung
  assert.deepEqual(regelKeineZahlungsdaten(wraps), []);
  assert.deepEqual(regelKeinKlartext(wraps, [NOTIZ, "unbrauchbar", JOB]), []);
  assert.deepEqual(regelKundeVerborgen(wraps, sitzung.publicKey()), []);
  assert.deepEqual(regelAutorNicht(wraps, identitaet.pk), []);
  assert.deepEqual(wraps.map((w) => w.kind), [1059, 1059]);
});

test("privat 3.4: Reklamation – falsche Eingaben scheitern", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const pruefer = generateKeypair().pk;
  const p = provider.publicKey();
  const bau = (dispute: ReturnType<typeof reklamation>, empfaenger: Array<{ pk: string; powBits?: number }>, signer = sitzung) =>
    buildPrivateDispute({ dispute, sessionSigner: signer, empfaenger });
  await assert.rejects(bau(anfrage(sitzung), [{ pk: p }]), /Keine Reklamation/);
  await assert.rejects(bau(reklamation(sitzung), [{ pk: p }], new LocalSigner(generateKeypair().sk)), /Sitzungsschlüssel/);
  await assert.rejects(bau(reklamation(sitzung), []), /1–2 Empfänger/);
  await assert.rejects(bau(reklamation(sitzung), [{ pk: p }, { pk: pruefer }, { pk: generateKeypair().pk }]), /1–2 Empfänger/);
  await assert.rejects(bau(reklamation(sitzung), [{ pk: p }, { pk: p }]), /doppelt/);
  await assert.rejects(bau(reklamation(sitzung), [{ pk: pruefer }]), /Provider muss/, "ohne den Provider");
  await assert.rejects(bau(reklamation(sitzung), [{ pk: p }, { pk: sitzung.publicKey() }]), /prüft nicht selbst/);
  await assert.rejects(bau(reklamation(sitzung), [{ pk: p.toUpperCase() }]), /ungültig/);
  await assert.rejects(bau(reklamation(sitzung), [{ pk: p, powBits: MAX_POW_BITS + 1 }]), /Rechenarbeit/);
  // Nur an den Provider geht auch – ohne Pruefer
  assert.equal((await bau(reklamation(sitzung), [{ pk: p }])).wraps.length, 1);
});
