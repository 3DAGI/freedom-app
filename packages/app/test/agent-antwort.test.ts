/**
 * 11.3c2a (Entwurf AGENTEN-RAUM-ENTWURF.md P3, F3 B, F5): Erwähnungen beantworten – ohne Netz.
 *
 * Beweist:
 *  - Auslöser nur nach den Regeln aus 11.3b mit dem Stand des Raums: erwähnt, nicht selbst,
 *    Schreibrecht im Kanal (auch der Agent selbst), Agenten an der Rolle erkannt,
 *    Agentenketten nur mit Schalter in der Definition; die Bremse zählt nur echte Aufträge
 *  - Prompt: Persona, Verlauf nur des Kanals bis zur Erwähnung, Absender als Pseudonym – nie
 *    Schlüssel; „aus“ heißt ohne Verlauf
 *  - Antwort: Kind 42 des Agenten, Raum, Kanal, Thread, Antwort auf die Erwähnung, Fragender
 *    erwähnt, gekürzt; Hinweis ohne Erwähnung
 *  - Sitzungsschlüssel je Agent und Raum
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AGENT_AUFTRAG, AGENT_ROLLE, AuftragsBremse, ausRaumEvent, buildChannelMessage, buildRoleGrant, buildRoles, buildSpace,
  buildSpaceState, generateKeypair, mitAgentRolle, signEvent, type NostrEvent, type RaumNachricht,
} from "@freedomstack/protocol";
import { AgentSitzungen, agentAntwortEvent, agentHinweisEvent, agentPrompt, entscheide, istAgentIm } from "../src/agent-antwort.js";

const gruender = generateKeypair(), agent = generateKeypair(), agent2 = generateKeypair(), mensch = generateKeypair(), fremd = generateKeypair();
const T = 1_800_000_000;
let z = T;
const raum = signEvent(buildSpace({
  spaceId: "werkstatt", name: "Werkstatt", ownerPubkey: gruender.pk,
  channels: [
    { id: "allgemein", name: "allgemein", privacy: "offen", writeRoles: [], position: 0 },
    { id: "news", name: "news", privacy: "offen", writeRoles: ["mod"], position: 1 },
  ],
}, T), gruender.sk);
const rollen = signEvent(buildRoles("werkstatt", gruender.pk, mitAgentRolle([{ id: "mitglied", name: "Mitglied", rank: 5, permissions: ["lesen", "schreiben"] }])), gruender.sk);
const zuweisungen = [
  signEvent(buildRoleGrant("werkstatt", gruender.pk, agent.pk, [AGENT_ROLLE], T), gruender.sk),
  signEvent(buildRoleGrant("werkstatt", gruender.pk, agent2.pk, [AGENT_ROLLE], T), gruender.sk),
  signEvent(buildRoleGrant("werkstatt", gruender.pk, mensch.pk, ["mitglied"], T), gruender.sk),
];
const stand = buildSpaceState("werkstatt", [raum, rollen, ...zuweisungen]);
const nachricht = (von: { pk: string; sk: Uint8Array }, text: string, o: { kanal?: string; erwaehnt?: string[]; replyTo?: string; threadRoot?: string } = {}): NostrEvent =>
  signEvent(buildChannelMessage({ authorPubkey: von.pk, spaceId: "werkstatt", channelId: o.kanal ?? "allgemein", content: text, mentions: o.erwaehnt ?? [], replyTo: o.replyTo, threadRoot: o.threadRoot }, z++), von.sk);
const basis = (ev: NostrEvent, alle: NostrEvent[], o: { definition?: string[][]; bremse?: AuftragsBremse } = {}) =>
  entscheide({ agent: agent.pk, ev, alle, stand, definition: o.definition ?? [], bremse: o.bremse ?? new AuftragsBremse(), jetzt: T });

test("11.3c2a: Auslöser nur nach den Regeln – mit dem Stand des Raums", () => {
  const frage = nachricht(mensch, "@Lektor hilf", { erwaehnt: [agent.pk] });
  assert.equal(basis(frage, [frage]).art, "antworten");
  assert.deepEqual(basis(nachricht(mensch, "ohne"), []), { art: "schweigen", grund: "nicht-erwaehnt" });
  assert.deepEqual(basis(nachricht(agent, "ich", { erwaehnt: [agent.pk] }), []), { art: "schweigen", grund: "selbst" });
  assert.deepEqual(basis(nachricht(fremd, "@L", { erwaehnt: [agent.pk] }), []), { art: "schweigen", grund: "kein-schreibrecht" }, "ohne Rolle (kein „Jeder“)");
  assert.deepEqual(basis(nachricht(mensch, "@L", { kanal: "news", erwaehnt: [agent.pk] }), []), { art: "schweigen", grund: "agent-ohne-schreibrecht" }, "Kanal nur für Moderatoren");
  assert.deepEqual(basis({ ...frage, kind: 1 }, []), { art: "schweigen", grund: "keine-nachricht" });
});

test("11.3c2a: Agentenketten nur mit Schalter in der Definition; Bremse zählt nur Aufträge", () => {
  const frage = nachricht(mensch, "@A2 und dann @A1", { erwaehnt: [agent2.pk] });
  const a2 = nachricht(agent2, "@A1 bitte", { erwaehnt: [agent.pk], replyTo: frage.id });
  assert.ok(istAgentIm(stand)(agent2.pk) && !istAgentIm(stand)(mensch.pk));
  assert.deepEqual(basis(a2, [frage, a2]), { art: "schweigen", grund: "agent-ohne-ketten" });
  assert.equal(basis(a2, [frage, a2], { definition: [["agentenketten", "10"]] }).art, "antworten");
  assert.deepEqual(basis(a2, [frage, a2], { definition: [["agentenketten", "1"]] }), { art: "schweigen", grund: "kette-voll" });
  const bremse = new AuftragsBremse();
  for (let i = 0; i < AGENT_AUFTRAG.jeMinute; i++) basis(nachricht(mensch, "ohne Erwähnung"), [], { bremse });
  const fragen = Array.from({ length: AGENT_AUFTRAG.jeMinute + 1 }, () => nachricht(mensch, "@L", { erwaehnt: [agent.pk] }));
  assert.deepEqual(fragen.map((f) => basis(f, [], { bremse }).art), ["antworten", "antworten", "antworten", "schweigen"]);
});

test("11.3c2a: Prompt – Persona, nur dieser Kanal bis zur Erwähnung, Pseudonyme statt Schlüssel", () => {
  const vorher = nachricht(mensch, "Hier ist mein Text.");
  const anderer = nachricht(mensch, "geheim im anderen Kanal", { kanal: "news" });
  const vomAgenten2 = nachricht(agent2, "Ich habe Kommas geprüft.");
  const eigene = nachricht(agent, "Früher schon gelesen.");
  const frage = nachricht(fremd, "@Lektor bitte lesen", { erwaehnt: [agent.pk] });
  const danach = nachricht(mensch, "später");
  const alle = [vorher, anderer, vomAgenten2, eigene, frage, danach].map(ausRaumEvent) as RaumNachricht[];
  const p = agentPrompt({ agent: agent.pk, persona: "Du bist Lektor.", nachricht: alle[4]!, alle, istAgent: istAgentIm(stand), umfang: "kurz" });
  assert.equal(p, [
    "[Rolle]:\nDu bist Lektor.",
    "[Bisheriger Verlauf]:\nPerson 1: Hier ist mein Text.\nAgent 1: Ich habe Kommas geprüft.\nDu: Früher schon gelesen.",
    "[Nachricht von Person 2]:\n@Lektor bitte lesen",
  ].join("\n\n"));
  for (const pk of [mensch.pk, fremd.pk, agent.pk, agent2.pk]) assert.ok(!p.includes(pk), "nie ein Schlüssel");
  assert.ok(!p.includes("geheim") && !p.includes("später"));
  assert.ok(!agentPrompt({ agent: agent.pk, persona: "P", nachricht: alle[4]!, alle, istAgent: istAgentIm(stand), umfang: "aus" }).includes("Verlauf"), "aus");
});

test("11.3c2a: Antwort und Hinweis des Agenten", () => {
  const root = nachricht(mensch, "Thema");
  const frage = ausRaumEvent(nachricht(mensch, "@L?", { erwaehnt: [agent.pk], threadRoot: root.id, replyTo: root.id }))!;
  const ev = agentAntwortEvent({ agent: agent.pk, kennung: "werkstatt", auf: frage, text: "x".repeat(AGENT_AUFTRAG.antwortZeichen + 5), jetzt: T });
  assert.equal(ev.kind, 42);
  assert.equal(ev.pubkey, agent.pk);
  assert.deepEqual(ev.tags, [["space", "werkstatt"], ["h", "allgemein"], ["e", root.id, "", "root"], ["e", frage.id, "", "reply"], ["p", mensch.pk, "", "mention"]]);
  assert.equal([...ev.content].length, AGENT_AUFTRAG.antwortZeichen);
  const ohneThread = agentAntwortEvent({ agent: agent.pk, kennung: "werkstatt", auf: { ...frage, threadRoot: undefined }, text: "kurz" });
  assert.ok(!ohneThread.tags.some((t) => t[3] === "root"));
  const h = agentHinweisEvent({ agent: agent.pk, kennung: "werkstatt", kanal: "allgemein", text: "Budget erreicht" });
  assert.ok(!h.tags.some((t) => t[0] === "p"), "ohne Erwähnung");
});

test("11.3c2a: Sitzungsschlüssel je Agent und Raum", () => {
  const s = new AgentSitzungen();
  const a = s.fuer(agent.pk, "r1").fuer("prov");
  assert.equal(s.fuer(agent.pk, "r1").fuer("prov"), a);
  assert.notEqual(s.fuer(agent.pk, "r2").fuer("prov").publicKey(), a.publicKey(), "anderer Raum");
  assert.notEqual(s.fuer(agent2.pk, "r1").fuer("prov").publicKey(), a.publicKey(), "anderer Agent");
});

test("11.3d1b1: Verdrahtung – „@Name“ beim Senden im Raum, offen aus den Karten der Agenten, privat aus der Gruppe", () => {
  const raeume = readFileSync(new URL("../src/shell/tabs/raeume.ts", import.meta.url), "utf8");
  assert.match(raeume, /const karten = spacesUi\.privat \? raumAgentKarten\(spacesUi\.privat\.ereignisse\) : spacesUi\.agentKarten;/);
  assert.match(raeume, /const erwaehnt = \[\.\.\.new Set\(\[\.\.\.\(bezug\?\.erwaehnt \?\? \[\]\), \.\.\.erwaehnteAgenten\(text, karten\)\]\)\];/);
  assert.match(raeume, /sendePrivat\(spacesUi\.privat\.gruppe, spacesUi\.channelId, text, \{ \.\.\.bezug, erwaehnt \}\)/);
  assert.match(raeume, /content: text, mentions: erwaehnt,/);
  assert.match(raeume, /spacesUi\.agentKarten = await agentKartenIm\(spacesUi\.state, pool\);/);
  assert.match(raeume, /\.filter\(istAgentIm\(s\)\)/, "nur Mitglieder mit der Rolle agent");
});
