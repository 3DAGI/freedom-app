/**
 * Schritt 5.4b: Outbox beim Lesen – was ein Kontakt schreibt, findet die App
 * auch an seinen Schreib-Relays, nicht nur im eigenen Pool. Fremde Relays
 * können nichts unterschieben; Listen werden gemerkt; ein toter Relay stört nicht.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRelayList, generateKeypair, signEvent, type NostrEvent, type RelayFilter } from "@freedomstack/protocol";
import { LISTEN_FRISCH_MS, OutboxLeser } from "../src/outbox-lesen.js";

const [kontakt, anderer, fremd] = Array.from({ length: 3 }, () => generateKeypair());
const T = 1_790_000_000;
const profil = (k: typeof kontakt, name: string, at = T) => signEvent({ pubkey: k.pk, created_at: at, kind: 0, tags: [], content: JSON.stringify({ name }) }, k.sk);
const liste = (k: typeof kontakt, urls: string[], at = T) => signEvent(buildRelayList(k.pk, urls.map((url) => ({ url })), at), k.sk);

/** Relays je Adresse; `frageAn` zählt, wen es fragt. */
function netz(inhalt: Record<string, NostrEvent[]>, poolUrls: string[]) {
  const gefragt: string[] = [];
  const tot = new Set<string>();
  const passt = (f: RelayFilter, ev: NostrEvent) => (!f.kinds || f.kinds.includes(ev.kind)) && (!f.authors || f.authors.includes(ev.pubkey));
  const pool = { urls: poolUrls, abfragen: 0, async query(f: RelayFilter) { pool.abfragen++; return poolUrls.flatMap((u) => (inhalt[u] ?? []).filter((ev) => passt(f, ev))); } };
  const frageAn = async (f: RelayFilter, urls: readonly string[]) => {
    gefragt.push(...urls);
    if (urls.some((u) => tot.has(u))) throw new Error("tot");
    // Ein böses Relay liefert, was es will – auch fremde Events
    return urls.flatMap((u) => (inhalt[u] ?? []).filter((ev) => u === "wss://boese.test" || passt(f, ev)));
  };
  return { pool, frageAn, gefragt, tot };
}

test("5.4b: Profil des Kontakts nur an seinem Schreib-Relay – gefunden; Pool-Relays nicht doppelt gefragt", async () => {
  const n = netz({
    "wss://pool.test": [liste(kontakt, ["wss://kontakt.test", "wss://pool.test"])],
    "wss://kontakt.test": [profil(kontakt, "Kira")],
  }, ["wss://pool.test"]);
  const leser = new OutboxLeser({ pool: async () => n.pool, frageAn: n.frageAn, jetzt: () => T * 1000 });
  const evs = await leser.frage({ kinds: [0], authors: [kontakt.pk] });
  assert.deepEqual(evs.map((e) => JSON.parse(e.content).name), ["Kira"]);
  assert.deepEqual(n.gefragt, ["wss://kontakt.test"], "wss://pool.test fragt schon der Pool");
});

test("5.4b: Fremde Relays schieben nichts unter – nur gültig signiert und von den gefragten Autoren", async () => {
  const gefaelscht = { ...profil(kontakt, "Kira"), content: JSON.stringify({ name: "Mallory" }) };
  const n = netz({
    "wss://pool.test": [liste(kontakt, ["wss://boese.test"])],
    "wss://boese.test": [profil(fremd, "Fremd"), gefaelscht, profil(kontakt, "Kira echt", T + 1)],
  }, ["wss://pool.test"]);
  const leser = new OutboxLeser({ pool: async () => n.pool, frageAn: n.frageAn });
  const evs = await leser.frage({ kinds: [0], authors: [kontakt.pk] });
  assert.deepEqual(evs.map((e) => JSON.parse(e.content).name), ["Kira echt"]);
});

test("5.4b: Listen bleiben zehn Minuten gemerkt; ohne Liste nur der Pool; ein toter Relay stört nicht", async () => {
  let jetzt = T * 1000;
  const n = netz({
    "wss://pool.test": [liste(kontakt, ["wss://kontakt.test"]), liste(anderer, ["wss://tot.test"]), profil(fremd, "im Pool")],
    "wss://kontakt.test": [profil(kontakt, "Kira")],
  }, ["wss://pool.test"]);
  n.tot.add("wss://tot.test");
  const leser = new OutboxLeser({ pool: async () => n.pool, frageAn: n.frageAn, jetzt: () => jetzt });
  const autoren = [kontakt.pk, anderer.pk, fremd.pk];
  const namen = async () => (await leser.frage({ kinds: [0], authors: autoren })).map((e) => JSON.parse(e.content).name).sort();
  assert.deepEqual(await namen(), ["Kira", "im Pool"]);
  assert.equal(n.pool.abfragen, 2, "Events und Listen");
  await namen();
  assert.equal(n.pool.abfragen, 3, "Listen gemerkt");
  jetzt += LISTEN_FRISCH_MS;
  await namen();
  assert.equal(n.pool.abfragen, 5, "nach zehn Minuten neu");
});

test("5.4b: verdrahtet – Schlüsselwechsel, Geräte-Vollmachten und Zap-Profil lesen bei den Autoren", () => {
  const kom = readFileSync(new URL("../src/shell/tabs/kommunikation.ts", import.meta.url), "utf8");
  const zap = readFileSync(new URL("../src/chat-zap.ts", import.meta.url), "utf8");
  assert.match(kom, /frageBeiAutoren\(\{ kinds: \[KIND_ROTATION_MANDATE\], authors: kontakte, limit: 200 \}\)/);
  assert.match(kom, /new GeraeteBuch\(async \(f\) =>\s*Array\.isArray\(f\.authors\) \? frageBeiAutoren\(/);
  assert.match(zap, /await frageBeiAutoren\(\{ kinds: \[0\], authors: \[state\.recipientPubkey\], limit: 1 \}\)/);
});
