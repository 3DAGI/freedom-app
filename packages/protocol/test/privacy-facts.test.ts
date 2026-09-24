/**
 * Der Datenschutzbericht darf nur als "belegt" zeigen, was ein Leak-Test prueft
 * (Schritt 1.5). Jede belegte Aussage braucht hier ein Szenario, das gruen ist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRIVACY_FACTS, privacyFactsText } from "../src/privacy-facts.js";
import { buildPrivateDm } from "../src/private-dm.js";
import { generateKeypair } from "../src/event.js";
import { regelAutorNicht, regelKeinKind4, regelKeinKlartext } from "../src/leak-rules.js";

const a = generateKeypair();
const b = generateKeypair();
const GEHEIM = "streng geheimer Inhalt 4711";

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

test("offene Aussagen nennen den Schritt, der sie schliesst", () => {
  for (const f of PRIVACY_FACTS.filter((x) => x.status === "offen")) {
    assert.ok(f.schritt, `Offene Aussage "${f.id}" ohne Schritt`);
  }
});

test("der Berichtstext trennt Belegtes und Offenes", () => {
  const t = privacyFactsText();
  assert.match(t, /Durch Tests belegt:/);
  assert.match(t, /Bekannte Lücken:/);
  assert.match(t, /KI-Anfragen sind für Relays nicht lesbar\. \(Ausbauplan 3\.1\)/);
});
