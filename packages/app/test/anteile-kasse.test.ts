/**
 * Schritt 5.1.3: Die App zahlt die Anteile einer KI-Zahlung selbst (Modell A+).
 * Geprüft wird: Sie rechnet denselben Anteil des Providers wie sein Knoten,
 * zahlt nie mehr als das Gebot, sammelt Anteile unter 100 sats je Empfänger,
 * zahlt nur ganze sats – und nie ein zweites Mal, wenn der Ausgang unklar ist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AUFTEILUNG_FASSUNG, aufteilungTag, providerAnteilMsat, pruefeAufteilung, zahlbareAnteile, type Empfaenger } from "@freedomstack/protocol";
import { AnteilsKasse, BUENDEL_MSAT, LS_ANTEILE, rechneAb } from "../src/anteile-kasse.js";

const empfaenger: Empfaenger = { "werber-provider": { lud16: "werber@wallet.example" }, entwicklung: {} };

function speicher(start: Record<string, string> = {}) {
  const m = new Map(Object.entries(start));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

/** Zahlweg zum Zählen: Rechnung je Betrag, Zahlen scheitert auf Wunsch. */
function zahlweg(p: { rechnungScheitert?: boolean; zahlenScheitert?: boolean } = {}) {
  const rechnungen: Array<[string, number]> = [];
  const gezahlt: Array<[string, number]> = [];
  return {
    rechnungen, gezahlt,
    async rechnung(ziel: string, msat: number) {
      if (p.rechnungScheitert) throw new Error("LNURL-Server weg");
      rechnungen.push([ziel, msat]);
      return `lnbc-${ziel}-${msat}-${rechnungen.length}`;
    },
    async zahle(rechnung: string, msat: number) {
      if (p.zahlenScheitert) throw new Error("NWC: Zeitüberschreitung");
      gezahlt.push([rechnung, msat]);
    },
  };
}

test("Abrechnung: derselbe Anteil des Providers wie beim Knoten; höchstens das Gebot; ohne gemerkte Anfrage nichts", () => {
  // Was der Knoten aus der Deklaration im Auftrag rechnet (5.1.2)
  const tag = aufteilungTag(zahlbareAnteile(empfaenger, "lightning"));
  const pruefung = pruefeAufteilung([tag], { hatWerber: true });
  assert.ok(pruefung.ok);
  for (const betrag of [1, 999, 21_000, 123_457]) {
    const r = rechneAb(betrag, { empfaenger, hoechstMsat: 1_000_000 });
    assert.equal(r.providerMsat, providerAnteilMsat(betrag, pruefung.anteile), `Betrag ${betrag}`);
    assert.equal(r.providerMsat + r.posten.reduce((s, p) => s + p.msat, 0), betrag, "Summe stimmt");
    assert.equal(r.gekappt, false);
  }
  const zuViel = rechneAb(50_000, { empfaenger, hoechstMsat: 20_000 });
  assert.equal(zuViel.gekappt, true);
  assert.equal(zuViel.providerMsat + zuViel.posten.reduce((s, p) => s + p.msat, 0), 20_000, "nie mehr als das Gebot");
  assert.deepEqual(rechneAb(50_000, undefined), { providerMsat: 0, posten: [], pruefbudgetMsat: 0, gekappt: false });
  assert.deepEqual(rechneAb(50_000, { empfaenger, hoechstMsat: 0 }).providerMsat, 0, "Gratis-Tarif: Gebot 0");
});

test("P5b: Prüfbudget – bei Knoten ab Fassung 2 bleiben 0,5 % beim Kunden; der Knoten rechnet denselben Anteil", () => {
  const mitBudget: Empfaenger = { ...empfaenger, fassung: AUFTEILUNG_FASSUNG, pruefung: true };
  const pruefung = pruefeAufteilung([aufteilungTag(zahlbareAnteile(mitBudget, "lightning"))], { hatWerber: true });
  assert.ok(pruefung.ok);
  for (const betrag of [1, 999, 21_000, 123_457]) {
    const r = rechneAb(betrag, { empfaenger: mitBudget, hoechstMsat: 1_000_000 });
    assert.equal(r.providerMsat, providerAnteilMsat(betrag, pruefung.anteile), `Betrag ${betrag}`);
    assert.equal(r.pruefbudgetMsat, Math.floor(betrag * 0.005));
    assert.equal(r.providerMsat + r.posten.reduce((s, p) => s + p.msat, 0) + r.pruefbudgetMsat, betrag, "Summe stimmt");
  }
  // Ohne Fassung (älterer Knoten): kein Budget, alles wie bisher
  assert.equal(rechneAb(21_000, { empfaenger: { ...empfaenger, pruefung: true }, hoechstMsat: 1_000_000 }).pruefbudgetMsat, 0);
});

