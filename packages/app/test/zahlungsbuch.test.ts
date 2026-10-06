/**
 * Schritt 12.7c: Verlauf – Zahlungsbuch im Tresor und Verlauf der
 * Lightning-Wallet. Nur gemerkt, was über die Zahlschienen ging; streng
 * gelesen; nie in die Sicherung, wohl in den Export.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SICHERUNG_NIE, filtereWiederherstellung, type Beleg } from "@freedomstack/protocol";
import { EXPORT_ZUSAETZLICH, filtereExport } from "../src/datenexport.js";
import { LS_ZAHLUNGEN, ZAHLUNGEN_MAX, leseWalletBuchungen, leseZahlungen, merkeZahlung } from "../src/zahlungsbuch.js";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
function speicher(werte: Record<string, string> = {}) {
  const m = new Map(Object.entries(werte));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v), m };
}
const SOL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb";
const ln = (zeit: number, msat = 21_000): Beleg => ({ rail: "lightning", ziel: "ada@wallet.example", betrag: { einheit: "msat", wert: msat }, ref: "ab".repeat(32), rechnung: "lnbc210n1x", zeit });
const sol = (zeit: number): Beleg => ({ rail: "solana", ziel: SOL, betrag: { einheit: "lamports", wert: 5_000 }, ref: "5".repeat(88), zeit });

test("12.7c: merken – neueste zuerst, mit Zweck; höchstens ZAHLUNGEN_MAX", async () => {
  const s = speicher();
  await merkeZahlung(s, "senden", ln(100));
  await merkeZahlung(s, "trinkgeld", sol(200));
  const z = leseZahlungen(s);
  assert.deepEqual(z.map((x) => [x.zeit, x.rail, x.zweck, x.einheit, x.wert, x.ziel]), [
    [200, "solana", "trinkgeld", "lamports", 5_000, SOL], [100, "lightning", "senden", "msat", 21_000, "ada@wallet.example"],
  ]);
  for (let i = 0; i < ZAHLUNGEN_MAX + 5; i++) await merkeZahlung(s, "job", ln(1_000 + i));
  const voll = leseZahlungen(s);
  assert.equal(voll.length, ZAHLUNGEN_MAX);
  assert.equal(voll[0].zeit, 1_000 + ZAHLUNGEN_MAX + 4, "die ältesten fallen weg");
});

test("12.7c: streng gelesen – Kaputtes und Fremdes fällt weg, nichts wirft", () => {
  const gut = { zeit: 1, rail: "lightning", zweck: "zap", einheit: "msat", wert: 1000, ziel: "x@y.example", ref: "r" };
  const roh = [gut, { ...gut, einheit: "lamports" }, { ...gut, zweck: "geschenk" }, { ...gut, wert: -1 }, { ...gut, wert: 1.5 }, { ...gut, ziel: "" },
    { ...gut, ref: "r".repeat(201) }, { ...gut, rail: "bitcoin" }, null, "x", 3];
  assert.equal(leseZahlungen(speicher({ [LS_ZAHLUNGEN]: JSON.stringify(roh) })).length, 1);
  assert.deepEqual(leseZahlungen(speicher({ [LS_ZAHLUNGEN]: "kein json" })), []);
  assert.deepEqual(leseZahlungen(speicher({ [LS_ZAHLUNGEN]: JSON.stringify({ a: 1 }) })), []);
  assert.deepEqual(leseZahlungen(speicher()), []);
});

test("12.7c: nie in die Sicherung (Relays), wohl in den Export; im Tresor", () => {
  assert.ok(SICHERUNG_NIE.some((r) => r.test(LS_ZAHLUNGEN)));
  assert.deepEqual(filtereWiederherstellung({ [LS_ZAHLUNGEN]: "[]" }), {}, "auch nicht aus einer alten Sicherung zurück");
  assert.ok(EXPORT_ZUSAETZLICH.includes(LS_ZAHLUNGEN));
  assert.deepEqual(filtereExport({ [LS_ZAHLUNGEN]: "[]" }), { [LS_ZAHLUNGEN]: "[]" });
  assert.match(src("../src/shell/tresor.ts"), /"freedom\.zahlungen"/);
});

test("12.7c: Verlauf der Lightning-Wallet – nur, was passt; Text gekürzt; neueste zuerst", () => {
  const antwort = { transactions: [
    { type: "incoming", amount: 21_000, settled_at: 300, description: "Kaffee\n  danke" },
    { type: "outgoing", amount: 5_000, created_at: 200 },
    { type: "incoming", amount: 0, settled_at: 100 }, { type: "seltsam", amount: 1, settled_at: 1 }, { type: "incoming", amount: -5, settled_at: 1 },
    { type: "incoming", amount: 1.5, settled_at: 1 }, { type: "incoming", amount: 7 }, { type: "outgoing", amount: 1000, settled_at: 400, description: "x".repeat(500) },
  ] };
  const b = leseWalletBuchungen(antwort);
  assert.deepEqual(b.map((x) => [x.richtung, x.msat, x.zeit]), [["aus", 1000, 400], ["ein", 21_000, 300], ["aus", 5_000, 200]]);
  assert.equal(b[1].notiz, "Kaffee danke");
  assert.equal(b[0].notiz.length, 80);
  for (const x of [null, undefined, {}, { transactions: "x" }, "x"]) assert.deepEqual(leseWalletBuchungen(x), []);
  assert.equal(leseWalletBuchungen({ transactions: Array.from({ length: 80 }, (_, i) => ({ type: "incoming", amount: 1000, settled_at: i })) }).length, 50);
});

test("12.7c: Verdrahtung – jede Zahlung über die Schienen wird gemerkt, Scheitern beim Merken stoppt die Zahlung nicht", () => {
  const z = src("../src/shell/zahlschienen.ts");
  assert.match(z, /\]\.map\(mitBuch\);/);
  const f = z.slice(z.indexOf("function mitBuch"), z.indexOf("export async function lightningVerlauf"));
  assert.ok(f.indexOf("await zahlen(a)") < f.indexOf("await merkeZahlung(geheim, a.zweck, beleg)"), "erst gezahlt, dann gemerkt");
  assert.match(f, /try \{\s*await merkeZahlung\(geheim, a\.zweck, beleg\);\s*\} catch/);
  assert.match(z, /nwc\.call\("list_transactions", \{ limit: NWC_VERLAUF_MAX \}\)/);
  const ui = src("../src/shell/verlauf-ui.ts");
  assert.doesNotMatch(ui, /innerHTML|localStorage|publish/);
  assert.match(src("../src/shell/tabs/waehrung.ts"), /\n  zeigeZahlungen\(\);\n/);
  assert.match(src("../src/shell/app.ts"), /\n  wireVerlauf\(\);\n/);
});
