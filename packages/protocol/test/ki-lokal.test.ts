/**
 * KI auf diesem Gerät (B-1): nur Adressen dieses Rechners, Fremdtext vom
 * Modell geprüft und begrenzt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOKAL_MAX_ANTWORT, LOKAL_MAX_MODELLE, LOKAL_MAX_TOKENS, LOKAL_STANDARD_ADRESSE,
  leseLokaleAntwort, leseLokaleModelle, lokaleKiAdresse, lokaleKiAnfrage, lokaleModellListe,
} from "../src/ki-lokal.js";

test("Adresse: nur dieser Rechner, als Ursprung", () => {
  assert.equal(lokaleKiAdresse(LOKAL_STANDARD_ADRESSE), "http://localhost:11434");
  assert.equal(lokaleKiAdresse(" http://127.0.0.1:8080/v1/irgendwas "), "http://127.0.0.1:8080", "Pfad fällt weg");
  assert.equal(lokaleKiAdresse("http://[::1]:1234"), "http://[::1]:1234");
  assert.equal(lokaleKiAdresse("https://localhost:8443"), "https://localhost:8443");
  assert.equal(lokaleKiAdresse("http://LOCALHOST:11434"), "http://localhost:11434");
});

test("Adresse: Heimnetz, Internet, Zugangsdaten und andere Protokolle werden abgelehnt", () => {
  for (const a of [
    "http://192.168.1.20:11434", "http://10.0.0.5:11434", "https://relay.damus.io", "http://localhost.boese.example",
    "http://boese.example#@localhost", "http://nutzer:pw@localhost:11434", "http://:pw@localhost", "ws://localhost:11434",
    "file:///etc/passwd", "javascript:alert(1)", "", "localhost:11434", "http://0.0.0.0:11434", "http://127.0.0.2:11434",
  ]) {
    assert.equal(lokaleKiAdresse(a), undefined, a);
  }
});

test("Modell-Liste: nur für diesen Rechner", () => {
  assert.equal(lokaleModellListe("http://localhost:11434/"), "http://localhost:11434/v1/models");
  assert.equal(lokaleModellListe("http://192.168.1.2:11434"), undefined);
});

test("Modelle lesen: gültige Namen, ohne Doppelte, begrenzt", () => {
  const modelle = leseLokaleModelle({ data: [{ id: "llama3.2:3b" }, { id: "llama3.2:3b" }, { id: "qwen2.5-coder:7b" }, { id: "<img src=x>" }, { id: 7 }, {}, null, { id: "a".repeat(201) }] });
  assert.deepEqual(modelle, [{ name: "llama3.2:3b" }, { name: "qwen2.5-coder:7b" }]);
  assert.deepEqual(leseLokaleModelle(null), []);
  assert.deepEqual(leseLokaleModelle({ data: "nein" }), []);
  assert.deepEqual(leseLokaleModelle({ models: [{ name: "x" }] }), [], "nur das OpenAI-Format");
  const viele = leseLokaleModelle({ data: Array.from({ length: 80 }, (_, i) => ({ id: `m${i}` })) });
  assert.equal(viele.length, LOKAL_MAX_MODELLE);
});

test("Anfrage: an /v1/chat/completions, ohne Streaming, Tokens begrenzt", () => {
  const a = lokaleKiAnfrage({ adresse: "http://localhost:11434", modell: "llama3.2:3b", frage: "Hallo?" });
  assert.ok(a);
  assert.equal(a.url, "http://localhost:11434/v1/chat/completions");
  const body = JSON.parse(a.body) as { model: string; stream: boolean; max_tokens: number; messages: Array<{ role: string; content: string }> };
  assert.equal(body.model, "llama3.2:3b");
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, LOKAL_MAX_TOKENS);
  assert.deepEqual(body.messages.map((m) => m.role), ["system", "user"]);
  assert.equal(body.messages[1].content, "Hallo?");
  const kurz = lokaleKiAnfrage({ adresse: "http://localhost:11434", modell: "m", frage: "x", maxTokens: 50 });
  assert.equal((JSON.parse(kurz!.body) as { max_tokens: number }).max_tokens, 50);
  const zuviel = lokaleKiAnfrage({ adresse: "http://localhost:11434", modell: "m", frage: "x", maxTokens: 1e9 });
  assert.equal((JSON.parse(zuviel!.body) as { max_tokens: number }).max_tokens, LOKAL_MAX_TOKENS);
});

test("Anfrage: woanders hin, mit ungültigem Modell oder ohne Frage geht nichts hinaus", () => {
  assert.equal(lokaleKiAnfrage({ adresse: "https://api.example", modell: "m", frage: "x" }), undefined);
  assert.equal(lokaleKiAnfrage({ adresse: "http://localhost:11434", modell: "../../x y", frage: "x" }), undefined);
  assert.equal(lokaleKiAnfrage({ adresse: "http://localhost:11434", modell: "m", frage: "" }), undefined);
});

test("Antwort lesen: Text, Modell und Zählwerte geprüft", () => {
  const r = leseLokaleAntwort({ model: "llama3.2:3b", choices: [{ message: { role: "assistant", content: "Antwort" } }], usage: { prompt_tokens: 12, completion_tokens: 34 } });
  assert.deepEqual(r, { text: "Antwort", modell: "llama3.2:3b", promptTokens: 12, completionTokens: 34 });
  const schief = leseLokaleAntwort({ model: "<b>", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: -1, completion_tokens: 1.5 } });
  assert.deepEqual(schief, { text: "ok", promptTokens: 0, completionTokens: 0 }, "fremdes Modell und schiefe Zahlen fallen weg");
  const lang = leseLokaleAntwort({ choices: [{ message: { content: "x".repeat(LOKAL_MAX_ANTWORT + 10) } }] });
  assert.equal(lang?.text.length, LOKAL_MAX_ANTWORT);
  assert.equal(leseLokaleAntwort({ choices: [] }), undefined);
  assert.equal(leseLokaleAntwort({ choices: [{ message: { content: 5 } }] }), undefined);
  assert.equal(leseLokaleAntwort(null), undefined);
});
