/**
 * 11.3b1 (Entwurf AGENTEN-RAUM-ENTWURF.md, freigegeben 08.10.2026): Agent-Karte, Besitzer, Rolle.
 *
 * Beweist:
 *  - Karte 38090 hin und zurück, offen und als inneres Event; je Agent die neueste
 *  - fremde Karten streng: Signatur, Art, Felder doppelt, unbekannte Werte, zu lang, Steuerzeichen,
 *    Besitzer = Agent, Inhalt nicht leer → keine Karte; beim Bauen wirft Unsinn
 *  - Besitzer nur bestätigt (F1 A): neueste Liste des Besitzers nennt den Agenten; widerrufen, fremde Liste,
 *    behauptet ohne Liste → kein Besitzer; auch aus inneren Events
 *  - Rolle `agent` nur mit Grundrechten – auch wenn jemand sie mit mehr Rechten anlegt; `can()` gibt ihm nie Moderation
 *  - Leak-Regel agent-raum-privat: Karte, Liste, Nachrichten offen → Fund; Umschläge, Gruppen-Nachrichten,
 *    KeyPackages und fremde Agenten nicht
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_GRENZEN, AGENT_RECHTE, AGENT_ROLLE, KIND_AGENT_KARTE, aktuelleAgentKarten, agentRolle, baueAgentKarte,
  baueAgentenListe, besitzerBestaetigt, leseAgentKarte, mitAgentRolle, raumAgentKarte, raumAgentKarten,
  raumAgentenListe, raumListenEvents, type AgentKarteDaten,
} from "../src/agent-karte.js";
import { buildEvent, generateKeypair, signEvent, type NostrEvent } from "../src/event.js";
import { buildRoleGrant, buildRoles, buildSpace, buildSpaceState, can } from "../src/spaces.js";
import { regelAgentRaumPrivat } from "../src/leak-rules.js";
import type { InneresEvent } from "../src/raum-gruppe.js";

const agent = generateKeypair();
const besitzer = generateKeypair();
const fremd = generateKeypair();
const T = 1_800_000_000;
const KARTE: AgentKarteDaten = { name: "Lektor", about: "Liest Texte gegen.", betrieb: "knoten", bezahlung: "fragender", besitzer: besitzer.pk, provider: fremd.pk, modell: "llama3.1:8b" };
const signiert = (kp: { pk: string; sk: Uint8Array }, ev: ReturnType<typeof buildEvent>): NostrEvent => signEvent(ev, kp.sk);

test("11.3b1: Karte hin und zurück – offen, je Agent die neueste", () => {
  const ev = signiert(agent, baueAgentKarte(agent.pk, KARTE, T));
  assert.equal(ev.kind, KIND_AGENT_KARTE);
  assert.deepEqual(ev.tags.find((t) => t[0] === "p"), ["p", besitzer.pk, "", "besitzer"]);
  const k = leseAgentKarte(ev)!;
  assert.deepEqual({ ...k, id: undefined, zeit: undefined }, { ...KARTE, agent: agent.pk, id: undefined, zeit: undefined });
  const neuer = signiert(agent, baueAgentKarte(agent.pk, { name: "Lektor 2", betrieb: "geraet", bezahlung: "einlader" }, T + 5));
  const [jetzt] = aktuelleAgentKarten([ev, neuer]);
  assert.equal(jetzt!.name, "Lektor 2");
  assert.equal(jetzt!.besitzer, undefined);
  assert.ok(!neuer.tags.some((t) => t[0] === "persona" || t[0] === "system"), "keine Anweisung in der Karte (F4 A)");
});

test("11.3b1: fremde Karten streng gelesen, Unsinn beim Bauen wirft", () => {
  const roh = (tags: string[][], content = "", kind = KIND_AGENT_KARTE) => signEvent(buildEvent(agent.pk, kind, tags, content, T), agent.sk);
  const gut = [["d", "karte"], ["name", "A"], ["betrieb", "knoten"], ["bezahlung", "einlader"]];
  assert.ok(leseAgentKarte(roh(gut)));
  const faelle: [string, string[][], string?, number?][] = [
    ["anderer d", [["d", "x"], ...gut.slice(1)]],
    ["Name doppelt", [...gut, ["name", "B"]]],
    ["Betrieb unbekannt", [["d", "karte"], ["name", "A"], ["betrieb", "cloud"], ["bezahlung", "einlader"]]],
    ["Bezahlung fehlt", gut.slice(0, 3)],
    ["Name zu lang", [["d", "karte"], ["name", "x".repeat(AGENT_GRENZEN.name + 1)], ["betrieb", "knoten"], ["bezahlung", "einlader"]]],
    ["Steuerzeichen", [["d", "karte"], ["name", "A\u0007"], ["betrieb", "knoten"], ["bezahlung", "einlader"]]],
    ["Besitzer ist der Agent", [...gut, ["p", agent.pk, "", "besitzer"]]],
    ["zwei Besitzer", [...gut, ["p", besitzer.pk, "", "besitzer"], ["p", fremd.pk, "", "besitzer"]]],
    ["Provider kein Hex", [...gut, ["provider", "npub1…"]]],
    ["Inhalt", gut, "Du bist ein hilfreicher Agent"],
    ["andere Art", gut, "", 38091],
  ];
  for (const [was, tags, content, kind] of faelle) assert.equal(leseAgentKarte(roh(tags, content, kind)), null, was);
  assert.equal(leseAgentKarte({ ...roh(gut), sig: "00".repeat(64) }), null, "Signatur");
  assert.throws(() => baueAgentKarte(agent.pk, { ...KARTE, name: "" }));
  assert.throws(() => baueAgentKarte(agent.pk, { ...KARTE, besitzer: agent.pk }));
  assert.throws(() => baueAgentKarte("xyz", KARTE));
});

test("11.3b1: Besitzer nur bestätigt (F1 A) – neueste Liste zählt, auch innen", () => {
  const karte = leseAgentKarte(signiert(agent, baueAgentKarte(agent.pk, KARTE, T)))!;
  const liste = (agenten: string[], zeit: number, kp = besitzer) => signiert(kp, baueAgentenListe(kp.pk, agenten, zeit));
  assert.equal(besitzerBestaetigt(karte, []), null, "behauptet ohne Liste");
  assert.equal(besitzerBestaetigt(karte, [liste([agent.pk], T)]), besitzer.pk);
  assert.equal(besitzerBestaetigt(karte, [liste([agent.pk], T), liste([], T + 1)]), null, "widerrufen");
  assert.equal(besitzerBestaetigt(karte, [liste([agent.pk], T, fremd)]), null, "Liste eines anderen");
  assert.equal(besitzerBestaetigt({ agent: agent.pk }, [liste([agent.pk], T)]), null, "Karte nennt keinen Besitzer");
  assert.throws(() => baueAgentenListe(besitzer.pk, [besitzer.pk]), "nie sich selbst");
  assert.throws(() => baueAgentenListe(besitzer.pk, Array.from({ length: AGENT_GRENZEN.agentenJeListe + 1 }, (_, i) => i.toString(16).padStart(64, "0"))));
  // Innen: Karte vom Agenten, Liste vom Besitzer – Absender belegt MLS
  const innen = (von: string, s: { art: number; tags: string[][]; text: string }, zeit: number, id: string): InneresEvent => ({ id, von, zeit, ...s });
  const ereignisse = [
    innen(agent.pk, raumAgentKarte(KARTE), T, "a1"),
    innen(agent.pk, raumAgentKarte({ ...KARTE, name: "Lektor neu" }), T + 2, "a2"),
    innen(fremd.pk, { art: KIND_AGENT_KARTE, tags: [["d", "karte"], ["name", "Kaputt"]], text: "" }, T, "f1"),
    innen(besitzer.pk, raumAgentenListe(besitzer.pk, [agent.pk]), T, "b1"),
  ];
  const karten = raumAgentKarten(ereignisse);
  assert.deepEqual(karten.map((k) => k.name), ["Lektor neu"], "je Agent die neueste, Kaputtes nicht");
  assert.equal(besitzerBestaetigt(karten[0]!, raumListenEvents(ereignisse)), besitzer.pk);
  assert.equal(besitzerBestaetigt(karten[0]!, raumListenEvents(ereignisse.filter((e) => e.von !== besitzer.pk))), null);
});

test("11.3b1: Rolle agent – nur Grundrechte, auch wenn jemand sie mit mehr anlegt", () => {
  assert.deepEqual(agentRolle(), { id: AGENT_ROLLE, name: "Agent", rank: 1, permissions: ["lesen", "schreiben", "threads"] });
  const mod = { id: "mod", name: "Moderator", rank: 50, permissions: ["moderieren" as const] };
  assert.deepEqual(mitAgentRolle([mod]).map((r) => r.id), ["mod", "agent"]);
  const zuViel = mitAgentRolle([{ ...agentRolle(), permissions: ["lesen", "moderieren", "rollen_vergeben", "repos_pflegen"] }]);
  assert.deepEqual(zuViel[0]!.permissions, ["lesen"]);
  // In einem offenen Raum: zugewiesen schreibt er, moderiert nie
  const raum = signiert(besitzer, buildSpace({ spaceId: "werkstatt", name: "Werkstatt", ownerPubkey: besitzer.pk, channels: [{ id: "allgemein", name: "allgemein", privacy: "offen", writeRoles: [], position: 0 }] }));
  const rollen = signiert(besitzer, buildRoles("werkstatt", besitzer.pk, mitAgentRolle([mod])));
  const zuweisung = signiert(besitzer, buildRoleGrant("werkstatt", besitzer.pk, agent.pk, [AGENT_ROLLE]));
  const stand = buildSpaceState("werkstatt", [raum, rollen, zuweisung]);
  assert.ok(can(agent.pk, "schreiben", stand));
  for (const r of ["moderieren", "rollen_vergeben", "kanaele_verwalten", "repos_pflegen"] as const) assert.ok(!can(agent.pk, r, stand), r);
  assert.ok(AGENT_RECHTE.every((r) => can(agent.pk, r, stand)));
});

test("agent-raum-privat: Karte, Liste und Nachrichten offen – nicht Umschläge, Gruppen-Nachrichten, KeyPackages, fremde", () => {
  const ev = (kp: { pk: string; sk: Uint8Array }, kind: number, tags: string[][], content = "") => signEvent(buildEvent(kp.pk, kind, tags, content, T), kp.sk);
  const regel = (evs: NostrEvent[]) => regelAgentRaumPrivat(evs, { agenten: [agent.pk] }).map((f) => f.detail);
  assert.deepEqual(regel([signiert(agent, baueAgentKarte(agent.pk, KARTE, T))]), ["Karte eines Agenten im privaten Raum offen"]);
  assert.deepEqual(regel([signiert(besitzer, baueAgentenListe(besitzer.pk, [agent.pk], T))]), ["Agent eines privaten Raums in offener Liste"]);
  assert.deepEqual(regel([ev(fremd, 42, [["p", agent.pk, "", "mention"]], "@Lektor?")]), ["Nachricht von oder an einen Agenten eines privaten Raums offen (Kind 42)"]);
  assert.deepEqual(regel([ev(agent, 9, [], "Antwort")]), ["Nachricht von oder an einen Agenten eines privaten Raums offen (Kind 9)"]);
  assert.deepEqual(regel([ev(fremd, 1059, [["p", agent.pk]]), ev(fremd, 445, [["h", "ab".repeat(32)]]), ev(agent, 443, [])]), [], "verschlüsselt bzw. KeyPackage");
  assert.deepEqual(regel([ev(fremd, 38090, [["d", "karte"]]), ev(besitzer, 30000, [["d", "kontakte"], ["p", agent.pk]])]), [], "fremder Agent, andere Liste");
});
