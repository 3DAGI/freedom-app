/**
 * Schritt B-27 (Nutzertest 08.10., Befund A-7): Der Systemprompt gilt für jeden
 * Provider – er sagt nur, was stimmt. Kein „GX10“, nur die Werkzeuge der Anfrage
 * (eine Gratis-Antwort hat keine, A-14a), kein erfundener Wissensstand, dafür das
 * heutige Datum.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { OllamaBackend, systemPrompt } from "../src/inference.js";

const HEUTE = new Date(Date.UTC(2026, 9, 9, 8, 0, 0));

test("B-27: kein fester Knoten, kein erfundener Wissensstand, das heutige Datum", () => {
  const p = systemPrompt({ werkzeuge: ["web_search", "image_gen", "video_gen"], heute: HEUTE });
  assert.doesNotMatch(p, /GX10/);
  assert.doesNotMatch(p, /Knowledge-Cutoff|Ende 2024/);
  assert.doesNotMatch(p, /38020/, "Streaming-Sats 38020 gibt es nicht");
  assert.match(p, /Heute ist 2026-10-09\./);
  assert.match(p, /Du hast diese Werkzeuge: web_search, image_gen, video_gen/);
  assert.match(p, /web_search nutzen/);
});

test("B-27: nur die Werkzeuge der Anfrage – ohne keine, ohne Suche kein Hinweis auf die Suche", () => {
  const ohne = systemPrompt({ werkzeuge: [], heute: HEUTE });
  assert.match(ohne, /Du hast fuer diese Anfrage keine Werkzeuge\./);
  assert.doesNotMatch(ohne, /web_search|image_gen|video_gen/);
  assert.match(ohne, /sag das, statt zu raten/);
  const nurBild = systemPrompt({ werkzeuge: ["image_gen"], heute: HEUTE });
  assert.match(nurBild, /Du hast diese Werkzeuge: image_gen /);
  assert.doesNotMatch(nurBild, /web_search|Suchergebnis/);
});

test("B-27: verdrahtet – an Ollama geht der Prompt passend zu den übergebenen Werkzeugen", async () => {
  const gesendet: { messages: { role: string; content: string }[]; tools?: { function: { name: string } }[] }[] = [];
  const altFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    gesendet.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ message: { content: "ok" }, prompt_eval_count: 1, eval_count: 1 }));
  }) as typeof fetch;
  // Das Datum vor und nach dem Aufruf: springt dazwischen der Tag (UTC), gilt jedes von beiden
  const tage = [new Date().toISOString().slice(0, 10)];
  try {
    const backend = new OllamaBackend("http://ollama.test", "testmodell");
    await backend.complete({ jobId: "j1", prompt: "Hallo" });
    await backend.complete({ jobId: "j2", prompt: "Hallo", ohneWerkzeuge: true });
  } finally {
    globalThis.fetch = altFetch;
  }
  tage.push(new Date().toISOString().slice(0, 10));
  const [mit, ohne] = gesendet;
  const sys = (r: (typeof gesendet)[number]) => r.messages.find((m) => m.role === "system")!.content;
  assert.deepEqual(mit!.tools!.map((w) => w.function.name), ["web_search", "image_gen", "video_gen"]);
  assert.match(sys(mit!), /Du hast diese Werkzeuge: web_search, image_gen, video_gen/);
  assert.equal(ohne!.tools, undefined);
  assert.match(sys(ohne!), /keine Werkzeuge/);
  for (const r of gesendet) assert.ok(tage.some((d) => sys(r).includes(`Heute ist ${d}.`)), sys(r));
});
