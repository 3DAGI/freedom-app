/**
 * Schritt 12.4b (Sammlung A-1): Schalter „sats / SOL“ auf der Agent-Seite.
 * Ohne Wahl gilt die Standard-Schiene (12.4a). Das Gebot steht in der gewählten
 * Einheit, umgerechnet nur über `kurs.ts` – ohne Kurs kein Gebot in SOL, und nie
 * mehr als eingetippt. Mit SOL ohne Kanal: „Kanal anbieten“, nie still Lightning.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { msatZuLamports } from "@freedomstack/protocol";

const speicher = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => speicher.get(k) ?? null,
  setItem: (k: string, v: string) => { speicher.set(k, v); },
  removeItem: (k: string) => { speicher.delete(k); },
};
const { LS_KI_SCHIENE, gebotAlsText, gebotInSats, kiSchiene, waehleKiSchiene } = await import("../src/ki-schiene.js");
const { LS_STANDARD_SCHIENE } = await import("../src/standard-schiene.js");
const { solZuLamports } = await import("../src/zahlungs-anforderung.js");

const lies = (pfad: string) => readFileSync(new URL(`../src/${pfad}`, import.meta.url), "utf8");
const KURS = 150_000; // sats je SOL

test("Schiene für KI: ohne Wahl die Standard-Schiene, sonst die Wahl; Unfug zählt nicht", () => {
  speicher.clear();
  assert.equal(kiSchiene(), "lightning");
  speicher.set(LS_STANDARD_SCHIENE, "solana");
  assert.equal(kiSchiene(), "solana", "ohne Wahl wie seit 12.4a");
  waehleKiSchiene("lightning");
  assert.equal(speicher.get(LS_KI_SCHIENE), "lightning");
  assert.equal(kiSchiene(), "lightning", "die Wahl schlägt die Standard-Schiene");
  speicher.set(LS_STANDARD_SCHIENE, "lightning");
  waehleKiSchiene("solana");
  assert.equal(kiSchiene(), "solana");
  speicher.set(LS_KI_SCHIENE, "dogecoin");
  assert.equal(kiSchiene(), "lightning", "unbekannte Wahl → Standard-Schiene");
});

test("Schiene für KI: ohne localStorage die Standard-Schiene (die wirft dann nicht)", () => {
  const vorher = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => { if (k === LS_KI_SCHIENE) throw new Error("gesperrt"); return null; },
  };
  try {
    assert.equal(kiSchiene(), "lightning");
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = vorher;
  }
});

test("Gebot in sats: ganze Zahl ab 1, sonst keins", () => {
  assert.equal(gebotInSats("100", "lightning", undefined), 100, "sats brauchen keinen Kurs");
  assert.equal(gebotInSats(" 21 ", "lightning", KURS), 21);
  for (const unfug of ["", " ", "0", "-3", "1.5", "1e3x", "abc", "NaN", "9007199254740993"]) {
    assert.equal(gebotInSats(unfug, "lightning", KURS), undefined, unfug);
  }
});

test("Gebot in SOL: nur mit Kurs, abgerundet, nie mehr als eingetippt", () => {
  assert.equal(gebotInSats("0.001", "solana", undefined), undefined, "ohne Kurs kein Gebot – nie einen Kurs erfinden");
  assert.equal(gebotInSats("0.001", "solana", 0), undefined);
  assert.equal(gebotInSats("0.001", "solana", KURS), 150, "0,001 SOL = 150 sats");
  assert.equal(gebotInSats("0.000000001", "solana", KURS), undefined, "ein Lamport ist kein ganzer sat – 0 hieße gratis");
  assert.equal(gebotInSats("0.000006666", "solana", KURS), undefined, "0,9999 sats – abgerundet keiner");
  assert.equal(gebotInSats("0.000006667", "solana", KURS), 1);
  for (const unfug of ["", "abc", "-0.1", "0", "0.0000000001", "1,5"]) {
    assert.equal(gebotInSats(unfug, "solana", KURS), undefined, unfug);
  }
  // Nie mehr als eingetippt: der ganze sat kostet höchstens die eingetippten Lamports
  for (const text of ["0.000006667", "0.00002", "0.00001", "0.012345678", "1", "0.000666667", "0.000666666"]) {
    const sats = gebotInSats(text, "solana", KURS);
    assert.ok(sats !== undefined && sats > 0, text);
    assert.ok(msatZuLamports(sats * 1000, KURS) <= solZuLamports(text)!, `${text} → ${sats} sats kostet nicht mehr`);
    assert.ok(msatZuLamports((sats + 1) * 1000, KURS) > solZuLamports(text)!, `${text}: abgerundet, nicht zu weit`);
  }
});

test("Feld in der gewählten Einheit: sats wie sie sind, SOL nur mit Kurs, hin und zurück gleich", () => {
  assert.equal(gebotAlsText(100, "lightning", undefined), "100");
  assert.equal(gebotAlsText(100, "solana", undefined), "", "ohne Kurs bleibt das Feld leer");
  assert.equal(gebotAlsText(0, "solana", KURS), "");
  const text = gebotAlsText(100, "solana", KURS);
  assert.equal(text, "0.000666667", "aufgerundet auf ganze Lamports");
  assert.equal(gebotInSats(text, "solana", KURS), 100, "zurück ergibt dasselbe Gebot");
  for (const sats of [1, 7, 100, 12_345, 5_000_000]) {
    assert.equal(gebotInSats(gebotAlsText(sats, "solana", KURS), "solana", KURS), sats, `${sats} sats`);
  }
});

test("Verdrahtet: Zahlweg nach der Schiene für KI, Kanal nötig mit Provider, Kanal anbieten in der Fehlerblase", () => {
  const zahlung = lies("shell/ki-zahlung.ts");
  assert.match(zahlung, /if \(kiZahlweg\(kiSchiene\(\), kanalDa\(providerPk\)\) === "kanal-noetig"\) throw new KanalNoetig\(providerPk\);/);
  assert.match(zahlung, /const ziele = kiZiele\(liste, kiSchiene\(\), kanalDa\);\s*if \(liste\.length > 0 && ziele\.length === 0\) throw new KanalNoetig\(liste\[0\]\);/);
  assert.doesNotMatch(zahlung, /standardSchiene/, "KI liest die Schiene nur über kiSchiene()");
  // Fragen an Agenten auf einem Knoten (wer fragt, zahlt – 11.3d1b2) zahlt auch nach dem Schalter
  const knoten = lies("shell/knoten-agent-fragen.ts");
  assert.match(knoten, /const weg = kiZahlweg\(kiSchiene\(\), kanalDa\(k\.provider\)\);/);
  assert.doesNotMatch(knoten, /standardSchiene/);

  const anzeige = lies("shell/tabs/agent-anzeige.ts");
  const fehler = anzeige.slice(anzeige.indexOf("export function showAiError("));
  assert.match(fehler, /if \(e instanceof KanalNoetig\) \{\s*const kanal = el\("button", t\("agent\.kanalAnbieten"\), "btn-retry kanal-anbieten"\);\s*kanal\.onclick = \(\) => kanalAnbieten\(e\.provider, \(\) => switchTab\("wallet"\)\);/);
  assert.match(fehler, /if \(retryBid > 0\) setzeGebot\(retryBid\);/, "erneut: das Gebot in der Einheit des Felds");
  assert.doesNotMatch(anzeige, /Number\(\(\$\("#ai-bid"\)/, "das Feld nie mehr als sats lesen");

  const gebot = lies("shell/tabs/agent-gebot.ts");
  const anbieten = gebot.slice(gebot.indexOf("export function kanalAnbieten("));
  assert.match(anbieten, /\[data-subtab="lp"\]/);
  assert.match(anbieten, /if \(pk\) pk\.value = provider;/);
  assert.match(gebot, /if \(kiSchiene\(\) === "solana"\) \{\s*feld\(\)\.value = "";/, "die Vorgabe in sats steht nie als SOL im Feld");
});

test("Verdrahtet: askAi sendet Bezahltes nur mit gültigem Gebot – vor Rückfrage, Funk und Netz", () => {
  const agent = lies("shell/tabs/agent.ts");
  const ask = agent.slice(agent.indexOf("export async function askAi("), agent.indexOf("/** Kontext fuer den naechsten Job"));
  const i = (s: string) => { const n = ask.indexOf(s); assert.ok(n >= 0, s); return n; };
  assert.ok(i("const gebot = leseGebot();") < i("const bid = gebot ?? 0;"));
  assert.doesNotMatch(agent, /Number\(\(\$\("#ai-bid"\)/, "das Feld nie mehr als sats lesen");
  // Funk: bezahlt nur mit Gebot
  assert.ok(i('if (gebot === undefined && tarifFunk !== "free" && tarifFunk !== "auto") {') < i("await frageUeberFunk(prompt, bid);"));
  // Automatisch: vor der Rückfrage, die das Gebot in der gewählten Einheit nennt
  assert.ok(i('if (wahl.art !== "gratis" && gebot === undefined) {') < i('if (wahl.art === "fragen") {'));
  assert.match(ask, /\{ gebot: gebotAnzeige\(bid\) \}/);
  // Feste Tarife: vor jedem Auftrag
  assert.ok(i('if (tier !== "free" && gebot === undefined) {') < i("await askWithFailover(prompt, effectiveBid, tier, maxMode);"));

  const app = lies("shell/app.ts");
  assert.match(app, /wireGebot\(\);/);
  assert.match(lies("shell/tabs/modellwahl.ts"), /updateModelBtnLabel\(\);\s*zeigeGebot\(\);/);
  const html = lies("shell/index.html");
  assert.match(html, /<input id="ai-bid"[^>]*\/> <select id="ai-schiene"[^>]*><option value="lightning">sats<\/option><option value="solana">SOL<\/option><\/select>/);
});
