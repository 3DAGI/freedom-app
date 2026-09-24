/**
 * Tests fuer Swap-Adressen.
 *
 * Die Kette ist der Abfluss, gegen den keine Transportverschluesselung hilft.
 * Die Tests pruefen, dass die Massnahmen wirken — und dass ihre Grenzen
 * benannt werden, statt eine Sicherheit vorzutaeuschen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair } from "../src/event.js";
import {
  deriveSwapAddress, checkReuse, checkAmount, checkTiming,
  swapPrivacyCheck, swapPrivacyInfo, addressFingerprint, AddressUsage,
} from "../src/swap-privacy.js";

const NOW = 1_800_000_000;
const KP = generateKeypair();

const benutzt = (address: string, uses: number): AddressUsage =>
  ({ address, uses, firstUsed: NOW - 1000, lastUsed: NOW });

// ------------------------------------------------------------ Ableitung

test("Jede Nummer ergibt eine andere Adresse", () => {
  const a = deriveSwapAddress(KP.sk, 0);
  const b = deriveSwapAddress(KP.sk, 1);
  assert.notDeepEqual(a.secret, b.secret);
  assert.equal(a.secret.length, 32);
});

test("Die Ableitung ist deterministisch", () => {
  // Der ganze Grund, warum es Ableitung statt Zufall ist: Die Merkphrase
  // allein bringt jede Adresse zurueck, ohne Einzelsicherung.
  assert.deepEqual(deriveSwapAddress(KP.sk, 7).secret, deriveSwapAddress(KP.sk, 7).secret);
});

test("Verschiedene Identitaeten ergeben verschiedene Adressen", () => {
  const andere = generateKeypair();
  assert.notDeepEqual(deriveSwapAddress(KP.sk, 0).secret, deriveSwapAddress(andere.sk, 0).secret);
});

test("Die Adresse ist NICHT der Identitaetsschluessel", () => {
  assert.notDeepEqual(deriveSwapAddress(KP.sk, 0).secret, KP.sk);
});

test("Ungueltige Nummern werden abgelehnt", () => {
  assert.throws(() => deriveSwapAddress(KP.sk, -1));
  assert.throws(() => deriveSwapAddress(KP.sk, 1.5));
});

test("Der Fingerabdruck verraet den Schluessel nicht", () => {
  const d = deriveSwapAddress(KP.sk, 0);
  const f = addressFingerprint(d);
  assert.equal(f.length, 16);
  assert.ok(!Buffer.from(d.secret).toString("hex").includes(f));
});

// --------------------------------------------------- Wiederverwendung

test("Lauter frische Adressen sind in Ordnung", () => {
  const r = checkReuse([benutzt("a", 1), benutzt("b", 1), benutzt("c", 1)]);
  assert.equal(r.severity, "frisch");
  assert.equal(r.nextIndex, 3);
});

test("Schon die ZWEITE Benutzung verbindet zwei Vorgaenge", () => {
  const r = checkReuse([benutzt("a", 2)]);
  assert.equal(r.severity, "einmal_wiederverwendet");
  assert.match(r.message, /oeffentlich miteinander verbunden/);
});

test("Ab der dritten entsteht ein Muster", () => {
  // Gewohnheiten identifizieren Menschen zuverlaessiger als einzelne
  // Vorgaenge.
  const r = checkReuse([benutzt("a", 5)]);
  assert.equal(r.severity, "muster");
  assert.match(r.message, /Muster/);
  // Und die unangenehme Wahrheit gehoert dazu.
  assert.match(r.message, /Vergangenheit laesst sich nicht mehr trennen/);
});

test("Ohne Benutzung gibt es nichts zu melden", () => {
  assert.equal(checkReuse([]).severity, "frisch");
});

// ------------------------------------------------------------- Betraege

test("Runde Betraege werden als Problem erkannt", () => {
  // Wer dreimal exakt 0,5 SOL bewegt, hat drei Adressen und ein Muster.
  const r = checkAmount(500_000_000, () => 0.5);
  assert.equal(r.suspicious, true);
  assert.ok(r.suggested! > 500_000_000);
  assert.match(r.message, /verbindet damit seine Adressen wieder/);
});

test("Ein ganzes SOL ist besonders auffaellig", () => {
  assert.equal(checkAmount(1_000_000_000, () => 0.5).suspicious, true);
});

test("Krumme Betraege sind unauffaellig", () => {
  assert.equal(checkAmount(537_291_044).suspicious, false);
});

test("Der Zuschlag ist klein genug, um nicht zu aergern", () => {
  const r = checkAmount(1_000_000_000, () => 1);
  const zuschlag = (r.suggested! - 1_000_000_000) / 1_000_000_000;
  assert.ok(zuschlag <= 0.003, `${(zuschlag * 100).toFixed(2)} % waere zu viel`);
});

test("Der Zuschlag ist gross genug, um zu wirken", () => {
  // Bei Zufall nahe null darf der Vorschlag nicht identisch sein.
  const r = checkAmount(1_000_000_000, () => 0);
  assert.ok(r.suggested! > 1_000_000_000);
});

test("Ein Betrag von null stuerzt nicht ab", () => {
  assert.equal(checkAmount(0).suspicious, false);
});

// ---------------------------------------------------------- Zeitabstand

test("Der erste Swap hat keine Vorgeschichte", () => {
  assert.equal(checkTiming(undefined, NOW).correlated, false);
});

test("Zwei Swaps dicht hintereinander sind verbindbar", () => {
  // Die Grenze des ganzen Verfahrens: Frische Adressen helfen nicht gegen
  // Zeitkorrelation.
  const r = checkTiming(NOW - 60, NOW);
  assert.equal(r.correlated, true);
  assert.match(r.message, /warten/);
});

test("Genug Abstand ist unauffaellig", () => {
  assert.equal(checkTiming(NOW - 7200, NOW).correlated, false);
});

// ------------------------------------------------------------ Gesamtbild

test("Ein sauberer Swap meldet nichts", () => {
  const r = swapPrivacyCheck({
    usage: [benutzt("a", 1)], lamports: 537_291_044,
    lastSwapAt: NOW - 7200, nowSecs: NOW,
  });
  assert.equal(r.ok, true);
  assert.equal(r.actions.length, 0);
});

test("Alle drei Probleme werden zusammen gemeldet", () => {
  const r = swapPrivacyCheck({
    usage: [benutzt("a", 4)], lamports: 1_000_000_000,
    lastSwapAt: NOW - 60, nowSecs: NOW, randomFn: () => 0.5,
  });
  assert.equal(r.ok, false);
  assert.equal(r.findings.length, 3);
  assert.equal(r.actions.length, 3);
});

test("Die Massnahmen stehen nach Gewinn sortiert", () => {
  // Die frische Adresse bringt am meisten, das Warten am wenigsten.
  const r = swapPrivacyCheck({
    usage: [benutzt("a", 4)], lamports: 1_000_000_000,
    lastSwapAt: NOW - 60, nowSecs: NOW, randomFn: () => 0.5,
  });
  assert.match(r.actions[0], /Frische Adresse/);
  assert.match(r.actions[2], /[Ww]arten/);
});

test("Die Auskunft nennt, was frische Adressen NICHT loesen", () => {
  // Eine Massnahme, deren Grenzen verschwiegen werden, erzeugt genau das
  // falsche Verhalten.
  const t = swapPrivacyInfo();
  assert.match(t, /NICHT loesen/);
  assert.match(t, /[Rr]unde Betraege/);
  assert.match(t, /rueckwirkend/);
  assert.match(t, /Kein Mixnetz und kein Tor/);
});
