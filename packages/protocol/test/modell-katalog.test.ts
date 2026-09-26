/**
 * Schritt 5.7 mit 8.8: Modellkataloge als NIP-51-Listen – bauen, streng lesen,
 * je Adresse den neuesten nehmen, und zwei Kataloge mit den Angeboten der
 * Provider vergleichen (Anzahl, guenstigster Preis).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent, verifyEvent, type NostrEvent } from "../src/event.js";
import {
  KIND_MODELL_KATALOG, KATALOG_MAX_MODELLE, baueModellKatalog, katalogAdresse, leseKatalogAdresse,
  leseModellKatalog, modellAngebote, neuesteKataloge, vergleicheKataloge,
} from "../src/modell-katalog.js";

const ANNA = generateKeypair();
const BERT = generateKeypair();

function katalog(kp = ANNA, modelle: Array<{ modell: string; notiz?: string }> = [{ modell: "qwen3.5:9b" }], opts: { d?: string; titel?: string; zeit?: number } = {}): NostrEvent {
  return signEvent(baueModellKatalog({ kurator: kp.pk, d: opts.d ?? "code", titel: opts.titel ?? "Zum Programmieren", modelle }, opts.zeit ?? 1_790_000_000), kp.sk);
}

test("5.7: Katalog ist ein NIP-51-Set mit eigenem Kind – bauen und lesen", () => {
  const ev = katalog(ANNA, [{ modell: "qwen3.5:9b", notiz: "schnell, gut fuer Code" }, { modell: "llama3.2:3b" }]);
  assert.equal(ev.kind, KIND_MODELL_KATALOG);
  assert.ok(verifyEvent(ev));
  assert.deepEqual(ev.tags, [["d", "code"], ["title", "Zum Programmieren"], ["model", "qwen3.5:9b", "schnell, gut fuer Code"], ["model", "llama3.2:3b"]]);
  assert.equal(ev.content, "", "oeffentliche Liste – nichts Verstecktes");
  const k = leseModellKatalog(ev);
  assert.deepEqual(k, {
    adresse: `38080:${ANNA.pk}:code`, kurator: ANNA.pk, d: "code", titel: "Zum Programmieren",
    modelle: [{ modell: "qwen3.5:9b", notiz: "schnell, gut fuer Code" }, { modell: "llama3.2:3b" }], createdAt: 1_790_000_000,
  });
  assert.deepEqual(leseKatalogAdresse(k.adresse), { kurator: ANNA.pk, d: "code" });
});

test("5.7: Bauen wirft bei Unbrauchbarem, statt es still zu veroeffentlichen", () => {
  const bau = (o: Partial<Parameters<typeof baueModellKatalog>[0]>) => () => baueModellKatalog({ kurator: ANNA.pk, d: "x", titel: "T", modelle: [], ...o });
  assert.throws(bau({ kurator: "nicht-hex" }), /Kurator/);
  assert.throws(bau({ d: "mit leerzeichen" }), /Kennung/);
  assert.throws(bau({ titel: "  " }), /Titel/);
  assert.throws(bau({ titel: "x".repeat(81) }), /Titel/);
  assert.throws(bau({ beschreibung: "x".repeat(281) }), /Beschreibung/);
  assert.throws(bau({ modelle: [{ modell: "<script>" }] }), /Keine Modell-Kennung/);
  assert.throws(bau({ modelle: [{ modell: "Qwen3.5:9b" }, { modell: "qwen3.5:9b" }] }), /Doppelt/);
  assert.throws(bau({ modelle: [{ modell: "a", notiz: "x".repeat(141) }] }), /Notiz/);
  assert.throws(bau({ modelle: Array.from({ length: KATALOG_MAX_MODELLE + 1 }, (_, i) => ({ modell: `m${i}` })) }), /Höchstens 200/);
  assert.doesNotThrow(bau({ modelle: [] }), "ein leerer Katalog ist erlaubt");
});

test("5.7: fremde Kataloge streng gelesen – Muell faellt weg, Texte gekuerzt, hoechstens 200", () => {
  const roh = (tags: string[][], kind = KIND_MODELL_KATALOG) => signEvent(buildEvent(BERT.pk, kind, tags, "", 1_790_000_000), BERT.sk);
  assert.throws(() => leseModellKatalog(roh([["d", "x"]], 30000)), /kein Modellkatalog/);
  assert.throws(() => leseModellKatalog(roh([["title", "ohne d"]])), /Kennung/);
  const k = leseModellKatalog(roh([
    ["d", "bunt"], ["title", "Ti‮tel\u0000 " + "y".repeat(200)], ["description", "z".repeat(500)],
    ["model", "gut:1b", "n".repeat(300)], ["model", "<img src=x>"], ["model"], ["model", "GUT:1b"], ["p", "x"], ["model", "zweites"],
  ]));
  assert.equal(k.titel.length, 80);
  assert.ok(!/[‮\u0000]/.test(k.titel), "keine Richtungswechsel oder Steuerzeichen");
  assert.equal(k.beschreibung!.length, 280);
  assert.deepEqual(k.modelle.map((m) => m.modell), ["gut:1b", "zweites"], "ungueltige und doppelte (auch in anderer Schreibweise) fallen weg");
  assert.equal(k.modelle[0]!.notiz!.length, 140);
  assert.equal(leseModellKatalog(roh([["d", "leer"]])).titel, "leer", "ohne Titel die Kennung");
  const viele = leseModellKatalog(roh([["d", "viele"], ...Array.from({ length: 300 }, (_, i) => ["model", `m${i}`])]));
  assert.equal(viele.modelle.length, KATALOG_MAX_MODELLE);
  for (const a of [`38080:${"A".repeat(64)}:x`, `30000:${ANNA.pk}:x`, `38080:${ANNA.pk}:mit leer`, "38080::x", "quatsch"]) assert.equal(leseKatalogAdresse(a), null, a);
});

test("5.7: je Adresse gilt der neueste Katalog – bei Gleichstand die kleinere ID", () => {
  const alt = katalog(ANNA, [{ modell: "alt" }], { zeit: 100 });
  const neu = katalog(ANNA, [{ modell: "neu" }], { zeit: 200 });
  const anderer = katalog(ANNA, [{ modell: "anderer" }], { d: "texte", zeit: 50 });
  const bert = katalog(BERT, [{ modell: "b" }], { zeit: 10 });
  const kaputt = { ...katalog(BERT, [{ modell: "x" }], { d: "kaputt" }), kind: 1 };
  const m = neuesteKataloge([neu, alt, anderer, bert, kaputt]);
  assert.deepEqual([...m.keys()].sort(), [katalogAdresse(ANNA.pk, "code"), katalogAdresse(ANNA.pk, "texte"), katalogAdresse(BERT.pk, "code")].sort());
  assert.deepEqual(m.get(katalogAdresse(ANNA.pk, "code"))!.modelle, [{ modell: "neu" }]);
  const [x, y] = [katalog(ANNA, [{ modell: "x" }], { zeit: 300 }), katalog(ANNA, [{ modell: "y" }], { zeit: 300 })];
  const kleiner = x.id < y.id ? "x" : "y";
  assert.equal(neuesteKataloge([x, y]).get(katalogAdresse(ANNA.pk, "code"))!.modelle[0]!.modell, kleiner);
  assert.equal(neuesteKataloge([y, x]).get(katalogAdresse(ANNA.pk, "code"))!.modelle[0]!.modell, kleiner, "unabhaengig von der Reihenfolge");
});

test("8.8: Angebote je Modell – Anzahl der Provider und guenstigster Preis, Schreibweise egal", () => {
  const a = modellAngebote([
    { pubkey: "p1", models: ["qwen3.5:9b", "llama3.2:3b"], textRatePerKTokenMsat: 1500 },
    { pubkey: "p2", models: ["Qwen3.5:9b", "qwen3.5:9b"], textRatePerKTokenMsat: 900 },
    { pubkey: "p3", models: ["qwen3.5:9b"], textRatePerKTokenMsat: Number.NaN },
    { pubkey: "p1", models: ["qwen3.5:9b"], textRatePerKTokenMsat: 2000 },
  ]);
  assert.deepEqual(a.get("qwen3.5:9b"), { provider: 3, preisMsat: 900 }, "p1 zaehlt einmal, ein Preis ohne Zahl zaehlt nicht");
  assert.deepEqual(a.get("llama3.2:3b"), { provider: 1, preisMsat: 1500 });
  assert.equal(a.get("gibtsnicht"), undefined);
});

test("5.7/8.8: zwei Kataloge vergleichen – gemeinsam, nur in einem, mit Angebot und Preis", () => {
  const code = leseModellKatalog(katalog(ANNA, [{ modell: "qwen3.5:9b", notiz: "Annas Wahl" }, { modell: "deepseek-coder:6.7b" }, { modell: "nirgends:1b" }]));
  const text = leseModellKatalog(katalog(BERT, [{ modell: "Qwen3.5:9b" }, { modell: "llama3.2:3b", notiz: "klein" }]));
  const angebote = modellAngebote([
    { pubkey: "p1", models: ["qwen3.5:9b", "llama3.2:3b", "deepseek-coder:6.7b"], textRatePerKTokenMsat: 1500 },
    { pubkey: "p2", models: ["qwen3.5:9b", "llama3.2:3b"], textRatePerKTokenMsat: 1200 },
  ]);
  const v = vergleicheKataloge([code, text], angebote);
  assert.deepEqual(v.zeilen.map((z) => [z.modell, z.in, z.provider, z.preisMsat]), [
    ["qwen3.5:9b", [true, true], 2, 1200],
    ["llama3.2:3b", [false, true], 2, 1200],
    ["deepseek-coder:6.7b", [true, false], 1, 1500],
    ["nirgends:1b", [true, false], 0, undefined],
  ]);
  assert.deepEqual(v.zeilen[0]!.notizen, ["Annas Wahl", undefined]);
  assert.deepEqual(v.gemeinsam, ["qwen3.5:9b"]);
  assert.deepEqual(v.nurIn, [["deepseek-coder:6.7b", "nirgends:1b"], ["llama3.2:3b"]]);
  // Ein Katalog allein: nichts „gemeinsam“, alles „nur in“ ihm.
  const eins = vergleicheKataloge([text], angebote);
  assert.deepEqual([eins.gemeinsam, eins.nurIn], [[], [["llama3.2:3b", "Qwen3.5:9b"]]]);
  assert.deepEqual(vergleicheKataloge([], angebote), { zeilen: [], gemeinsam: [], nurIn: [] });
});
