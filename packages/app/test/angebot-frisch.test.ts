/**
 * L2-1 (Lauf 2 des lokalen Agenten, Sammlung Anhang F): Ein toter Provider wurde gewählt –
 * für einen neuen Nutzer sahen ein lebender und ein toter gleich aus („neu“), dann entschied
 * der Zufall mit 1/Preis². Seit L2-1 steht ein Angebot, das zwei Erneuerungen verpasst hat,
 * hinter allen frischen; je Provider zählt nur das neueste Angebot.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ANGEBOT_TAKT_SEK, buildCapabilities, generateKeypair, parseCapabilities, signEvent, type NostrEvent } from "@freedomstack/protocol";
import { type ScoredProvider, discoverProviders, matchProviders } from "../src/matchmaking.js";

const JETZT = 1_790_000_000;
const lies = (datei: string) => readFileSync(new URL(`../src/${datei}`, import.meta.url), "utf8");

function angebot(k: ReturnType<typeof generateKeypair>, preis: number, zeit: number): NostrEvent {
  return signEvent(buildCapabilities({ pubkey: k.pk, tier: "classic", models: ["m"], textRatePerKTokenMsat: preis, tools: [], currentlyFree: false }, zeit), k.sk);
}
function provider(preis: number, zeit: number): ScoredProvider {
  const k = generateKeypair();
  return { caps: parseCapabilities(angebot(k, preis, zeit)), trustScore: 0, jobsCompleted: 0, repTier: "classic", score: -1, geprueft: false, reklamationen: 0 };
}

test("L2-1: frische Neue vor veralteten – auch wenn der veraltete viel billiger ist", () => {
  const lebt = provider(4000, JETZT - 10 * 60);
  const verpasstEine = provider(4000, JETZT - ANGEBOT_TAKT_SEK - 20 * 60);
  const tot = provider(10, JETZT - 3 * ANGEBOT_TAKT_SEK);
  for (const z of [0, 0.5, 0.999]) {
    const r = matchProviders([tot, lebt, verpasstEine], "classic", { zufall: () => z, jetzt: JETZT }).map((p) => p.caps.pubkey);
    assert.equal(r[2], tot.caps.pubkey, `Zufall ${z}: der Tote steht hinten`);
    assert.deepEqual(new Set(r.slice(0, 2)), new Set([lebt.caps.pubkey, verpasstEine.caps.pubkey]), "eine verpasste Erneuerung ist noch frisch");
  }
  // Ohne Zeit aus dem Test rechnet die Auswahl mit der Uhr – dieselben Angebote sind dann alle veraltet
  assert.equal(matchProviders([tot, lebt], "classic", { zufall: () => 0 }).length, 2, "veraltet heißt hinten, nicht weg");
});

test("L2-1: eigene Provider – unter sich frische vor veralteten", () => {
  const eigenTot = provider(10, JETZT - 3 * ANGEBOT_TAKT_SEK);
  const eigenLebt = provider(9000, JETZT - 60);
  const fremd = provider(10, JETZT - 60);
  const r = matchProviders([eigenTot, fremd, eigenLebt], "classic", {
    allowlist: [eigenTot.caps.pubkey, eigenLebt.caps.pubkey], zufall: () => 0.5, jetzt: JETZT,
  }).map((p) => p.caps.pubkey);
  assert.deepEqual(r, [eigenLebt.caps.pubkey, eigenTot.caps.pubkey, fremd.caps.pubkey], "eigene bleiben vorn");
});

test("L2-1: je Provider nur das neueste Angebot – eine alte Fassung auf einem Relay zählt nicht", async () => {
  const k = generateKeypair();
  const jetzt = Math.floor(Date.now() / 1000);
  const alt = angebot(k, 5000, jetzt - 5 * ANGEBOT_TAKT_SEK);
  const neu = angebot(k, 3000, jetzt - 60);
  const anderer = angebot(generateKeypair(), 4000, jetzt - 60);
  for (const reihe of [[alt, neu, anderer], [neu, anderer, alt]]) {
    const pool = { query: async () => reihe } as unknown as Parameters<typeof discoverProviders>[0];
    const gefunden = await discoverProviders(pool);
    assert.equal(gefunden.length, 2, "nicht doppelt");
    const p = gefunden.find((x) => x.caps.pubkey === k.pk)!;
    assert.equal(p.caps.updatedAt, jetzt - 60, "das neueste gilt, gleich in welcher Reihenfolge");
    assert.equal(p.caps.textRatePerKTokenMsat, 3000);
  }
});

test("L2-1: verdrahtet – der Knoten erneuert im selben Takt, die Auswahl rechnet je Aufruf mit der Uhr", () => {
  assert.match(lies("matchmaking.ts"), /const veraltet = \(p: ScoredProvider\) => angebotVeraltet\(p\.caps\.updatedAt, jetzt\);/);
  assert.match(lies("matchmaking.ts"), /veraltet: veraltet\(p\),/);
  assert.match(lies("shell/state.ts"), /return matchProviders\(await providerMitStand\(\), tier as/, "der echte Pfad ohne feste Zeit");
  const knoten = readFileSync(new URL("../../node/src/main.ts", import.meta.url), "utf8");
  assert.match(knoten, /const CAPS_REFRESH_MS = ANGEBOT_TAKT_SEK \* 1000;/);
});
