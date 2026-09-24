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
  LEAK_REGELN, regelAutorNicht, regelKeinKind4, regelKeinKlartext, regelKeinKlartextPrompt, regelKundeVerborgen,
} from "../src/leak-rules.js";
import { LAYER_CELL_DEGREES, buildCoverageAnnouncement, toCell } from "../src/coverage.js";
import { signEvent } from "../src/event.js";
import { buildJobRequest } from "../src/dvm.js";
import { buildPrivateJobRequest } from "../src/private-job.js";
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
  assert.match(t, /○ Noch nicht: KI-Antworten sind für Relays nicht lesbar\. \(Ausbauplan 3\.2\)/);
});
