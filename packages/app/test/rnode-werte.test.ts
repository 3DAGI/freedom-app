/**
 * B-32b4: eigene Funkwerte – nur, was `pruefeFunkParameter()` besteht (je Fall ein Text), gemerkt wie die Vorgabe, und die
 * RNode bekommt genau diese Werte samt Sendezeit-Sperre der Region.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FUNK_FAELLE, FUNK_REGIONEN, pruefeFunkParameter, rnodeOptionen, rnodeSendezeit } from "@freedomstack/protocol";
import { funkWahlText, leseFunkEingabe, leseFunkWahl, verbindeRNode, type FunkWahl } from "../src/rnode-funk.js";
import { CMD, rnodeAttrappe } from "../../protocol/test/rnode-attrappe.js";

const ls = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v),
  removeItem: (k: string) => void ls.delete(k), key: (i: number) => [...ls.keys()][i] ?? null,
  get length() { return ls.size; },
};
const { funkFallText } = await import("../src/shell/rnode-ui.js");
const { setLang } = await import("../src/i18n.js");
const lies = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const eingabe = (o: Partial<Record<"frequenz" | "bandbreite" | "sf" | "cr" | "leistung", string>> = {}) =>
  ({ frequenz: "869.4625", bandbreite: "125000", sf: "10", cr: "6", leistung: "20", ...o });

test("B-32b4: eigene Werte lesen – MHz mit Punkt oder Komma, sonst ganze Zahlen; Kaputtes ergibt null", () => {
  assert.deepEqual(leseFunkEingabe(eingabe()), { frequency: 869_462_500, bandwidth: 125_000, spreadingFactor: 10, codingRate: 6, txPower: 20 });
  assert.equal(leseFunkEingabe(eingabe({ frequenz: " 869,525 " }))!.frequency, 869_525_000);
  assert.equal(leseFunkEingabe(eingabe({ frequenz: "433.050001" }))!.frequency, 433_050_001, "Hz genau, ohne Rundung");
  assert.equal(leseFunkEingabe(eingabe({ frequenz: "869" }))!.frequency, 869_000_000);
  for (const [feld, wert] of [
    ["frequenz", "869.5250001"], ["frequenz", "8,69e2"], ["frequenz", ""], ["frequenz", "869.5x"], ["frequenz", "-869.5"],
    ["bandbreite", "125000.5"], ["bandbreite", ""], ["sf", "8.5"], ["cr", "4/5"], ["leistung", "14.5"], ["leistung", "0x10"], ["leistung", "100"],
  ] as const) {
    assert.equal(leseFunkEingabe(eingabe({ [feld]: wert })), null, `${feld}: ${wert}`);
  }
});

test("B-32b4: nur innerhalb der Grenzen – jede Grenze der Region greift, die Vorgabe ist nur ein Vorschlag", () => {
  const fall = (o: Parameters<typeof eingabe>[0], region = "eu-869") => {
    const p = leseFunkEingabe(eingabe(o));
    assert.ok(p, JSON.stringify(o));
    const r = pruefeFunkParameter(region, p);
    return r.ok ? "ok" : r.fall;
  };
  assert.equal(fall({}), "ok", "869,4625 MHz ± 62,5 kHz liegt genau im Band");
  assert.equal(fall({ frequenz: "869.46" }), "frequenz", "2,5 kHz unter dem Band");
  assert.equal(fall({ frequenz: "869.525", bandbreite: "250000" }), "ok", "250 kHz füllen das Band genau");
  assert.equal(fall({ frequenz: "869.526", bandbreite: "250000" }), "frequenz");
  assert.equal(fall({ bandbreite: "100000" }), "bandbreite");
  assert.equal(fall({ sf: "6" }), "spreizfaktor");
  assert.equal(fall({ cr: "9" }), "kodierrate");
  assert.equal(fall({ leistung: "26" }), "ok", "500 mW e.r.p. – 26 dBm am Ausgang");
  assert.equal(fall({ leistung: "27" }), "leistung");
  assert.equal(fall({ leistung: "-1" }), "leistung");
  assert.equal(fall({ frequenz: "433.775", leistung: "11" }, "eu-433"), "leistung", "10 mW im 433-MHz-Band");
  assert.equal(fall({ frequenz: "869.4625" }, "eu-433"), "frequenz", "Werte einer Region gelten nicht in einer anderen");
  assert.equal(fall({}, "us-915"), "region");
});

test("B-32b4: gemerkt wie die Vorgabe, die RNode bekommt genau die eigenen Werte und die Sperre der Region", async () => {
  const p = leseFunkEingabe(eingabe())!;
  const w: FunkWahl = { region: "eu-869", parameter: p, bestaetigt: 1_790_000_000 };
  assert.deepEqual(leseFunkWahl(funkWahlText(w)), w);
  assert.equal(leseFunkWahl(funkWahlText(w).replace('"txPower":20', '"txPower":27')), null, "von Hand über die Grenze: nicht gemerkt");
  assert.deepEqual(rnodeOptionen(w), { ...p, airtimeLimitLong: 10 });
  const a = rnodeAttrappe();
  const rnode = await verbindeRNode(a.port, w, { postOpenDelayMs: 0, detectTimeout: 2 });
  const zuletzt = (cmd: number) => a.befehle.filter((b) => b.cmd === cmd).at(-1)?.daten;
  assert.deepEqual(zuletzt(CMD.FREQUENZ), [0x33, 0xd2, 0xf1, 0xe4], "869 462 500 Hz = 0x33d2f1e4");
  assert.deepEqual(zuletzt(CMD.SF), [10]);
  assert.deepEqual(zuletzt(CMD.CR), [6]);
  assert.deepEqual(zuletzt(CMD.LEISTUNG), [20]);
  await rnode.disconnect();
  // Mehr Reichweite kostet mehr Sendezeit – das Konto rechnet mit den eigenen Werten
  assert.ok(rnodeSendezeit({ ...p, spreadingFactor: 12, bandwidth: 62_500 }, 200) > 8 * rnodeSendezeit(FUNK_REGIONEN[0]!.vorgabe, 200));
});

test("B-32b4: je Fall der Prüfung ein eigener Text in beiden Sprachen", () => {
  for (const sprache of ["de", "en"] as const) {
    setLang(sprache);
    const texte = FUNK_FAELLE.map((f) => funkFallText(f));
    assert.equal(new Set(texte).size, FUNK_FAELLE.length, `${sprache}: je Fall ein Text`);
    for (const x of texte) assert.doesNotMatch(x, /^set\./, `${sprache}: übersetzt`);
  }
  setLang("en");
});

test("B-32b4: verdrahtet – eigene Werte nur auf Wunsch, nur geprüft, vorbelegt nur aus derselben Region", () => {
  const ui = lies("src/shell/rnode-ui.ts");
  assert.match(ui, /let parameter: FunkParameter = \{ \.\.\.region\.vorgabe \};\n\s+if \(w\?\.werte === "eigene"\) \{/);
  assert.match(ui, /if \(!eigene \|\| !pruefeFunkParameter\(region\.kennung, eigene\)\.ok\) return null;/);
  assert.match(ui, /gemerkt\?\.region === region\.kennung \? gemerkt\.parameter : region\.vorgabe/);
  assert.match(ui, /return r\.ok \? null : funkFallText\(r\.fall\);/, "der Dialog bleibt offen, bis die Werte in den Grenzen liegen");
  assert.match(ui, /LORA_BANDBREITEN\.filter\(\(b\) => b <= region\.bis - region\.von\)/, "nur Bandbreiten, die ins Band passen");
  assert.match(ui, /starteReticulum\(\{\n\s+rnode, identitaet: await reticulumIdentitaet\(geheim\), parameter: wahl\.parameter,/, "Sendezeit mit den gewählten Werten");
});
