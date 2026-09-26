/**
 * Schritt 8.13: lokale Suche – Index verschluesselt gespeichert, Ablauf
 * beachtet. Abnahme: 10.000 Nachrichten fluessig durchsuchbar, im Speicher
 * nichts im Klartext.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LokaleSuche, type SuchSpeicher, neuerSuchSchluessel, suchSchluessel } from "../src/suche.js";

function speicher(): SuchSpeicher & { blob: string | null } {
  return {
    blob: null,
    async lesen() { return this.blob; },
    async schreiben(b) { this.blob = b; },
    async loeschen() { this.blob = null; },
  };
}

const AUTOR = "a".repeat(64);
const doc = (id: string, text: string, extra: object = {}) => ({ id, text, scope: "chat-1", author: AUTOR, createdAt: 1_790_000_000, ...extra });

test("Rundreise: aufnehmen, verschluesselt speichern, mit dem Schluessel wieder laden", async () => {
  const s = speicher();
  const key = await suchSchluessel(neuerSuchSchluessel());
  const a = new LokaleSuche(s, key, undefined, 60_000);
  a.aufnehmen(doc("1", "Treffen am Bahnhof um sieben"));
  a.aufnehmen(doc("2", "Der Vertrag liegt im Ordner"));
  a.aufnehmen(doc("1", "doppelt – wird nicht zweimal aufgenommen"));
  await a.speichern();
  const b = new LokaleSuche(s, key);
  assert.equal(await b.laden(), 2);
  assert.deepEqual(b.suche("bahnhof sieben").map((h) => h.doc.id), ["1"]);
  assert.deepEqual(b.suche("vertrag").map((h) => h.doc.id), ["2"]);
});

test("Im Speicher steht nichts im Klartext; falscher Schluessel liest nichts", async () => {
  const s = speicher();
  const a = new LokaleSuche(s, await suchSchluessel(neuerSuchSchluessel()), undefined, 60_000);
  a.aufnehmen(doc("x1", "Beratungsstelle Laborbefund Geheimwort"));
  await a.speichern();
  for (const klar of ["Beratungsstelle", "Laborbefund", "Geheimwort", AUTOR, "chat-1"]) {
    assert.ok(!s.blob!.includes(klar), `Klartext im Speicher: ${klar}`);
  }
  await assert.rejects(new LokaleSuche(s, await suchSchluessel(neuerSuchSchluessel())).laden());
  await assert.rejects(suchSchluessel("kurz"), /ungültig/);
});

test("Ablaufende Nachrichten verschwinden auch aus dem Index", async () => {
  const s = speicher();
  const key = await suchSchluessel(neuerSuchSchluessel());
  const uhr = { t: 1_790_000_000 };
  const a = new LokaleSuche(s, key, () => uhr.t, 60_000);
  a.aufnehmen(doc("weg", "vertraulicher Termin", { ablauf: uhr.t + 60 }));
  a.aufnehmen(doc("bleibt", "vertraulicher Plan"));
  a.aufnehmen(doc("schon-weg", "vertraulich abgelaufen", { ablauf: uhr.t - 1 }));
  assert.deepEqual(a.suche("vertraulicher").map((h) => h.doc.id).sort(), ["bleibt", "weg"]);
  await a.speichern();
  uhr.t += 61;
  assert.deepEqual(a.suche("vertraulicher").map((h) => h.doc.id), ["bleibt"]);
  await a.speichern();
  const b = new LokaleSuche(s, key, () => uhr.t);
  assert.equal(await b.laden(), 1);
});

test("Ohne Tresor: Suche im Speicher, nichts wird gespeichert", async () => {
  const a = new LokaleSuche(null, null);
  a.aufnehmen(doc("1", "nur im Speicher"));
  assert.equal(a.suche("speicher").length, 1);
  await a.speichern();
  assert.equal(await a.laden(), 0);
});

test("Vergessen loescht Index und Speicher", async () => {
  const s = speicher();
  const a = new LokaleSuche(s, await suchSchluessel(neuerSuchSchluessel()), undefined, 60_000);
  a.aufnehmen(doc("1", "etwas"));
  await a.speichern();
  await a.vergessen();
  assert.equal(s.blob, null);
  assert.equal(a.anzahl, 0);
});

test("ABNAHME: 10.000 Nachrichten fluessig durchsuchbar, verschluesselt gespeichert", async () => {
  const woerter = ("bahnhof vertrag termin kaffee zug abend morgen treffen projekt rechnung paket arzt schule garten " +
    "regen sonne plan idee frage antwort nachricht gruppe reise ticket hotel essen musik film buch code fehler").split(" ");
  let seed = 7;
  const zufall = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % woerter.length;
  const s = speicher();
  const key = await suchSchluessel(neuerSuchSchluessel());
  const a = new LokaleSuche(s, key, undefined, 60_000);
  let t0 = performance.now();
  for (let i = 0; i < 10_000; i++) {
    const text = Array.from({ length: 12 }, () => woerter[zufall()]).join(" ") + ` nr${i}`;
    a.aufnehmen({ id: `m${i}`, text, scope: `chat-${i % 40}`, author: AUTOR, createdAt: 1_790_000_000 + i });
  }
  const aufbau = performance.now() - t0;
  assert.equal(a.anzahl, 10_000);

  // Tippen: je Anfrage deutlich unter einem Bildschirmbild (16 ms) im Mittel.
  const anfragen = ["bahnhof", "vertrag termin", "zug abend treffen", "nr9999", "kaffee", "reise hotel ticket", "fehler code"];
  t0 = performance.now();
  for (let r = 0; r < 20; r++) for (const q of anfragen) a.suche(q, { limit: 50 });
  const jeSuche = (performance.now() - t0) / (20 * anfragen.length);
  assert.ok(jeSuche < 16, `Suche ${jeSuche.toFixed(1)} ms`);
  assert.deepEqual(a.suche("nr9999").map((h) => h.doc.id), ["m9999"]);

  t0 = performance.now();
  await a.speichern();
  const b = new LokaleSuche(s, key);
  let pausen = 0;
  assert.equal(await b.laden(async () => { pausen++; }), 10_000);
  const laden = performance.now() - t0;
  assert.ok(pausen >= 40, "in Abschnitten aufgebaut – die Oberfläche bleibt bedienbar");
  assert.ok(laden < 5000, `Speichern + Laden ${laden.toFixed(0)} ms`);
  assert.ok(!s.blob!.includes("bahnhof") && !s.blob!.includes(AUTOR), "nichts im Klartext");
  console.log(`# Suche 10.000: Aufbau ${aufbau.toFixed(0)} ms, je Suche ${jeSuche.toFixed(2)} ms, Speichern+Laden ${laden.toFixed(0)} ms`);
});