test("Kasse: je Empfänger gesammelt; unter 100 sats nichts; dann ganze sats, der Rest bleibt", async () => {
  const sp = speicher();
  const kasse = new AnteilsKasse({ speicher: sp });
  await kasse.verbuche([{ anteil: "werber-provider", msat: 60_400, ziel: "a@x.example" }, { anteil: "relays", msat: 10, ziel: "r@x.example" }]);
  const z = zahlweg();
  assert.deepEqual(await kasse.zahleFaellige(z), { gezahltMsat: 0, unklarMsat: 0 });
  assert.equal(z.rechnungen.length, 0);
  await kasse.verbuche([{ anteil: "werber-kunde", msat: 40_000, ziel: "a@x.example" }]);
  assert.deepEqual(await kasse.zahleFaellige(z), { gezahltMsat: 100_000, unklarMsat: 0 });
  assert.deepEqual(z.rechnungen, [["a@x.example", 100_000]]);
  assert.deepEqual(kasse.stand().offen, [{ ziel: "a@x.example", msat: 400, anteile: ["werber-provider", "werber-kunde"] }, { ziel: "r@x.example", msat: 10, anteile: ["relays"] }]);
  assert.deepEqual(kasse.stand().unklar, []);
  assert.ok(BUENDEL_MSAT === 100_000);
});

test("Kasse: ohne Rechnung bleibt alles offen; scheitert das Zahlen, ist es unklar und wird nie von selbst wiederholt", async () => {
  const sp = speicher();
  const kasse = new AnteilsKasse({ speicher: sp, jetzt: () => 1_790_000_000 });
  await kasse.verbuche([{ anteil: "entwicklung", msat: 150_000, ziel: "dev@x.example" }]);
  assert.deepEqual(await kasse.zahleFaellige(zahlweg({ rechnungScheitert: true })), { gezahltMsat: 0, unklarMsat: 0 });
  assert.equal(kasse.stand().offen[0]!.msat, 150_000, "vor der Wallet gescheitert – nichts ging raus");

  assert.deepEqual(await kasse.zahleFaellige(zahlweg({ zahlenScheitert: true })), { gezahltMsat: 0, unklarMsat: 150_000 });
  const { offen, unklar } = kasse.stand();
  assert.deepEqual(offen, []);
  assert.equal(unklar.length, 1);
  assert.deepEqual({ ...unklar[0], rechnung: "" }, { ziel: "dev@x.example", msat: 150_000, anteile: ["entwicklung"], rechnung: "", at: 1_790_000_000 });
  // Nächster Lauf: nichts, was noch einmal gezahlt würde
  const z = zahlweg();
  await kasse.zahleFaellige(z);
  assert.equal(z.rechnungen.length, 0);
  // Der Nutzer sagt: kam nicht an – zurück in die Kasse, dann normal gezahlt
  await kasse.klaere(unklar[0]!.rechnung, false);
  assert.deepEqual(kasse.stand(), { offen: [{ ziel: "dev@x.example", msat: 150_000, anteile: ["entwicklung"] }], unklar: [] });
  assert.equal((await kasse.zahleFaellige(z)).gezahltMsat, 150_000);
  assert.deepEqual(kasse.stand(), { offen: [], unklar: [] });
});

test("Kasse: „kam an“ erledigt die unklare Zahlung; zwei Läufe zugleich zahlen nicht doppelt; Unlesbares sperrt nichts", async () => {
  const kasse = new AnteilsKasse({ speicher: speicher() });
  await kasse.verbuche([{ anteil: "hosting", msat: 100_000, ziel: "h@x.example" }]);
  await kasse.zahleFaellige(zahlweg({ zahlenScheitert: true }));
  await kasse.klaere(kasse.stand().unklar[0]!.rechnung, true);
  assert.deepEqual(kasse.stand(), { offen: [], unklar: [] });

  await kasse.verbuche([{ anteil: "hosting", msat: 200_000, ziel: "h@x.example" }]);
  const z = zahlweg();
  const [a, b] = await Promise.all([kasse.zahleFaellige(z), kasse.zahleFaellige(z)]);
  assert.equal(a.gezahltMsat + b.gezahltMsat, 200_000);
  assert.equal(z.gezahlt.length, 1);

  const kaputt = new AnteilsKasse({ speicher: speicher({ [LS_ANTEILE]: JSON.stringify({ offen: [{ ziel: "x@y.example", msat: -5, anteile: [] }, { ziel: "ok@y.example", msat: 5, anteile: ["topf"] }, { ziel: "gut@y.example", msat: 7, anteile: ["relays"] }], unklar: "nein" }) }) });
  assert.deepEqual(kaputt.stand(), { offen: [{ ziel: "gut@y.example", msat: 7, anteile: ["relays"] }], unklar: [] });
  assert.deepEqual(new AnteilsKasse({ speicher: speicher({ [LS_ANTEILE]: "{kaputt" }) }).stand(), { offen: [], unklar: [] });
});
