/**
 * 11.3d2a (Entwurf AGENTEN-RAUM-ENTWURF.md P2, P4; MENSCH 10.10.): Agent auf dem Knoten tritt privaten Räumen bei.
 *
 * Beweist – mit der echten MDK-Engine und einem Gründer wie in der App:
 *  - Listen (10002, 10050) und KeyPackage vom Agenten; die Einladung kommt über den Posteingang
 *  - beitreten nur nach dem Schalter (`besitzer` nur vom Besitzer) und unter der Grenze
 *  - nach dem Beitritt die Karte als inneres Event – beim Gründer vom Agenten, Knoten, „wer fragt, zahlt“
 *  - Raumstand verschlüsselt auf der Platte (0600, ohne Klartext), Chat nur im Speicher des Knotens
 *    (die Engine behält ihn wie bei jedem Mitglied im verschlüsselten Zustand); nach einem Neustart
 *    Stand und Gruppe da, neue Nachrichten kommen an
 *  - fremde Relays der Gruppe nur wss://, plausibel und geprüft
 *  - Schalter AGENT_PRIVAT, Verdrahtung, kein Klartext im Log
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIND_AGENT_KARTE, KIND_DM_RELAYS, KIND_RELAY_LIST, LocalSigner, MemoryRelay, OutboxPool, generateKeypair, raumAgentKarten, raumDefinition,
  raumNachricht, signiereId, type InneresEvent, type NostrEvent, type Relay,
} from "@freedomstack/protocol";
import { KIND_KEY_PACKAGE, Mls, type MlsSenden } from "@freedomstack/mls";
import { agentAusUmgebung } from "../src/knoten-agent.js";
import { KnotenMls, ladeMlsImKnoten } from "../src/knoten-mls.js";

ladeMlsImKnoten();
const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const KNOTEN = generateKeypair().pk;
const KARTE = { name: "Lektor", betrieb: "knoten" as const, bezahlung: "fragender" as const, provider: KNOTEN };

function person() {
  const kp = generateKeypair();
  const signer = new LocalSigner(kp.sk);
  return { pk: kp.pk, signer, mls: new Mls(signer, (id) => signiereId(id, kp.sk)) };
}

function welt(o: { einladen?: "besitzer" | "alle"; besitzer?: string; ordner?: string; maxGruppen?: number; relay?: MemoryRelay } = {}) {
  const relay = o.relay ?? new MemoryRelay(`wss://mls-${Math.random().toString(36).slice(2)}.test`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const agent = generateKeypair();
  const ordner = o.ordner ?? mkdtempSync(join(tmpdir(), "knoten-mls-"));
  const neu: string[] = [];
  const umgebung = {
    pool,
    neuesRelay: (url: string): Relay => { neu.push(url); return new MemoryRelay(url); },
    pruefeRelay: async (url: string) => !url.includes("abgelehnt"),
  };
  const starte = (sk = agent.sk) => KnotenMls.starte({
    schluessel: { sk, pk: agent.pk }, einladen: o.einladen ?? "alle", ...(o.besitzer ? { besitzer: o.besitzer } : {}),
    karte: KARTE, ordner, umgebung, ...(o.maxGruppen ? { maxGruppen: o.maxGruppen } : {}),
  });
  return { relay, pool, agent, ordner, neu, starte };
}

/** Gründer wie die App: KeyPackage des Agenten vom Relay, Gruppe gründen, Einladung an den Posteingang. */
async function gruende(w: ReturnType<typeof welt>, gruender = person(), relays = [w.relay.url]) {
  const kp = (await w.pool.query({ kinds: [KIND_KEY_PACKAGE], authors: [w.agent.pk] }))[0];
  assert.ok(kp, "KeyPackage des Agenten");
  const g = await gruender.mls.gruppeAnlegen("Werkstatt", [kp], relays);
  for (const e of g.einladungen) await w.pool.publish(e);
  return { gruender, gruppe: g.gruppe };
}

async function sende(pool: OutboxPool, s: MlsSenden, mls: Mls): Promise<void> {
  for (const ev of s.events) await pool.publish(ev);
  if (s.ausstehend) await mls.bestaetigt(s.ausstehend);
}

