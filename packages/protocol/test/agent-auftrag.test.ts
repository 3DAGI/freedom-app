/**
 * 11.3b2 (Entwurf AGENTEN-RAUM-ENTWURF.md P3, P5, F2, F5): wann ein Agent antwortet und womit.
 *
 * Beweist:
 *  - Auslöser nur bei Erwähnung, nie sich selbst, nur mit Schreibrecht
 *  - Agentenketten: ohne Schalter nie, ohne Budget nie, Grenze aus dem Raum gezählt (rückwärts bis zum Menschen)
 *  - Schalter streng gelesen: Unsinn und mehr als 50 heißt aus; beim Bauen wirft Unsinn
 *  - Bremse: 3 je Absender und Minute, danach wieder
 *  - Kontext nur aus Kanal bzw. Thread, nur davor, in den Grenzen; andere Agenten gekennzeichnet
 *  - Verweis im Kern streng; Antwort: Tags, Länge, innen wie jede Nachricht
 *  - Monatsbudget: kumulativ je eine Stufe über dem Verbrauchten, nie über dem Budget
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_AUFTRAG, AGENTENKETTE, AuftragsBremse, agentAntwortTags, agentKontext, agentenkettenTag, ausInnererNachricht,
  ausRaumEvent, auftragsVerweisTags, budgetStufe, kettenLaenge, kuerzeAgentAntwort, leseAgentenketten, leseAuftragsVerweis,
  naechsteStufe, raumAgentAntwort, sollAntworten, type RaumNachricht,
} from "../src/agent-auftrag.js";
import { buildEvent, generateKeypair, signEvent } from "../src/event.js";
import { raumAdresse } from "../src/spaces.js";

const mensch = "aa".repeat(32), agentA = "bb".repeat(32), agentB = "cc".repeat(32), fremd = "dd".repeat(32);
const istAgent = (pk: string) => pk === agentA || pk === agentB;
const id = (i: number) => i.toString(16).padStart(64, "0");
let z = 1_800_000_000;
const n = (i: number, von: string, o: Partial<RaumNachricht> = {}): RaumNachricht => ({ id: id(i), von, zeit: z++, text: `t${i}`, kanal: "allgemein", erwaehnt: [], ...o });

test("11.3b2: Auslöser – nur erwähnt, nie selbst, nur mit Schreibrecht", () => {
  const basis = { alle: [], darfSchreiben: (pk: string) => pk !== fremd, istAgent, ketten: null, ausBudget: false };
  assert.deepEqual(sollAntworten({ ...basis, agent: agentA, nachricht: n(1, mensch, { erwaehnt: [agentA] }) }), { ja: true });
  assert.deepEqual(sollAntworten({ ...basis, agent: agentA, nachricht: n(2, mensch) }), { ja: false, grund: "nicht-erwaehnt" });
  assert.deepEqual(sollAntworten({ ...basis, agent: agentA, nachricht: n(3, agentA, { erwaehnt: [agentA] }) }), { ja: false, grund: "selbst" });
  assert.deepEqual(sollAntworten({ ...basis, agent: agentA, nachricht: n(4, fremd, { erwaehnt: [agentA] }) }), { ja: false, grund: "kein-schreibrecht" });
});

test("11.3b2: Agentenketten – ohne Schalter nie, ohne Budget nie, Grenze aus dem Raum", () => {
  const frage = n(10, mensch, { erwaehnt: [agentA] });
  const a1 = n(11, agentA, { replyTo: frage.id, erwaehnt: [agentB] });
  const b1 = n(12, agentB, { replyTo: a1.id, erwaehnt: [agentA] });
  const a2 = n(13, agentA, { replyTo: b1.id, erwaehnt: [agentB] });
  const alle = [frage, a1, b1, a2];
  assert.equal(kettenLaenge(a2, alle, istAgent), 3, "rückwärts bis zum Menschen");
  assert.equal(kettenLaenge(frage, alle, istAgent), 0);
  const p = { agent: agentB, alle, darfSchreiben: () => true, istAgent };
  assert.deepEqual(sollAntworten({ ...p, nachricht: a1, ketten: null, ausBudget: true }), { ja: false, grund: "agent-ohne-ketten" });
  assert.deepEqual(sollAntworten({ ...p, nachricht: a1, ketten: 10, ausBudget: false }), { ja: false, grund: "ohne-budget" });
  assert.deepEqual(sollAntworten({ ...p, nachricht: a1, ketten: 10, ausBudget: true }), { ja: true });
  assert.deepEqual(sollAntworten({ ...p, nachricht: a2, ketten: 3, ausBudget: true }), { ja: false, grund: "kette-voll" });
  assert.deepEqual(sollAntworten({ ...p, nachricht: a2, ketten: 4, ausBudget: true }), { ja: true });
  // Ein Mensch dazwischen beginnt neu
  const mensch2 = n(14, mensch, { replyTo: a2.id, erwaehnt: [agentA] });
  const a3 = n(15, agentA, { replyTo: mensch2.id, erwaehnt: [agentB] });
  assert.equal(kettenLaenge(a3, [...alle, mensch2, a3], istAgent), 1);
  // Kreis (gefälschte replyTo) endet
  const k1 = n(16, agentA, { replyTo: id(17) }), k2 = n(17, agentB, { replyTo: id(16) });
  assert.equal(kettenLaenge(k1, [k1, k2], istAgent), 2);
});

test("11.3b2: Schalter streng – Unsinn und mehr als 50 heißt aus", () => {
  assert.deepEqual(agentenkettenTag(10), ["agentenketten", "10"]);
  assert.equal(agentenkettenTag(null), null);
  for (const g of [0, 51, 2.5]) assert.throws(() => agentenkettenTag(g));
  assert.equal(leseAgentenketten([["agentenketten", "10"]]), 10);
  assert.equal(leseAgentenketten([["agentenketten", String(AGENTENKETTE.hoechstens)]]), 50);
  for (const t of [[], [["agentenketten", "51"]], [["agentenketten", "0"]], [["agentenketten", "x"]], [["agentenketten", "5"], ["agentenketten", "6"]]]) {
    assert.equal(leseAgentenketten(t), null, JSON.stringify(t));
  }
});

test("11.3b2: Bremse – 3 je Absender und Minute", () => {
  const b = new AuftragsBremse();
  const t = 1_800_000_000;
  assert.deepEqual([1, 2, 3, 4].map(() => b.erlaubt(mensch, t)), [true, true, true, false]);
  assert.equal(b.erlaubt(agentA, t), true, "je Absender");
  assert.equal(b.erlaubt(mensch, t + 61), true);
  assert.equal(AGENT_AUFTRAG.jeMinute, 3);
});

test("11.3b2: Kontext – nur Kanal bzw. Thread, nur davor, in den Grenzen", () => {
  const vor1 = n(20, mensch, { text: "Hallo" });
  const anderer = n(21, mensch, { kanal: "anderer", text: "geheim" });
  const imThread = n(22, mensch, { threadRoot: vor1.id, text: "im Thread" });
  const agentSagt = n(23, agentB, { text: "von B" });
  const frage = n(24, mensch, { erwaehnt: [agentA], text: "@A?" });
  const danach = n(25, mensch, { text: "später" });
  const alle = [vor1, anderer, imThread, agentSagt, frage, danach];
  assert.deepEqual(agentKontext({ nachricht: frage, alle, nachrichten: 6, zeichen: 3000, istAgent }),
    [{ von: mensch, agent: false, text: "Hallo" }, { von: agentB, agent: true, text: "von B" }]);
  assert.deepEqual(agentKontext({ nachricht: frage, alle, nachrichten: 1, zeichen: 3000, istAgent }).map((k) => k.text), ["von B"], "die letzten");
  assert.deepEqual(agentKontext({ nachricht: frage, alle, nachrichten: 6, zeichen: 5, istAgent }).map((k) => k.text), ["von B"], "Zeichen");
  const frageImThread = n(26, mensch, { threadRoot: vor1.id, erwaehnt: [agentA] });
  assert.deepEqual(agentKontext({ nachricht: frageImThread, alle: [...alle, frageImThread], nachrichten: 6, zeichen: 3000, istAgent }).map((k) => k.text),
    ["Hallo", "im Thread"], "im Thread nur der Thread samt Anfang");
});

test("11.3b2: Nachrichten offen und innen gelesen; Verweis streng; Antwort", () => {
  const kp = generateKeypair();
  const ev = signEvent(buildEvent(kp.pk, 42, [["h", "allgemein"], ["e", id(1), "", "reply"], ["p", agentA, "", "mention"], ["p", fremd]], "@A hilf", z), kp.sk);
  const r = ausRaumEvent(ev)!;
  assert.deepEqual([r.kanal, r.replyTo, r.erwaehnt], ["allgemein", id(1), [agentA]], "nur mention zählt");
  assert.equal(ausRaumEvent({ ...ev, kind: 1 }), null);
  assert.equal(ausInnererNachricht({ id: id(2), von: mensch, art: 9, tags: [["h", "k"]], text: "x", zeit: z })?.kanal, "k");
  assert.equal(ausInnererNachricht({ id: id(3), von: mensch, art: 9, tags: [], text: "x", zeit: z }), null, "ohne Kanal");

  const adresse = raumAdresse(kp.pk, "werkstatt");
  assert.deepEqual(leseAuftragsVerweis(auftragsVerweisTags({ raum: adresse, erwaehnung: ev.id })), { raum: adresse, erwaehnung: ev.id });
  assert.deepEqual(leseAuftragsVerweis(auftragsVerweisTags({ raum: "ee".repeat(32), erwaehnung: ev.id }))?.raum, "ee".repeat(32), "Gruppe");
  // 11.3d2b: MDK vergibt Gruppen-Ids mit 16 Byte (32 Zeichen) – bis hier passte keine echte Gruppe
  assert.deepEqual(leseAuftragsVerweis(auftragsVerweisTags({ raum: "ab".repeat(16), erwaehnung: ev.id }))?.raum, "ab".repeat(16), "Gruppe von MDK");
  for (const falsch of ["ab".repeat(15), "AB".repeat(16), "ab".repeat(33), "zz".repeat(16)]) {
    assert.throws(() => auftragsVerweisTags({ raum: falsch, erwaehnung: ev.id }), falsch);
    assert.equal(leseAuftragsVerweis([["agent-raum", falsch], ["agent-erwaehnung", ev.id]]), null, falsch);
  }
  assert.throws(() => auftragsVerweisTags({ raum: "irgendwas", erwaehnung: ev.id }));
  assert.equal(leseAuftragsVerweis([["agent-raum", adresse], ["agent-erwaehnung", ev.id], ["agent-erwaehnung", ev.id]]), null, "doppelt");
  assert.equal(leseAuftragsVerweis([["agent-raum", adresse]]), null);

  const auf = { ...r, threadRoot: id(9) };
  assert.deepEqual(agentAntwortTags(auf), [["h", "allgemein"], ["e", id(9), "", "root"], ["e", ev.id, "", "reply"], ["p", kp.pk, "", "mention"]]);
  const lang = "x".repeat(AGENT_AUFTRAG.antwortZeichen + 10);
  assert.equal([...kuerzeAgentAntwort(lang)].length, AGENT_AUFTRAG.antwortZeichen);
  assert.equal(kuerzeAgentAntwort("kurz"), "kurz");
  const innen = raumAgentAntwort(auf, lang);
  assert.equal(innen.art, 9);
  assert.equal([...innen.text].length, AGENT_AUFTRAG.antwortZeichen);
  assert.deepEqual(innen.tags.filter((t) => t[0] === "e" || t[0] === "p"), [["e", id(9), "", "root"], ["e", ev.id, "", "reply"], ["p", kp.pk, "", "mention"]]);
});

test("11.3b2: Monatsbudget – kumulativ, eine Stufe über dem Verbrauchten, nie über dem Budget", () => {
  const budget = 1_000_000n;
  const stufe = budgetStufe(budget);
  assert.equal(stufe, 100_000n, "Standard 10 %");
  assert.equal(budgetStufe(5n), 1n, "mindestens 1");
  assert.throws(() => budgetStufe(0n));
  assert.throws(() => budgetStufe(budget, 0));
  assert.equal(naechsteStufe({ budget, stufe, verbraucht: 0n, gutgeschrieben: 0n }), 100_000n);
  assert.equal(naechsteStufe({ budget, stufe, verbraucht: 40_000n, gutgeschrieben: 100_000n }), 140_000n, "nachziehen");
  assert.equal(naechsteStufe({ budget, stufe, verbraucht: 0n, gutgeschrieben: 100_000n }), null, "reicht noch");
  assert.equal(naechsteStufe({ budget, stufe, verbraucht: 950_000n, gutgeschrieben: 1_000_000n }), null, "Budget erreicht");
  assert.equal(naechsteStufe({ budget, stufe, verbraucht: 950_000n, gutgeschrieben: 960_000n }), 1_000_000n, "nie über dem Budget");
  assert.throws(() => naechsteStufe({ budget, stufe: 0n, verbraucht: 0n, gutgeschrieben: 0n }));
});
