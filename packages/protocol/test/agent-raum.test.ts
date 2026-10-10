/**
 * 11.3d1a: Bausteine für Erwähnungen, gemeinsam für App und Knoten (`agent-raum.ts`).
 *
 * Beweist:
 *  - Die Definition des Gründers wird gefunden (`d` = `space:<kennung>`) – bis 11.3d1a suchte
 *    die App nach `d` = `<kennung>` und fand den Schalter der Agentenketten nie
 *  - Definitionen anderer zählen nie; je Raum die neueste
 *  - „Wer fragt, zahlt“ (`ausBudget: false`): nie auf einen Agenten, auch mit Agentenketten
 *  - Prompt mit festen Grenzen (Knoten): Persona, Verlauf bis zur Erwähnung, Pseudonyme
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent } from "../src/event.js";
import { AGENT_ROLLE, mitAgentRolle } from "../src/agent-karte.js";
import { AuftragsBremse, ausRaumEvent, type RaumNachricht } from "../src/agent-auftrag.js";
import { agentPromptMit, definitionDesGruenders, entscheide, istAgentIm } from "../src/agent-raum.js";
import { buildChannelMessage, buildRoleGrant, buildRoles, buildSpace, buildSpaceState } from "../src/spaces.js";

const gruender = generateKeypair(), fremd = generateKeypair(), agent = generateKeypair(), agent2 = generateKeypair(), mensch = generateKeypair();
const T = 1_800_000_000;
const ADRESSE = `34700:${gruender.pk}:space:werkstatt`;
const definition = (wer: { pk: string; sk: Uint8Array }, zeit: number, ketten?: string) => {
  const u = buildSpace({ spaceId: "werkstatt", name: "W", ownerPubkey: wer.pk, channels: [{ id: "allgemein", name: "allgemein", privacy: "offen", writeRoles: [], position: 0 }] }, zeit);
  if (ketten) u.tags.push(["agentenketten", ketten]);
  return signEvent(u, wer.sk);
};

test("11.3d1a: Definition des Gründers – d = space:<kennung>, nur vom Gründer, die neueste", () => {
  const alt = definition(gruender, T, "5"), neu = definition(gruender, T + 10, "7"), vonFremd = definition(fremd, T + 20, "50");
  assert.deepEqual(definitionDesGruenders(ADRESSE, [alt, neu, vonFremd]).find((t) => t[0] === "agentenketten"), ["agentenketten", "7"]);
  assert.deepEqual(definitionDesGruenders(ADRESSE, [vonFremd]), [], "eine fremde Definition derselben Kennung zählt nie");
  assert.deepEqual(definitionDesGruenders(`34700:${gruender.pk}:space:andere`, [alt]), []);
  assert.deepEqual(definitionDesGruenders("ab".repeat(32), [alt]), [], "eine Gruppen-Id ist keine Adresse");
});

test("11.3d1a: „wer fragt, zahlt“ – nie auf einen Agenten, auch mit Agentenketten; Prompt mit festen Grenzen", () => {
  const def = definition(gruender, T, "10");
  const rollen = signEvent(buildRoles("werkstatt", gruender.pk, mitAgentRolle([{ id: "m", name: "M", rank: 5, permissions: ["lesen", "schreiben"] }])), gruender.sk);
  const stand = buildSpaceState("werkstatt", [def, rollen,
    signEvent(buildRoleGrant("werkstatt", gruender.pk, agent.pk, [AGENT_ROLLE], T), gruender.sk),
    signEvent(buildRoleGrant("werkstatt", gruender.pk, agent2.pk, [AGENT_ROLLE], T), gruender.sk),
    signEvent(buildRoleGrant("werkstatt", gruender.pk, mensch.pk, ["m"], T), gruender.sk)]);
  let z = T;
  const sag = (von: { pk: string; sk: Uint8Array }, text: string, erwaehnt: string[] = []) =>
    signEvent(buildChannelMessage({ authorPubkey: von.pk, spaceId: "werkstatt", channelId: "allgemein", content: text, mentions: erwaehnt }, z++), von.sk);
  const vonAgent = sag(agent2, "@A1", [agent.pk]);
  const basis = { agent: agent.pk, ev: vonAgent, alle: [vonAgent], stand, definition: definitionDesGruenders(ADRESSE, [def]), jetzt: T };
  assert.equal(entscheide({ ...basis, bremse: new AuftragsBremse() }).art, "antworten", "aus einem Budget: mit Ketten ja");
  assert.deepEqual(entscheide({ ...basis, bremse: new AuftragsBremse(), ausBudget: false }), { art: "schweigen", grund: "ohne-budget" });
  const vorher = sag(mensch, "x".repeat(50));
  const frage = sag(mensch, "@A1 hilf", [agent.pk]);
  const alle = [vorher, frage].map(ausRaumEvent) as RaumNachricht[];
  const p = agentPromptMit({ agent: agent.pk, persona: "P", nachricht: alle[1]!, alle, istAgent: istAgentIm(stand), grenzen: { nachrichten: 6, zeichen: 3000, jeNachricht: 10 } });
  assert.equal(p, `[Rolle]:\nP\n\n[Bisheriger Verlauf]:\nPerson 1: ${"x".repeat(10)} …\n\n[Nachricht von Person 1]:\n@A1 hilf`);
  assert.ok(!p.includes(mensch.pk), "nie Schlüssel");
});
