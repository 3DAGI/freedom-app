/**
 * Der Datenschutzbericht darf nur als "belegt" zeigen, was ein Leak-Test prueft
 * (Schritt 1.5). Jede belegte Aussage braucht hier ein Szenario, das gruen ist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRIVACY_FACTS, privacyFactsText } from "../src/privacy-facts.js";
import { buildPrivateDm } from "../src/private-dm.js";
import { generateKeypair } from "../src/event.js";
import {
  LEAK_REGELN, regelAutorNicht, regelKeinKind4, regelKeinKlartext, regelKeinKlartextPrompt, regelKeineZahlungsdaten,
  regelKundeVerborgen,
} from "../src/leak-rules.js";
import { LAYER_CELL_DEGREES, buildCoverageAnnouncement, toCell } from "../src/coverage.js";
import { signEvent } from "../src/event.js";
import { buildJobRequest, buildJobResult } from "../src/dvm.js";
import { buildPrivateDispute, buildPrivateJobRequest, buildPrivateJobResponse, buildPrivateSessionEvent } from "../src/private-job.js";
import { buildDispute } from "../src/disputes-relays.js";
import { buildSessionOpen, buildSessionPayment } from "../src/stream.js";
import { LocalSigner } from "../src/signer.js";

const a = generateKeypair();
const b = generateKeypair();
const GEHEIM = "streng geheimer Inhalt 4711";

const PROMPT = "Wie lese ich meinen Laborbefund?";

/** Wie die App seit 3.1: Anfrage vom Sitzungsschluessel, im Umschlag an den Provider (a = Identitaet). */
async function privateKiAnfrage() {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const request = buildJobRequest({ customerPubkey: sitzung.publicKey(), input: PROMPT, bidMsat: 1000, providerPubkey: b.pk });
  const { wrap } = await buildPrivateJobRequest({ request, sessionSigner: sitzung, providerPk: b.pk });
  return { wrap, sitzung: sitzung.publicKey() };
}

const ANTWORT = "Der Wert liegt im Normbereich.";
// Testvektor aus BOLT 11 – oeffentlich, kein Geheimnis.
const BOLT11 = "lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp";

/**
 * Eine ganze private KI-Runde wie seit 3.2e (a = Identitaet, b = Provider):
 * Sitzung, Anfrage, Antwort mit Betrag und Rechnung, Beleg – alles versiegelt.
 */
async function privateKiRunde() {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const provider = new LocalSigner(b.sk);
  const sp = sitzung.publicKey();
  const open = await buildPrivateSessionEvent({ sessionSigner: sitzung, providerPk: b.pk, event: buildSessionOpen({
    customerPubkey: sp, providerPubkey: b.pk, sessionId: "s1", maxTotalMsat: 100_000, maxRatePerKTokenMsat: 1000, settleEveryMsat: 20_000, ttlSecs: 3600,
  }) });
  const { wrap: anfrage, requestId } = await buildPrivateJobRequest({ sessionSigner: sitzung, providerPk: b.pk, request: buildJobRequest({
    customerPubkey: sp, input: PROMPT, bidMsat: 1000, providerPubkey: b.pk,
  }) });
  const antwort = await buildPrivateJobResponse({ providerSigner: provider, sessionPk: sp, response: buildJobResult({
    providerPubkey: b.pk, requestId, requestKind: 5050, customerPubkey: sp, output: ANTWORT, amountMsat: 7000, bolt11: BOLT11,
    usage: { model: "m", promptTokens: 3, completionTokens: 7 },
  }) });
  const beleg = await buildPrivateSessionEvent({ sessionSigner: sitzung, providerPk: b.pk, event: buildSessionPayment({
    customerPubkey: sp, sessionId: "s1", seq: 1, cumulativeMsat: 7000, unitsSinceLast: 7,
  }) });
  return { wraps: [open.wrap, anfrage, antwort.wrap, beleg.wrap] };
}

const NOTIZ = "Antwort zum Laborbefund war unbrauchbar";

/** Reklamation wie seit 3.4: vom Sitzungsschluessel, versiegelt an Provider (b) und Pruefer. */
async function privateReklamation() {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const dispute = buildDispute({
    jobId: "d".repeat(64), customerPubkey: sitzung.publicKey(), providerPubkey: b.pk, reason: "unbrauchbar", amountMsat: 7000, note: NOTIZ,
  });
  const { wraps } = await buildPrivateDispute({ dispute, sessionSigner: sitzung, empfaenger: [{ pk: b.pk }, { pk: generateKeypair().pk }] });
  return { wraps, sitzung: sitzung.publicKey() };
}