/** Was beim Gründer ankommt (alle Gruppennachrichten vom Relay). */
async function liest(pool: OutboxPool, mls: Mls): Promise<InneresEvent[]> {
  const evs = (await pool.query({ kinds: [445] })).sort((a, b) => a.created_at - b.created_at);
  const l: InneresEvent[] = [];
  for (const ev of evs) {
    const r = await mls.empfangen(ev).catch(() => null);
    for (const n of r?.nachrichten ?? []) l.push({ id: n.inneres, von: n.von, art: n.art, tags: n.tags, text: n.text, zeit: n.zeit });
  }
  return l;
}

test("11.3d2a: Listen und KeyPackage, Einladung annehmen, Karte als inneres Event", async () => {
  const w = welt();
  const k = w.starte();
  assert.deepEqual(await k.veroeffentliche(), { posteingang: 1 });
  const eigene = await w.pool.query({ authors: [w.agent.pk] });
  assert.deepEqual(eigene.map((e) => e.kind).sort(), [KIND_RELAY_LIST, KIND_DM_RELAYS, KIND_KEY_PACKAGE].sort());

  const { gruender, gruppe } = await gruende(w);
  const def = raumDefinition(gruppe, { name: "Werkstatt", kanaele: [{ id: "allgemein", name: "allgemein", privacy: "verschluesselt", writeRoles: [], position: 0 }] });
  const r = await k.abgleich();
  assert.deepEqual(r.einladungen, [{ gruppe }]);
  assert.deepEqual(k.gruppen(), [gruppe]);
  // Das alte ist verbraucht: ein neues im selben Platz (d-Tag) – Relays ersetzen es, die Attrappe behält beide
  const kps = await w.pool.query({ kinds: [KIND_KEY_PACKAGE], authors: [w.agent.pk] });
  assert.equal(kps.length, 2);
  assert.equal(new Set(kps.map((e) => e.tags.find((t) => t[0] === "d")?.[1])).size, 1, "derselbe Platz");

  // Beim Gründer: die Karte vom Agenten – Knoten, „wer fragt, zahlt“, der Knoten rechnet
  const beimGruender = await liest(w.pool, gruender.mls);
  const karten = raumAgentKarten(beimGruender);
  assert.deepEqual(karten.map((x) => [x.agent, x.name, x.betrieb, x.bezahlung, x.provider]), [[w.agent.pk, "Lektor", "knoten", "fragender", KNOTEN]]);

  // Raumstand und Chat vom Gründer kommen an; die Karte kennt der Agent selbst
  await sende(w.pool, await gruender.mls.sendenEvent(gruppe, def.art, def.tags, def.text), gruender.mls);
  const frage = raumNachricht({ kanal: "allgemein", text: "Bitte lies den Absatz über Kommas.", erwaehnt: [w.agent.pk] });
  await sende(w.pool, await gruender.mls.sendenEvent(gruppe, frage.art, frage.tags, frage.text), gruender.mls);
  const r2 = await k.abgleich();
  assert.deepEqual(r2.neu.get(gruppe)?.map((e) => e.art).sort(), [9, def.art].sort(), "dieselbe Sekunde – Reihenfolge offen");
  assert.deepEqual(k.ereignisse(gruppe).map((e) => e.art).sort(), [9, KIND_AGENT_KARTE, def.art].sort());
  assert.equal(k.ereignisse(gruppe).find((e) => e.art === 9)?.von, gruender.pk, "Absender von MLS belegt");
  k.stoppe();
});

