/**
 * Schritt 5.1.3b: Relays bekommen ihren Anteil an ihre Betreiber – Schlüssel
 * aus der Selbstauskunft (NIP-11), Lightning-Adresse aus dessen Profil.
 * Gelernt im Hintergrund und gemerkt; Gefälschtes, Unerreichbares und .onion
 * bringen keine Adresse, und nichts hält einen Auftrag auf.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, type NostrEvent } from "@freedomstack/protocol";
import { FEHLER_MS, FRISCH_MS, LS_RELAY_ZAHLZIELE, RelayZahlziele, infoUrl } from "../src/relay-zahlziel.js";

const T = 1_790_000_000_000;
const [betreiberA, betreiberB, fremd] = Array.from({ length: 3 }, () => generateKeypair());
const profil = (k: typeof betreiberA, lud16: string, at = 1_790_000_000) =>
  signEvent({ pubkey: k.pk, created_at: at, kind: 0, tags: [], content: JSON.stringify({ lud16 }) }, k.sk);

function netz(infos: Record<string, unknown>, profile: NostrEvent[]) {
  const abgerufen: string[] = [];
  const holen = (async (url: string | URL | Request, o?: RequestInit) => {
    const u = String(url);
    abgerufen.push(u);
    assert.equal((o?.headers as Record<string, string>).Accept, "application/nostr+json");
    if (!(u in infos)) throw new Error("nicht erreichbar");
    return new Response(JSON.stringify(infos[u]), { status: 200 });
  }) as typeof fetch;
  const gefragt: string[][] = [];
  return { abgerufen, gefragt, holen, profile: async (autoren: string[]) => { gefragt.push(autoren); return profile; } };
}

function speicher() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

test("Adresse der Selbstauskunft: nur wss, nie .onion oder ws", () => {
  assert.equal(infoUrl("wss://relay.example/pfad"), "https://relay.example/pfad");
  assert.equal(infoUrl("ws://relay.example"), undefined);
  assert.equal(infoUrl("wss://abc.onion"), undefined);
  assert.equal(infoUrl("kaputt"), undefined);
});

test("Lernen: Betreiber aus NIP-11, Adresse aus seinem Profil – in der Reihenfolge des Pools; Fälschungen zählen nicht", async () => {
  // Neuer als das echte, aber nach dem Signieren verändert
  const gefaelscht = { ...profil(betreiberB, "echt@wallet.example", 1_790_000_100), content: JSON.stringify({ lud16: "boese@evil.example" }) };
  const n = netz({
    "https://a.example/": { pubkey: betreiberA.pk },
    "https://b.example/": { pubkey: betreiberB.pk },
    "https://c.example/": { name: "ohne Betreiber" },
    "https://l.example/": { pubkey: fremd.pk },
  }, [profil(betreiberA, "relay-a@wallet.example"), profil(betreiberB, "relay-b@wallet.example"), gefaelscht, profil(fremd, "x@localhost")]);
  const s = speicher();
  const z = new RelayZahlziele({ profile: n.profile, holen: n.holen, speicher: s, jetzt: () => T });
  const pool = ["wss://c.example", "wss://b.example", "wss://abc.onion", "wss://a.example", "wss://l.example"];
  assert.deepEqual(z.bekannte(pool), [], "vor dem Lernen nichts – der Auftrag wartet nicht");
  await z.lerne(pool);
  assert.deepEqual(z.bekannte(pool), [{ lud16: "relay-b@wallet.example" }, { lud16: "relay-a@wallet.example" }]);
  assert.ok(!n.abgerufen.some((u) => u.includes("onion")), ".onion wird nicht per HTTPS gefragt");
  assert.equal(n.gefragt.length, 1, "alle Profile auf einmal");
  assert.ok(s.getItem(LS_RELAY_ZAHLZIELE)!.includes("relay-a@wallet.example"), "gemerkt");
  // Ein neues Objekt mit demselben Speicher kennt sie sofort
  assert.equal(new RelayZahlziele({ profile: n.profile, speicher: s }).bekannte(pool).length, 2);
});

test("Gemerkt: einen Tag, nach einem Fehlschlag eine Stunde; zwei Läufe zugleich fragen einmal", async () => {
  let jetzt = T;
  const n = netz({ "https://a.example/": { pubkey: betreiberA.pk } }, [profil(betreiberA, "relay-a@wallet.example")]);
  const z = new RelayZahlziele({ profile: n.profile, holen: n.holen, speicher: speicher(), jetzt: () => jetzt });
  const pool = ["wss://a.example", "wss://tot.example"];
  await Promise.all([z.lerne(pool), z.lerne(pool)]);
  assert.equal(n.abgerufen.length, 2);
  jetzt += FEHLER_MS;
  await z.lerne(pool);
  assert.deepEqual(n.abgerufen.slice(2), ["https://tot.example/"], "nur der unerreichbare nach einer Stunde");
  jetzt = T + FRISCH_MS;
  await z.lerne(pool);
  assert.ok(n.abgerufen.slice(3).includes("https://a.example/"), "nach einem Tag neu");
  // Profile nicht erreichbar: keine Adresse, aber bald wieder versuchen
  const aus = new RelayZahlziele({ profile: async () => { throw new Error("offline"); }, holen: n.holen, speicher: speicher(), jetzt: () => T });
  await aus.lerne(["wss://a.example"]);
  assert.deepEqual(aus.bekannte(["wss://a.example"]), []);
});
