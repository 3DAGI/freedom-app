/**
 * Schritt 5.1.1: Gebührenmodell A+ – feste Aufteilung beim Zahlen. Geprüft
 * wird: Summe stimmt immer, nicht Zuordenbares bleibt beim Provider, Relays
 * teilen sich ihren Anteil, SOL vorerst ganz an den Provider, und der Provider
 * rechnet aus der Deklaration denselben Betrag wie die App des Kunden.
 * Seit P5b (Entscheidung 05.10.2026): Entwicklung 2,0 %, Prüfbudget 0,5 % beim
 * Kunden – beides nur bei Knoten ab Fassung 2 der Aufteilung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANTEILE, ANTEILE_PPM, AUFTEILUNG_FASSUNG, ENTWICKLUNG, MAX_ANTEILE_PPM, PROVIDER_PPM, adresseFuer, aufteilungTag, kanalEmpfaenger, providerAnteilMsat,
  pruefeAufteilung, teileAuf, zahlbareAnteile, type Empfaenger,
} from "../src/aufteilung.js";

const SOL_ADR = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const alle: Empfaenger = {
  fassung: AUFTEILUNG_FASSUNG,
  entwicklung: { lud16: "dev@freedom.example", sol: SOL_ADR },
  pruefung: true,
  relays: [{ lud16: "relay1@r.example" }, { lud16: "relay2@r.example" }, { lud16: "relay3@r.example" }, { lud16: "relay4@r.example" }],
  "werber-kunde": { lud16: "werberin@wallet.example" },
  "werber-provider": { lud16: "werber@wallet.example" },
  hosting: { lud16: "spiegel@host.example" },
};

test("Anteile: 94 / 2,0 / 0,5 / 1,5 / 0,5 / 0,5 / 1 – zusammen 100 %, ohne Provider höchstens 10 %", () => {
  assert.equal(PROVIDER_PPM, 940_000);
  assert.deepEqual(ANTEILE_PPM, { entwicklung: 20_000, pruefung: 5_000, relays: 15_000, "werber-kunde": 5_000, "werber-provider": 5_000, hosting: 10_000 });
  assert.equal(AUFTEILUNG_FASSUNG, 2);
  assert.equal(PROVIDER_PPM + ANTEILE.reduce((s, a) => s + ANTEILE_PPM[a], 0), 1_000_000);
  assert.ok(1_000_000 - PROVIDER_PPM <= MAX_ANTEILE_PPM);
});

test("Alle Empfänger bekannt: 100.000 sats → 94.000 Provider, jeder Anteil exakt; Relays höchstens drei, zu gleichen Teilen", () => {
  const r = teileAuf(100_000_000, alle, "lightning");
  assert.equal(r.providerMsat, 94_000_000);
  const je = (a: string) => r.posten.filter((p) => p.anteil === a).map((p) => [p.ziel, p.msat]);
  assert.deepEqual(je("entwicklung"), [["dev@freedom.example", 2_000_000]]);
  assert.deepEqual(je("pruefung"), [], "das Prüfbudget ist kein Posten – es bleibt beim Kunden");
  assert.equal(r.pruefbudgetMsat, 500_000);
  assert.deepEqual(je("relays"), [["relay1@r.example", 500_000], ["relay2@r.example", 500_000], ["relay3@r.example", 500_000]]);
  assert.deepEqual(je("werber-kunde"), [["werberin@wallet.example", 500_000]]);
  assert.deepEqual(je("werber-provider"), [["werber@wallet.example", 500_000]]);
  assert.deepEqual(je("hosting"), [["spiegel@host.example", 1_000_000]]);
});

test("Summe stimmt bei jedem Betrag; Rundungsreste bleiben beim Provider; Relay-Rest beim ersten Relay", () => {
  for (const betrag of [0, 1, 999, 1_000, 33_333, 123_457, 10_000_001, 987_654_321]) {
    const r = teileAuf(betrag, alle, "lightning");
    assert.equal(r.providerMsat + r.posten.reduce((s, p) => s + p.msat, 0) + r.pruefbudgetMsat, betrag, `Betrag ${betrag}`);
    assert.ok(r.providerMsat >= Math.floor((betrag * PROVIDER_PPM) / 1_000_000), "nie unter 94 %");
    assert.ok(r.posten.every((p) => p.msat > 0), "keine Null-Zahlungen");
  }
  const r = teileAuf(100_100, alle, "lightning");
  assert.deepEqual(r.posten.filter((p) => p.anteil === "relays").map((p) => p.msat), [501, 500, 500], "1,5 % von 100.100 msat = 1.501 → je 500, der Rest an den ersten");
});

test("Nicht zuordenbar → Provider: ohne Werber, ohne Spiegel, ohne Relay-Adresse; ungültige Adressen zählen nicht", () => {
  const e: Empfaenger = {
    fassung: AUFTEILUNG_FASSUNG,
    entwicklung: { lud16: "dev@freedom.example" },
    relays: [{}, { lud16: "kaputt" }, { lud16: "x@localhost" }, { lud16: "y@192.168.1.2" }],
    "werber-kunde": { lud16: "  " },
    hosting: { sol: SOL_ADR },
  };
  assert.deepEqual(zahlbareAnteile(e, "lightning"), ["entwicklung"]);
  const r = teileAuf(1_000_000, e, "lightning");
  assert.equal(r.providerMsat, 980_000);
  assert.deepEqual(r.posten, [{ anteil: "entwicklung", msat: 20_000, ziel: "dev@freedom.example" }]);
  assert.equal(r.pruefbudgetMsat, 0, "ohne Wahl kein Prüfbudget");
  assert.deepEqual(teileAuf(1_000_000, {}, "lightning"), { providerMsat: 1_000_000, posten: [], pruefbudgetMsat: 0 }, "niemand bekannt → alles an den Provider, nie an die Entwicklung");
});

test("SOL: vorerst ganz an den Provider – die Aufteilung erzwingt erst das Programm des Zahlkanals (4.3)", () => {
  assert.deepEqual(zahlbareAnteile(alle, "solana"), []);
  assert.deepEqual(teileAuf(5_000_000, alle, "solana"), { providerMsat: 5_000_000, posten: [], pruefbudgetMsat: 0 });
  assert.equal(adresseFuer({ sol: SOL_ADR }, "solana"), SOL_ADR);
  assert.equal(adresseFuer({ sol: "0OIl-kein-base58" }, "solana"), undefined);
});

test("Deklaration: die App nennt ihre Anteile im Auftrag, der Provider rechnet denselben Rechnungsbetrag", () => {
  const e: Empfaenger = { ...alle, "werber-provider": undefined };
  const anteile = zahlbareAnteile(e, "lightning");
  const tag = aufteilungTag(anteile);
  assert.deepEqual(tag, ["aufteilung", "entwicklung", "pruefung", "relays", "werber-kunde", "hosting"]);
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
  assert.ok(pruefeAufteilung([["aufteilung", ...ANTEILE]], { hatWerber: true }).ok, "alle sechs: 6 % ≤ 10 %");
});

test("5.1.3: Entwicklung ohne eigene Adresse – ihr Anteil bleibt beim Provider, nie bei einem Verwahrer", () => {
  assert.ok(Object.isFrozen(ENTWICKLUNG), "ändern nur mit signiertem Release");
  // Solange der MENSCH keine selbstverwahrte Adresse nennt, ist der Anteil nicht zuordenbar
  const adressen = [adresseFuer(ENTWICKLUNG, "lightning"), adresseFuer(ENTWICKLUNG, "solana")].filter(Boolean);
  for (const a of adressen) assert.doesNotMatch(a!, /walletof[s]atoshi|getalby|strike|wos\./i, "keine Verwahrer-Adresse");
  if (adressen.length === 0) {
    const r = teileAuf(1_000_000, { fassung: AUFTEILUNG_FASSUNG, entwicklung: ENTWICKLUNG }, "lightning");
    assert.deepEqual(r, { providerMsat: 1_000_000, posten: [], pruefbudgetMsat: 0 });
    assert.deepEqual(zahlbareAnteile({ fassung: AUFTEILUNG_FASSUNG, entwicklung: ENTWICKLUNG }, "lightning"), []);
  }
});

test("4.3d: Empfänger eines Zahlkanals – nur Anteile mit SOL-Adresse, Relays höchstens drei, doppelte zusammen, Provider und Kunde nie", () => {
  const sol = (n: number) => ["9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T",
    "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "So11111111111111111111111111111111111111112"][n]!;
  // Heute nur Lightning-Adressen bekannt (Werber, Relays): nichts im Kanal, alles beim Provider
  assert.deepEqual(kanalEmpfaenger({ ...alle, entwicklung: { lud16: "dev@freedom.example" } }), []);
  const e: Empfaenger = {
    entwicklung: { sol: sol(0) },
    relays: [{ sol: sol(1) }, { lud16: "relay@r.example" }, { sol: sol(2) }, { sol: sol(1) }, { sol: sol(3) }, { sol: sol(4) }],
    hosting: { sol: sol(0) },
    "werber-kunde": { sol: "kein-base58-0OIl" },
  };
  const k = kanalEmpfaenger(e);
  // Entwicklung + Hosting an dieselbe Adresse: einmal, 20.000 + 10.000 ppm
  assert.deepEqual(k, [
    { adresse: sol(0), ppm: 30_000 },
    { adresse: sol(1), ppm: 5_000 },
    { adresse: sol(2), ppm: 5_000 },
    { adresse: sol(3), ppm: 5_000 },
  ]);
  assert.ok(k.reduce((s, x) => s + x.ppm, 0) <= MAX_ANTEILE_PPM);
  // Zwei Relays: 7.500 je – der Rest (0) an den ersten; drei Relays mit 15.000 / 3 = 5.000
  assert.deepEqual(kanalEmpfaenger({ relays: [{ sol: sol(1) }, { sol: sol(2) }] }), [{ adresse: sol(1), ppm: 7_500 }, { adresse: sol(2), ppm: 7_500 }]);
  // Provider oder Kunde als Empfänger: fällt weg, der Anteil bleibt beim Provider
  assert.deepEqual(kanalEmpfaenger({ entwicklung: { sol: sol(0) }, hosting: { sol: sol(4) } }, [sol(4)]), [{ adresse: sol(0), ppm: 20_000 }]);
  // Das Prüfbudget hat im Kanal keinen Empfänger (SOL erst mit P5d) – es bleibt beim Provider
  assert.deepEqual(kanalEmpfaenger({ pruefung: true, fassung: AUFTEILUNG_FASSUNG }), []);
});

test("P5b: Prüfbudget 0,5 % bleibt beim Kunden – nur gewählt und nur bei Knoten ab Fassung 2; die Rechnung des Knotens stimmt", () => {
  const e: Empfaenger = { fassung: AUFTEILUNG_FASSUNG, pruefung: true };
  assert.deepEqual(zahlbareAnteile(e, "lightning"), ["pruefung"]);
  const r = teileAuf(1_000_000, e, "lightning");
  assert.deepEqual(r, { providerMsat: 995_000, posten: [], pruefbudgetMsat: 5_000 });
  // Gerundet wird ab – der Rest bleibt beim Provider
  assert.deepEqual(teileAuf(199, e, "lightning"), { providerMsat: 199, posten: [], pruefbudgetMsat: 0 });
  assert.equal(teileAuf(1_999, e, "lightning").pruefbudgetMsat, 9);
  // Der Knoten liest die Deklaration und stellt genau den Rest in Rechnung
  const pruef = pruefeAufteilung([aufteilungTag(zahlbareAnteile(e, "lightning"))], { hatWerber: false });
  assert.ok(pruef.ok);
  if (pruef.ok) {
    assert.equal(pruef.einbehaltenPpm, 5_000);
    for (const betrag of [1, 199, 1_999, 123_456_789]) assert.equal(providerAnteilMsat(betrag, pruef.anteile), teileAuf(betrag, e, "lightning").providerMsat);
  }
  // Nicht gewählt: kein Budget
  assert.deepEqual(zahlbareAnteile({ fassung: AUFTEILUNG_FASSUNG, pruefung: false }, "lightning"), []);
});

test("P5b: Knoten ohne Fassung 2 – weder Entwicklung noch Prüfbudget deklariert (er lehnte „pruefung“ ab und rechnete 2,5 %), beides beim Provider", () => {
  for (const fassung of [undefined, 1]) {
    const e: Empfaenger = { ...alle, fassung };
    const anteile = zahlbareAnteile(e, "lightning");
    assert.ok(!anteile.includes("entwicklung") && !anteile.includes("pruefung"), String(fassung));
    assert.deepEqual(anteile, ["relays", "werber-kunde", "werber-provider", "hosting"]);
    const r = teileAuf(100_000_000, e, "lightning");
    assert.equal(r.pruefbudgetMsat, 0);
    assert.equal(r.providerMsat, 96_500_000, "94 % + Entwicklung 2,0 % + Prüfbudget 0,5 % bleiben beim Provider");
  }
  // Ein älterer Knoten nennt keine Fassung – unbekannte Anteile lehnt jeder Knoten ab
  assert.equal(pruefeAufteilung([["aufteilung", "pruefbudget"]], { hatWerber: false }).ok, false);
});