test("11.3d2a: Stand verschlüsselt (0600), Chat legt der Knoten nicht ab; nach dem Neustart Gruppe und Stand da", async () => {
  const w = welt();
  const k = w.starte();
  await k.veroeffentliche();
  const { gruender, gruppe } = await gruende(w);
  await k.abgleich();
  const def = raumDefinition(gruppe, { name: "Geheimwerkstatt Nordflügel", kanaele: [{ id: "allgemein", name: "allgemein", privacy: "verschluesselt", writeRoles: [], position: 0 }] });
  await sende(w.pool, await gruender.mls.sendenEvent(gruppe, def.art, def.tags, def.text), gruender.mls);
  const text = "Vertraulich: der Umbau beginnt am Montag um acht.";
  const m = raumNachricht({ kanal: "allgemein", text });
  await sende(w.pool, await gruender.mls.sendenEvent(gruppe, m.art, m.tags, m.text), gruender.mls);
  await k.abgleich();
  k.stoppe();

  for (const name of ["json", "zustand", "raumstand"]) {
    const datei = join(w.ordner, `agent-mls.${name}`);
    assert.equal(statSync(datei).mode & 0o777, 0o600, name);
    const inhalt = readFileSync(datei, "utf8");
    assert.ok(!inhalt.includes("Geheimwerkstatt Nordflügel") && !inhalt.includes(text), `${name}: kein Klartext`);
  }

  // Neustart aus denselben Dateien: Gruppe und Raumstand da, der Chat nicht – den legt der Knoten nicht ab
  const k2 = w.starte();
  assert.deepEqual(k2.gruppen(), [gruppe]);
  assert.deepEqual(k2.ereignisse(gruppe).map((e) => e.art).sort(), [KIND_AGENT_KARTE, def.art].sort());
  // … und liest weiter, was neu kommt. Was die Engine schon verarbeitet hatte, stellt sie aus ihrem
  // (verschlüsselten) Zustand erneut zu – wie bei jedem Mitglied
  const n = raumNachricht({ kanal: "allgemein", text: "Und danach?" });
  await sende(w.pool, await gruender.mls.sendenEvent(gruppe, n.art, n.tags, n.text), gruender.mls);
  const r = await k2.abgleich();
  assert.ok(r.neu.get(gruppe)?.some((e) => e.art === 9 && e.text === "Und danach?"));
  k2.stoppe();

  // Zustand und Stand sind an den Agenten gebunden: ein anderer öffnet sie nicht – eine beschädigte
  // Schlüsseldatei heißt kein Start, nie ein neuer Schlüssel (sonst wären die Gruppen verloren)
  const umgebung = { pool: w.pool, neuesRelay: (u: string): Relay => new MemoryRelay(u), pruefeRelay: async () => false };
  assert.throws(() => KnotenMls.starte({ schluessel: generateKeypair(), einladen: "alle", karte: KARTE, ordner: w.ordner, umgebung }));
  writeFileSync(join(w.ordner, "agent-mls.json"), "{kaputt", { mode: 0o600 });
  assert.throws(() => w.starte());
  assert.equal(readFileSync(join(w.ordner, "agent-mls.json"), "utf8"), "{kaputt", "nie ersetzt");
});

test("11.3d2a: Schalter besitzer – Fremde nicht; Grenze der Gruppen", async () => {
  const besitzer = person();
  const w = welt({ einladen: "besitzer", besitzer: besitzer.pk });
  const k = w.starte();
  await k.veroeffentliche();
  await gruende(w);
  assert.deepEqual((await k.abgleich()).einladungen, [{ fall: "einladung-fremd" }]);
  assert.deepEqual(k.gruppen(), []);
  const { gruppe } = await gruende(w, besitzer);
  assert.deepEqual((await k.abgleich()).einladungen, [{ gruppe }], "vom Besitzer ja");
  k.stoppe();

  const v = welt({ maxGruppen: 1 });
  const k2 = v.starte();
  await k2.veroeffentliche();
  await gruende(v);
  await k2.abgleich();
  await gruende(v);
  assert.deepEqual((await k2.abgleich()).einladungen, [{ fall: "gruppen-voll" }]);
  assert.equal(k2.gruppen().length, 1);
  k2.stoppe();
});

test("11.3d2a: fremde Relays der Gruppe nur wss://, plausibel und geprüft", async () => {
  const w = welt();
  const k = w.starte();
  await k.veroeffentliche();
  await gruende(w, person(), [
    w.relay.url, "wss://relay.fremd.example.org", "wss://127.0.0.1", "ws://klar.example.org", "wss://abgelehnt.example.org",
  ]);
  const r = await k.abgleich();
  assert.equal(r.einladungen.length, 1);
  assert.ok("gruppe" in r.einladungen[0]!);
  assert.deepEqual(w.neu, ["wss://relay.fremd.example.org"], "nur das geprüfte öffentliche wss-Relay");
  k.stoppe();
});

