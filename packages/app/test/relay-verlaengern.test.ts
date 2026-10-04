/**
 * E11 B (04.10.2026): Relay-Zugang verlängern – Erinnerung kurz vor dem Ablauf,
 * einmal am Tag, verlängert nur auf Klick mit Rückfrage, mit derselben Schiene
 * wie zuletzt. Nie Geld ohne Klick.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ERINNERUNG, LS_RELAY_ERINNERT, LS_RELAY_ZUGANG, faelligeVerlaengerungen, merkeZugang, schieneZumVerlaengern, zuErinnern, zugaenge,
} from "../src/relay-kauf.js";

const JETZT = 1_800_000_000;
const TAG = 86_400;
const speicher = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test("Fällig: drei Tage vorher bis eine Woche danach, der baldigste zuerst", () => {
  const alle = {
    "wss://bald.example": { bis: JETZT + 2 * TAG, schiene: "solana" as const },
    "wss://lang.example": { bis: JETZT + 30 * TAG },
    "wss://grenze.example": { bis: JETZT + ERINNERUNG.vorherSek },
    "wss://vorbei.example": { bis: JETZT - 2 * TAG, schiene: "lightning" as const },
    "wss://alt.example": { bis: JETZT - 8 * TAG },
    "wss://offen.example": { offen: { id: "c".repeat(32), kaufUrl: "https://offen.example/kauf" } },
  };
  assert.deepEqual(faelligeVerlaengerungen(alle, JETZT), [
    { relay: "wss://vorbei.example", bis: JETZT - 2 * TAG, schiene: "lightning" },
    { relay: "wss://bald.example", bis: JETZT + 2 * TAG, schiene: "solana" },
    { relay: "wss://grenze.example", bis: JETZT + ERINNERUNG.vorherSek },
  ]);
  assert.deepEqual(faelligeVerlaengerungen({ "wss://x.example": { bis: "morgen" } as never }, JETZT), [], "Unsinn ist nicht fällig");
});

test("Erinnern: einmal am Tag, am nächsten Tag wieder, nach dem Verlängern nicht mehr", () => {
  const s = speicher();
  merkeZugang(s, "wss://bald.example", { bis: JETZT + TAG, schiene: "lightning" });
  assert.deepEqual(zuErinnern(s, JETZT).map((f) => f.relay), ["wss://bald.example"]);
  assert.deepEqual(zuErinnern(s, JETZT + 60), [], "heute schon erinnert");
  assert.deepEqual(zuErinnern(s, JETZT + TAG).map((f) => f.relay), ["wss://bald.example"], "am nächsten Tag wieder");
  merkeZugang(s, "wss://bald.example", { bis: JETZT + 31 * TAG, schiene: "lightning" });
  assert.deepEqual(zuErinnern(s, JETZT + 2 * TAG), [], "verlängert");
  s.setItem(LS_RELAY_ERINNERT, "{kaputt");
  merkeZugang(s, "wss://zwei.example", { bis: JETZT + TAG });
  assert.deepEqual(zuErinnern(s, JETZT).map((f) => f.relay), ["wss://zwei.example"], "kaputte Ablage – neu beginnen");
});

test("Schiene: die zuletzt genutzte, wenn der Relay sie noch anbietet; sonst die angebotene; ohne Angebot keine", () => {
  assert.equal(schieneZumVerlaengern({ schiene: "solana" }, { msat: 1000, lamports: 5 }), "solana");
  assert.equal(schieneZumVerlaengern({ schiene: "solana" }, { msat: 1000 }), "lightning");
  assert.equal(schieneZumVerlaengern({}, { lamports: 5 }), "solana");
  assert.equal(schieneZumVerlaengern({}, { msat: 1000, lamports: 5 }), "lightning");
  assert.equal(schieneZumVerlaengern({ schiene: "lightning" }, {}), null);
});

test("Gemerkt wird die Schiene – auch, wenn erst „erneut prüfen“ bestätigt (SOL hat eine Signatur, Lightning nicht)", () => {
  const s = speicher();
  merkeZugang(s, "wss://sol.example", { offen: { id: "a".repeat(32), kaufUrl: "https://sol.example/k", signatur: "5".repeat(88) } });
  merkeZugang(s, "wss://sol.example", { bis: JETZT });
  merkeZugang(s, "wss://ln.example", { offen: { id: "b".repeat(32), kaufUrl: "https://ln.example/k" } });
  merkeZugang(s, "wss://ln.example", { bis: JETZT });
  merkeZugang(s, "wss://direkt.example", { bis: JETZT, schiene: "solana" });
  merkeZugang(s, "wss://direkt.example", { bis: JETZT + TAG });
  assert.deepEqual(zugaenge(s), {
    "wss://sol.example": { bis: JETZT, schiene: "solana" },
    "wss://ln.example": { bis: JETZT, schiene: "lightning" },
    "wss://direkt.example": { bis: JETZT + TAG, schiene: "solana" },
  });
  assert.ok(s.m.has(LS_RELAY_ZUGANG));
});

test("Verdrahtet: Erinnerung beim Start nur aus dem Gemerkten, „Verlängern“ kauft über denselben Weg mit Rückfrage", () => {
  const settings = readFileSync(new URL("../src/shell/tabs/settings.ts", import.meta.url), "utf8");
  const zugang = settings.slice(settings.indexOf("export function wireRelayZugang("), settings.indexOf("export function wireRelayKarte("));
  assert.match(zugang, /const erinnern = zuErinnern\(localStorage, Math\.floor\(Date\.now\(\) \/ 1000\)\);/);
  const verl = zugang.slice(zugang.indexOf("verlK.onclick"), zugang.indexOf("pruefK.onclick"));
  assert.match(verl, /await kaufe\(schiene\);/, "derselbe Kauf – mit bestaetige() vorher");
  assert.match(zugang.slice(zugang.indexOf("const kaufe = async"), zugang.indexOf("satsK.onclick")), /if \(!\(await bestaetige\(/);
  const erinnerung = zugang.slice(zugang.indexOf("const erinnern ="));
  assert.doesNotMatch(erinnerung, /kaufe\(|leseRelayPreise|fetch/, "beim Start kein Netz und kein Geld");
  assert.match(readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8"), /id="relay-zugang-verlaengern" class="hidden"/);
});
