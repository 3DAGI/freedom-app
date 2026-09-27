/**
 * Schritt 5.1.1: Gebührenmodell A+ – feste Aufteilung beim Zahlen. Geprüft
 * wird: Summe stimmt immer, nicht Zuordenbares bleibt beim Provider, Relays
 * teilen sich ihren Anteil, SOL vorerst ganz an den Provider, und der Provider
 * rechnet aus der Deklaration denselben Betrag wie die App des Kunden.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANTEILE, ANTEILE_PPM, ENTWICKLUNG, MAX_ANTEILE_PPM, PROVIDER_PPM, adresseFuer, aufteilungTag, providerAnteilMsat,
  pruefeAufteilung, teileAuf, zahlbareAnteile, type Empfaenger,
} from "../src/aufteilung.js";

const SOL_ADR = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const alle: Empfaenger = {
  entwicklung: { lud16: "dev@freedom.example", sol: SOL_ADR },
  relays: [{ lud16: "relay1@r.example" }, { lud16: "relay2@r.example" }, { lud16: "relay3@r.example" }, { lud16: "relay4@r.example" }],
  "werber-kunde": { lud16: "werberin@wallet.example" },
  "werber-provider": { lud16: "werber@wallet.example" },
  hosting: { lud16: "spiegel@host.example" },
};

test("Anteile: 94 / 2,5 / 1,5 / 0,5 / 0,5 / 1 – zusammen 100 %, ohne Provider höchstens 10 %", () => {
  assert.equal(PROVIDER_PPM, 940_000);
  assert.deepEqual(ANTEILE_PPM, { entwicklung: 25_000, relays: 15_000, "werber-kunde": 5_000, "werber-provider": 5_000, hosting: 10_000 });
  assert.equal(PROVIDER_PPM + ANTEILE.reduce((s, a) => s + ANTEILE_PPM[a], 0), 1_000_000);
  assert.ok(1_000_000 - PROVIDER_PPM <= MAX_ANTEILE_PPM);
});

test("Alle Empfänger bekannt: 100.000 sats → 94.000 Provider, jeder Anteil exakt; Relays höchstens drei, zu gleichen Teilen", () => {
  const r = teileAuf(100_000_000, alle, "lightning");
  assert.equal(r.providerMsat, 94_000_000);
  const je = (a: string) => r.posten.filter((p) => p.anteil === a).map((p) => [p.ziel, p.msat]);
  assert.deepEqual(je("entwicklung"), [["dev@freedom.example", 2_500_000]]);
  assert.deepEqual(je("relays"), [["relay1@r.example", 500_000], ["relay2@r.example", 500_000], ["relay3@r.example", 500_000]]);
  assert.deepEqual(je("werber-kunde"), [["werberin@wallet.example", 500_000]]);
  assert.deepEqual(je("werber-provider"), [["werber@wallet.example", 500_000]]);
  assert.deepEqual(je("hosting"), [["spiegel@host.example", 1_000_000]]);
});

test("Summe stimmt bei jedem Betrag; Rundungsreste bleiben beim Provider; Relay-Rest beim ersten Relay", () => {
  for (const betrag of [0, 1, 999, 1_000, 33_333, 123_457, 10_000_001, 987_654_321]) {
    const r = teileAuf(betrag, alle, "lightning");
    assert.equal(r.providerMsat + r.posten.reduce((s, p) => s + p.msat, 0), betrag, `Betrag ${betrag}`);
    assert.ok(r.providerMsat >= Math.floor((betrag * PROVIDER_PPM) / 1_000_000), "nie unter 94 %");
    assert.ok(r.posten.every((p) => p.msat > 0), "keine Null-Zahlungen");
  }
  const r = teileAuf(100_100, alle, "lightning");
  assert.deepEqual(r.posten.filter((p) => p.anteil === "relays").map((p) => p.msat), [501, 500, 500], "1,5 % von 100.100 msat = 1.501 → je 500, der Rest an den ersten");
});

test("Nicht zuordenbar → Provider: ohne Werber, ohne Spiegel, ohne Relay-Adresse; ungültige Adressen zählen nicht", () => {
  const e: Empfaenger = {
    entwicklung: { lud16: "dev@freedom.example" },
    relays: [{}, { lud16: "kaputt" }, { lud16: "x@localhost" }, { lud16: "y@192.168.1.2" }],
    "werber-kunde": { lud16: "  " },
    hosting: { sol: SOL_ADR },
  };
  assert.deepEqual(zahlbareAnteile(e, "lightning"), ["entwicklung"]);
  const r = teileAuf(1_000_000, e, "lightning");
  assert.equal(r.providerMsat, 975_000);
  assert.deepEqual(r.posten, [{ anteil: "entwicklung", msat: 25_000, ziel: "dev@freedom.example" }]);
  assert.deepEqual(teileAuf(1_000_000, {}, "lightning"), { providerMsat: 1_000_000, posten: [] }, "niemand bekannt → alles an den Provider, nie an die Entwicklung");
});

test("SOL: vorerst ganz an den Provider – die Aufteilung erzwingt erst das Programm des Zahlkanals (4.3)", () => {
  assert.deepEqual(zahlbareAnteile(alle, "solana"), []);
  assert.deepEqual(teileAuf(5_000_000, alle, "solana"), { providerMsat: 5_000_000, posten: [] });
  assert.equal(adresseFuer({ sol: SOL_ADR }, "solana"), SOL_ADR);
  assert.equal(adresseFuer({ sol: "0OIl-kein-base58" }, "solana"), undefined);
});

test("Deklaration: die App nennt ihre Anteile im Auftrag, der Provider rechnet denselben Rechnungsbetrag", () => {
  const e: Empfaenger = { ...alle, "werber-provider": undefined };
  const anteile = zahlbareAnteile(e, "lightning");
  const tag = aufteilungTag(anteile);
  assert.deepEqual(tag, ["aufteilung", "entwicklung", "relays", "werber-kunde", "hosting"]);
  const pruef = pruefeAufteilung([["p", "x"], tag], { hatWerber: false });
  assert.ok(pruef.ok);
  if (!pruef.ok) return;
  assert.equal(pruef.einbehaltenPpm, 55_000);
  for (const betrag of [1, 777, 100_000_000, 123_456_789]) {
    assert.equal(providerAnteilMsat(betrag, pruef.anteile), teileAuf(betrag, e, "lightning").providerMsat, `Betrag ${betrag}`);
  }
  assert.deepEqual(pruefeAufteilung([], { hatWerber: true }), { ok: true, anteile: [], einbehaltenPpm: 0 }, "ohne Tag: ganzer Betrag an den Provider");
});

test("Deklaration abgelehnt: unbekannt, doppelt, mehrfach, Werber des Providers ohne Angebot", () => {
  const nein = (tags: string[][], hatWerber = false) => {
    const r = pruefeAufteilung(tags, { hatWerber });
    assert.equal(r.ok, false, JSON.stringify(tags));
    return r.ok ? "" : r.grund;
  };
  assert.match(nein([["aufteilung", "entwicklung", "treasury"]]), /unbekannt/);
  assert.match(nein([["aufteilung", "hosting", "hosting"]]), /doppelt/);
  assert.match(nein([["aufteilung", "hosting"], ["aufteilung", "relays"]]), /mehrfach/);
  assert.match(nein([["aufteilung", "werber-provider"]]), /Werber des Providers/);
  assert.ok(pruefeAufteilung([["aufteilung", ...ANTEILE]], { hatWerber: true }).ok, "alle fünf: 6 % ≤ 10 %");
});

test("5.1.3: Entwicklung ohne eigene Adresse – ihr Anteil bleibt beim Provider, nie bei einem Verwahrer", () => {
  assert.ok(Object.isFrozen(ENTWICKLUNG), "ändern nur mit signiertem Release");
  // Solange der MENSCH keine selbstverwahrte Adresse nennt, ist der Anteil nicht zuordenbar
  const adressen = [adresseFuer(ENTWICKLUNG, "lightning"), adresseFuer(ENTWICKLUNG, "solana")].filter(Boolean);
  for (const a of adressen) assert.doesNotMatch(a!, /walletofsatoshi|getalby|strike|wos\./i, "keine Verwahrer-Adresse");
  if (adressen.length === 0) {
    const r = teileAuf(1_000_000, { entwicklung: ENTWICKLUNG }, "lightning");
    assert.deepEqual(r, { providerMsat: 1_000_000, posten: [] });
    assert.deepEqual(zahlbareAnteile({ entwicklung: ENTWICKLUNG }, "lightning"), []);
  }
});