test("11.3d2a: Einladungen auch aus dem Posteingang im eigenen Relay (als der Agent angemeldet)", async () => {
  const w = welt();
  const k = w.starte();
  await k.veroeffentliche();
  // Der Umschlag liegt nur im eigenen Relay – dort bekommt ihn nur, wer als der Agent angemeldet ist
  const eigenes = new MemoryRelay(w.relay.url);
  const kp = (await w.pool.query({ kinds: [KIND_KEY_PACKAGE], authors: [w.agent.pk] }))[0]!;
  const g = await person().mls.gruppeAnlegen("Werkstatt", [kp], [w.relay.url]);
  for (const e of g.einladungen) await eigenes.publish(e);
  assert.deepEqual((await k.abgleich()).einladungen, [], "ohne Posteingang nichts");
  k.nutzePosteingang(eigenes);
  assert.deepEqual((await k.abgleich()).einladungen, [{ gruppe: g.gruppe }]);
  k.stoppe();
});

test("11.3d2a: AGENT_PRIVAT – besitzer|alle, besitzer braucht AGENT_BESITZER", () => {
  const basis = { KNOTEN_AGENT: "1", AGENT_NAME: "Lektor" };
  const b = "ab".repeat(32);
  assert.equal(agentAusUmgebung(basis)?.einstellung?.privat, undefined, "ohne Schalter keine privaten Räume");
  assert.equal(agentAusUmgebung({ ...basis, AGENT_PRIVAT: "alle" })?.einstellung?.privat, "alle");
  assert.equal(agentAusUmgebung({ ...basis, AGENT_PRIVAT: "besitzer", AGENT_BESITZER: b })?.einstellung?.privat, "besitzer");
  assert.match(agentAusUmgebung({ ...basis, AGENT_PRIVAT: "besitzer" })?.grund ?? "", /braucht AGENT_BESITZER/);
  assert.match(agentAusUmgebung({ ...basis, AGENT_PRIVAT: "ja" })?.grund ?? "", /weder besitzer noch alle/);
});

test("11.3d2a: verdrahtet – nur mit AGENT_PRIVAT, Relays über die eine Fabrik, ins Log nur Kennungen", () => {
  const main = quelle("../src/main.ts");
  assert.match(main, /const einladen = agentWahl\.einstellung\.privat;\n\s+if \(einladen\) \{/);
  assert.match(main, /karte: knotenAgent\.kartenDaten\(\), ordner: dirname\(agentSchluesselDatei\(\)\),/, "neben dem Schlüssel des Agenten");
  assert.match(main, /umgebung: \{ pool, neuesRelay: relayAn, pruefeRelay: async \(url\) => !!torProxy \|\| \(await checkUrlSafe\(url\.replace\(\/\^wss:\/, "https:"\)\)\)\.allowed \}/);
  assert.match(main, /const r = await mls\.abgleich\(\);/);
  assert.match(main, /if \(listen\?\.posteingang === 0\) console\.warn\(/, "leerer Posteingang wird gesagt");
  assert.match(main, /pool\.addRelay\(intern\);\n[^\n]*\n\s+if \(knotenMls\) knotenMls\.nutzePosteingang\(relayRole\.alsRelay\(knotenMls\.pk\)\);/, "Umschläge an den Agenten im eigenen Relay");
  assert.match(main, /"fall" in a \? `\[agent\] Einladung abgelehnt: \$\{a\.fall\}` : `\[agent\] privatem Raum beigetreten \(\$\{mls\.gruppen\(\)\.length\} Gruppen\)`/);
  const modul = quelle("../src/knoten-mls.ts");
  assert.doesNotMatch(modul, /console\./, "das Modul schreibt nichts ins Log");
  assert.doesNotMatch(modul, /new WebSocketRelay/, "Verbindungen nur über die Fabrik aus main.ts");
  assert.doesNotMatch(modul, /speichere\("raumstand"[^)]*this\.chat/, "Chat nie in die Datei");
  const docker = quelle("../../../docker/node.Dockerfile");
  assert.match(docker, /COPY packages\/mls\/dist packages\/mls\/dist/, "Engine im Image");
});
