/**
 * Schritt E10b2: ein Kopfgeld bezahlen – je Währung genau eine Zahlung, direkt an die Person, nie doppelt,
 * nie von selbst wiederholt; Ziele nur aus den vorhandenen Quellen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Beleg, Kopfgeld, Zahlanfrage } from "@freedomstack/protocol";
import { setLang } from "../src/i18n.js";
import { LS_KOPFGELD_BEZAHLT, bezahleKopfgeld, schonBezahlt, type KopfgeldZahlWege } from "../src/kopfgeld-zahlung.js";

const A = "a".repeat(64), B = "b".repeat(64);
const kopfgeld = (k: Partial<Kopfgeld> = {}): Kopfgeld => ({
  kennung: "k1", titel: "Säge schärfen", beschreibung: "", geldgeber: A, stand: "vergeben", an: B, zeit: 1, msat: 21_000, ...k,
});

function wege(o: Partial<KopfgeldZahlWege> & { scheitert?: "msat" | "lamports" } = {}) {
  const daten = new Map<string, string>();
  const zahlungen: Zahlanfrage[] = [];
  const w: KopfgeldZahlWege = {
    lud16: async () => "b@knoten.example.org",
    frageRechnung: async () => "lnbc210n1rechnung",
    solAdresse: async () => "So11111111111111111111111111111111111111112",
    solAusProfil: async () => null,
    zahle: async (a) => {
      zahlungen.push(a);
      if (o.scheitert === a.betrag.einheit) throw new Error("Wallet sagt nein");
      return { rail: a.betrag.einheit === "msat" ? "lightning" : "solana", ziel: a.ziel, betrag: a.betrag, ref: `ref-${a.betrag.einheit}`, zeit: 1 } as Beleg;
    },
    speicher: { getItem: (k) => daten.get(k) ?? null, setItem: async (k, v) => void daten.set(k, v) },
    ...o,
  };
  return { w, zahlungen, daten };
}

test("Lightning über die Adresse im Profil – die Schiene holt die Rechnung und prüft den Betrag", async () => {
  const { w, zahlungen } = wege();
  const r = await bezahleKopfgeld(kopfgeld(), w);
  assert.deepEqual(zahlungen, [{ ziel: "b@knoten.example.org", betrag: { einheit: "msat", wert: 21_000 }, zweck: "kopfgeld" }]);
  assert.deepEqual(r, { msat: "ref-msat" });
  assert.deepEqual(schonBezahlt(kopfgeld(), w.speicher), { msat: "ref-msat" });
});

test("ohne Adresse versiegelt erfragt – nur in ganzen sats; ohne Antwort geht nichts hinaus", async () => {
  setLang("de");
  const gefragt: number[] = [];
  const mit = wege({ lud16: async () => "", frageRechnung: async (m) => { gefragt.push(m); return "lnbc210n1versiegelt"; } });
  await bezahleKopfgeld(kopfgeld(), mit.w);
  assert.deepEqual(gefragt, [21_000]);
  assert.equal(mit.zahlungen[0]!.ziel, "lnbc210n1versiegelt");
  const krumm = wege({ lud16: async () => "" });
  await assert.rejects(bezahleKopfgeld(kopfgeld({ msat: 21_500 }), krumm.w), /ganze sats/i);
  assert.equal(krumm.zahlungen.length, 0);
  const still = wege({ lud16: async () => "", frageRechnung: async () => null });
  await assert.rejects(bezahleKopfgeld(kopfgeld(), still.w), /Keine Rechnung/);
  assert.equal(still.zahlungen.length, 0);
});

test("beide Währungen: scheitert SOL, bleibt Lightning gemerkt – der nächste Klick zahlt nur SOL", async () => {
  const kg = kopfgeld({ lamports: 10_000_000 });
  const erst = wege({ scheitert: "lamports" });
  await assert.rejects(bezahleKopfgeld(kg, erst.w), /Wallet sagt nein/);
  assert.deepEqual(erst.zahlungen.map((z) => z.betrag.einheit), ["msat", "lamports"], "kein zweiter Versuch von selbst");
  assert.deepEqual(schonBezahlt(kg, erst.w.speicher), { msat: "ref-msat" });
  const dann = wege({ speicher: erst.w.speicher });
  await bezahleKopfgeld(kg, dann.w);
  assert.deepEqual(dann.zahlungen.map((z) => z.betrag), [{ einheit: "lamports", wert: 10_000_000 }]);
  assert.deepEqual(schonBezahlt(kg, dann.w.speicher), { msat: "ref-msat", lamports: "ref-lamports" });
  // Alles bezahlt: ein weiterer Klick zahlt nichts mehr
  const nochmal = wege({ speicher: erst.w.speicher });
  await bezahleKopfgeld(kg, nochmal.w);
  assert.equal(nochmal.zahlungen.length, 0);
});

test("SOL: die öffentliche Adresse aus dem Profil nur, wenn keine andere da ist und nach Warnung", async () => {
  setLang("de");
  const kg = kopfgeld({ msat: undefined, lamports: 5_000 });
  let gewarnt = 0;
  const ok = wege({ solAdresse: async () => "", solAusProfil: async () => { gewarnt++; return "Pub1ic1111111111111111111111111111111111111"; } });
  await bezahleKopfgeld(kg, ok.w);
  assert.equal(gewarnt, 1);
  assert.equal(ok.zahlungen[0]!.ziel, "Pub1ic1111111111111111111111111111111111111");
  const nein = wege({ solAdresse: async () => undefined, solAusProfil: async () => null });
  await assert.rejects(bezahleKopfgeld(kg, nein.w), /Keine SOL-Adresse/);
  assert.equal(nein.zahlungen.length, 0);
  const gemerkt = wege({ solAusProfil: async () => { throw new Error("nicht gefragt"); } });
  await bezahleKopfgeld(kg, gemerkt.w);
  assert.equal(gemerkt.zahlungen[0]!.ziel, "So11111111111111111111111111111111111111112");
});

test("nur vergebene (oder schon erledigte) Kopfgelder – je Empfänger eigener Stand", async () => {
  setLang("de");
  const { w, zahlungen } = wege();
  await assert.rejects(bezahleKopfgeld(kopfgeld({ stand: "offen", an: undefined }), w), /erst, wenn das Kopfgeld vergeben ist/);
  await assert.rejects(bezahleKopfgeld(kopfgeld({ stand: "zurueckgezogen" }), w), /vergeben/);
  assert.equal(zahlungen.length, 0);
  await bezahleKopfgeld(kopfgeld(), w);
  // An jemand anderen neu vergeben: dieser Stand beginnt von vorn
  assert.deepEqual(schonBezahlt(kopfgeld({ an: "c".repeat(64) }), w.speicher), {});
  assert.ok(JSON.parse(w.speicher.getItem(LS_KOPFGELD_BEZAHLT)!)[`${A}:k1:${B}`]);
});

test("die Oberfläche: einmal bestätigen, nur der Geldgeber, Zweck „kopfgeld“ im Zahlungsbuch", () => {
  const ui = readFileSync(new URL("../src/shell/tabs/kopfgeld-ui.ts", import.meta.url), "utf8");
  assert.match(ui, /if \(!\(await bestaetige\(\{ titel: t\("kopf\.bezahlenTitel"\)/);
  assert.match(ui, /zahle: \(a\) => zahle\(zahlschienen\(\), a\),/);
  assert.match(ui, /await setzeStand\(kg, "erledigt", an, neu\);/);
  const verlauf = readFileSync(new URL("../src/shell/verlauf-ui.ts", import.meta.url), "utf8");
  assert.match(verlauf, /kopfgeld: "verlauf\.zweck\.kopfgeld"/);
});
