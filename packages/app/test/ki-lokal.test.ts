/**
 * KI auf diesem Gerät (B-1): Adresse nur dieser Rechner, Wahlwert, Suche und
 * Frage – mit einer Attrappe statt fetch. Nie still ins Netz.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang } from "../src/i18n.js";
import {
  LS_LOKAL_ADRESSE, LS_LOKAL_AKTIV, frageLokal, lokalAktiv, lokaleAdresse, lokaleModelle, lokalerWahlwert, lokalesModellAus, setzeLokaleAdresse,
} from "../src/ki-lokal.js";

class Speicher {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const antwortJson = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "Content-Type": "application/json" } });

test("B-1: Adresse – Standard, nur dieser Rechner, Fremdes wird nicht gemerkt", () => {
  const s = new Speicher();
  assert.equal(lokaleAdresse(s), "http://localhost:11434");
  assert.equal(setzeLokaleAdresse("http://127.0.0.1:1234/v1", s), "http://127.0.0.1:1234");
  assert.equal(lokaleAdresse(s), "http://127.0.0.1:1234");
  assert.equal(setzeLokaleAdresse("http://192.168.0.10:11434", s), undefined);
  assert.equal(s.getItem(LS_LOKAL_ADRESSE), "http://127.0.0.1:1234", "die fremde Adresse ersetzt nichts");
  s.setItem(LS_LOKAL_ADRESSE, "https://boese.example");
  assert.equal(lokaleAdresse(s), "http://localhost:11434", "von Hand gesetzte fremde Adresse fällt auf den Standard zurück");
  assert.ok(LS_LOKAL_ADRESSE.startsWith("freedom.") && LS_LOKAL_AKTIV.startsWith("freedom."), "Präfix für die Notfall-Löschung");
});

test("B-1: Wahlwert – lokal:<modell> und zurück; Modelle der Provider bleiben, was sie sind", () => {
  assert.equal(lokalerWahlwert("llama3.2:3b"), "lokal:llama3.2:3b");
  assert.equal(lokalesModellAus("lokal:llama3.2:3b"), "llama3.2:3b");
  assert.equal(lokalesModellAus("nemotron-3.5:30b"), undefined);
  assert.equal(lokalesModellAus(""), undefined);
  assert.equal(lokalesModellAus("lokal:"), undefined);
  assert.equal(lokalesModellAus(undefined), undefined);
  const s = new Speicher();
  assert.equal(lokalAktiv(s), false, "gesucht wird erst auf Wunsch");
  s.setItem(LS_LOKAL_AKTIV, "1");
  assert.equal(lokalAktiv(s), true);
});

test("B-1: Modelle suchen – fragt nur /v1/models dieses Rechners, ohne Zugangsdaten", async () => {
  setLang("de");
  const aufrufe: Array<{ url: string; init?: RequestInit }> = [];
  const modelle = await lokaleModelle("http://localhost:11434", async (url, init) => {
    aufrufe.push({ url, init });
    return antwortJson({ data: [{ id: "llama3.2:3b" }, { id: "<script>" }] });
  });
  assert.deepEqual(modelle, [{ name: "llama3.2:3b" }]);
  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0].url, "http://localhost:11434/v1/models");
  assert.equal(aufrufe[0].init?.credentials, "omit");
});

test("B-1: Modelle suchen – nicht erreichbar, HTTP-Fehler, fremde Adresse: klare Meldung, kein Abruf woanders", async () => {
  setLang("de");
  await assert.rejects(lokaleModelle("http://localhost:11434", async () => { throw new TypeError("Failed to fetch"); }), /Unter http:\/\/localhost:11434 antwortet kein Modell/);
  await assert.rejects(lokaleModelle("http://localhost:11434", async () => antwortJson({}, 403)), /HTTP 403/);
  let abgerufen = false;
  await assert.rejects(lokaleModelle("http://192.168.1.5:11434", async () => { abgerufen = true; return antwortJson({ data: [] }); }), /Nur Adressen dieses Rechners/);
  assert.equal(abgerufen, false);
});

test("B-1: Frage – an /v1/chat/completions, Antwort geprüft", async () => {
  setLang("de");
  const aufrufe: Array<{ url: string; body: string }> = [];
  const a = await frageLokal({
    adresse: "http://localhost:11434", modell: "llama3.2:3b", frage: "Was ist Nostr?",
    holen: async (url, init) => {
      aufrufe.push({ url, body: String(init?.body) });
      return antwortJson({ model: "llama3.2:3b", choices: [{ message: { content: "Ein Protokoll." } }], usage: { prompt_tokens: 5, completion_tokens: 3 } });
    },
  });
  assert.deepEqual(a, { text: "Ein Protokoll.", modell: "llama3.2:3b", promptTokens: 5, completionTokens: 3 });
  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0].url, "http://localhost:11434/v1/chat/completions");
  assert.match(aufrufe[0].body, /Was ist Nostr\?/);
});

test("B-1: Frage – Fehler werden Meldungen, nie ein zweiter Weg", async () => {
  setLang("de");
  let n = 0;
  const zaehle = (r: () => Promise<Response>) => async () => { n++; return r(); };
  await assert.rejects(frageLokal({ adresse: "http://localhost:11434", modell: "m", frage: "x", holen: zaehle(async () => { throw new TypeError("x"); }) }), /antwortet kein Modell/);
  await assert.rejects(frageLokal({ adresse: "http://localhost:11434", modell: "m", frage: "x", holen: zaehle(async () => antwortJson({}, 500)) }), /HTTP 500/);
  await assert.rejects(frageLokal({ adresse: "http://localhost:11434", modell: "m", frage: "x", holen: zaehle(async () => antwortJson({ choices: [] })) }), /keine Antwort/);
  assert.equal(n, 3, "je Frage genau ein Abruf – kein Wiederholen, kein Ausweichen");
  await assert.rejects(frageLokal({ adresse: "https://api.example", modell: "m", frage: "x", holen: zaehle(async () => antwortJson({})) }), /Nur Adressen dieses Rechners/);
  assert.equal(n, 3, "fremde Adresse: nichts geht hinaus");
});

test("B-1: Frage – Stopp bricht ab, zu lange heißt Zeit abgelaufen", async () => {
  setLang("de");
  const wartet = (_u: string, init?: RequestInit) => new Promise<Response>((_, fail) => {
    init?.signal?.addEventListener("abort", () => fail(new DOMException("abgebrochen", "AbortError")));
  });
  const stopp = new AbortController();
  const laeuft = frageLokal({ adresse: "http://localhost:11434", modell: "m", frage: "x", signal: stopp.signal, holen: wartet });
  stopp.abort();
  await assert.rejects(laeuft, /Abgebrochen/);
  // AbortSignal.timeout hält in Node die Ereignisschleife nicht offen – im Browser läuft sie ohnehin
  const offen = setTimeout(() => {}, 1000);
  await assert.rejects(frageLokal({ adresse: "http://localhost:11434", modell: "m", frage: "x", holen: wartet, zeitMs: 20 }), /länger als drei Minuten/);
  clearTimeout(offen);
});

test("B-1: verdrahtet – askAi fragt „Dieses Gerät“ nach dem gewählten Funk, vor Kontingent und Netz; die Wahl zeigt den Bereich immer", () => {
  const src = ["agent", "modellwahl", "agent-verlauf", "agent-wege", "agent-anzeige", "agent-eingabe"].map((d) => readFileSync(new URL(`../src/shell/tabs/${d}.ts`, import.meta.url), "utf8")).join("\n");
  const ask = src.slice(src.indexOf("export async function askAi("), src.indexOf("function maybeInsertModelSwitchSummary(")); // seit C-5d folgt askWithFailover in agent-wege.ts
  const lokal = ask.indexOf("await frageAufDiesemGeraet(prompt, lokalModell, btn);");
  assert.ok(lokal > 0, "askAi ruft frageAufDiesemGeraet");
  assert.ok(lokal > ask.indexOf("await frageUeberFunk("), "ein ausdrücklich gewählter Funk geht vor");
  assert.ok(lokal < ask.indexOf("if (quotaExhausted)"), "vor dem Kontingent – das Gerät kostet nichts");
  assert.ok(lokal < ask.indexOf("await askWithFailover("), "vor dem Netz");
  assert.match(ask.slice(lokal, lokal + 80), /\n\s*return;/, "danach geht nichts ins Netz");
  const fn = src.slice(src.indexOf("async function frageAufDiesemGeraet("), src.indexOf("async function frageAufDiesemGeraet(") + 1600);
  assert.match(fn, /await frageLokal\(\{ adresse: lokaleAdresse\(localStorage\), modell, frage, signal: jobAbort\.signal \}\)/);
  for (const netz of ["ensurePool", "publish(", "buildJobEvent", "zahle", "kiSitzungen"]) assert.ok(!fn.includes(netz), `kein ${netz} im lokalen Weg`);
  assert.match(src, /\} finally \{\n\s*zeigeLokalBereich\(\);/, "auch ohne Netz steht „Dieses Gerät“ in der Wahl");
});