const SZENARIEN: Record<string, () => Promise<number>> = {
  "dm-inhalt": async () => {
    const d = await buildPrivateDm({ senderSk: a.sk, senderPk: a.pk, recipientPk: b.pk, content: GEHEIM });
    return regelKeinKlartext([d.toRecipient, d.toSelf], [GEHEIM]).length;
  },
  "dm-absender": async () => {
    const d = await buildPrivateDm({ senderSk: a.sk, senderPk: a.pk, recipientPk: b.pk, content: GEHEIM });
    return regelAutorNicht([d.toRecipient, d.toSelf], a.pk).length;
  },
  "dm-kein-kind4": async () => {
    const d = await buildPrivateDm({ senderSk: a.sk, senderPk: a.pk, recipientPk: b.pk, content: GEHEIM });
    return regelKeinKind4([d.toRecipient, d.toSelf]).length;
  },
  "ki-prompt": async () => {
    const { wrap } = await privateKiAnfrage();
    return regelKeinKlartextPrompt([wrap], [PROMPT]).length + regelKeinKlartext([wrap], [PROMPT]).length;
  },
  "ki-kunde": async () => {
    const { wrap, sitzung } = await privateKiAnfrage();
    return regelKundeVerborgen([wrap], a.pk).length + regelKundeVerborgen([wrap], sitzung).length;
  },
  "ki-antwort": async () => {
    const { wraps } = await privateKiRunde();
    return regelKeinKlartext(wraps, [ANTWORT]).length;
  },
  "ki-zahlung": async () => {
    const { wraps } = await privateKiRunde();
    return regelKeineZahlungsdaten(wraps).length;
  },
  "ki-reklamation": async () => {
    const { wraps, sitzung } = await privateReklamation();
    return regelKeineZahlungsdaten(wraps).length + regelKeinKlartext(wraps, [NOTIZ, "unbrauchbar"]).length
      + regelKundeVerborgen(wraps, sitzung).length + regelKundeVerborgen(wraps, a.pk).length;
  },
  "abdeckung-zelle": async () => {
    const [lat, lon] = [48.137154, 11.576124];
    const funde = (["lora", "bluetooth"] as const).flatMap((layer) => {
      const ev = signEvent(buildCoverageAnnouncement({ pubkey: a.pk, layer, cell: toCell(lat, lon, LAYER_CELL_DEGREES[layer]), region: "" }), a.sk);
      return regelKeinKlartext([ev], [String(lat), String(lon), lat.toFixed(4), lon.toFixed(4)]);
    });
    return funde.length;
  },
};

test("jede belegte Aussage hat ein Szenario", () => {
  for (const f of PRIVACY_FACTS.filter((x) => x.status === "belegt")) {
    assert.ok(SZENARIEN[f.id], `Kein Szenario fuer belegte Aussage "${f.id}"`);
  }
});

test("alle Szenarien fuer belegte Aussagen sind ohne Verstoss", async () => {
  for (const f of PRIVACY_FACTS.filter((x) => x.status === "belegt")) {
    assert.equal(await SZENARIEN[f.id](), 0, f.id);
  }
});

test("belegte Aussagen nennen ihre Regel, und jede genannte Regel gibt es", () => {
  for (const f of PRIVACY_FACTS) {
    if (f.status === "belegt") assert.ok(f.regel, `Belegte Aussage "${f.id}" ohne Regel`);
    if (f.regel) assert.ok(f.regel in LEAK_REGELN, `Aussage "${f.id}": Regel "${f.regel}" gibt es nicht`);
  }
  // Ohne Regel nur, was kein Event-Mitschnitt pruefen kann.
  assert.deepEqual(PRIVACY_FACTS.filter((f) => !f.regel).map((f) => f.id).sort(), ["dm-forward-secrecy", "ip"]);
});

test("offene Aussagen nennen den Schritt, der sie schliesst", () => {
  for (const f of PRIVACY_FACTS.filter((x) => x.status === "offen")) {
    assert.ok(f.schritt, `Offene Aussage "${f.id}" ohne Schritt`);
  }
});

test("der Berichtstext trennt Belegtes und Offenes", () => {
  const t = privacyFactsText();
  assert.match(t, /Durch Tests belegt:/);
  assert.match(t, /Bekannte Lücken:/);
  assert.match(t, /✓ KI-Anfragen sind für Relays nicht lesbar\./);
  assert.match(t, /✓ KI-Antworten sind für Relays nicht lesbar\./);
  assert.match(t, /✓ Reklamationen sind nicht öffentlich – sie gehen versiegelt/);
  assert.match(t, /○ Noch nicht: Räume sind Ende-zu-Ende-verschlüsselt\. \(Ausbauplan 2\.3\)/);
});
