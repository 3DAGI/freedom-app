/**
 * Leak-Szenario „KI auf diesem Gerät“ (B-1, Aussage „ki-lokal“): Die Frage
 * geht nur an eine Adresse dieses Rechners. Es entsteht kein Nostr-Event –
 * nichts für ein Relay, nichts für einen Provider, keine Zahlung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { regelKeinKlartextPrompt, type NostrEvent } from "@freedomstack/protocol";
import { frageLokal, lokaleModelle } from "../../src/ki-lokal.js";

const PROMPT = "Wie lese ich meinen Laborbefund?";
const DIESER_RECHNER = new Set(["localhost", "127.0.0.1", "[::1]"]);

test("KI auf diesem Gerät: jeder Abruf geht an diesen Rechner, kein Event entsteht", async () => {
  const abrufe: string[] = [];
  const events: NostrEvent[] = [];
  const holen = async (url: string, init?: RequestInit) => {
    abrufe.push(url);
    // Wer hier ein Event sähe, hätte etwas an ein Relay gegeben
    const body = typeof init?.body === "string" ? init.body : "";
    if (/"kind"\s*:/.test(body)) events.push(JSON.parse(body) as NostrEvent);
    return url.endsWith("/v1/models")
      ? new Response(JSON.stringify({ data: [{ id: "llama3.2:3b" }] }))
      : new Response(JSON.stringify({ choices: [{ message: { content: "Der Wert liegt im Normbereich." } }] }));
  };
  for (const adresse of ["http://localhost:11434", "http://127.0.0.1:8080", "http://[::1]:1234"]) {
    const [m] = await lokaleModelle(adresse, holen);
    await frageLokal({ adresse, modell: m.name, frage: PROMPT, holen });
  }
  assert.equal(abrufe.length, 6);
  assert.deepEqual(abrufe.filter((u) => !DIESER_RECHNER.has(new URL(u).hostname)), []);
  assert.deepEqual(events, []);
  assert.deepEqual(regelKeinKlartextPrompt(events, [PROMPT]), []);
});

test("KI auf diesem Gerät: eine Adresse im Heimnetz oder im Internet bekommt die Frage nie", async () => {
  const abrufe: string[] = [];
  const holen = async (url: string) => { abrufe.push(url); return new Response("{}"); };
  for (const adresse of ["http://192.168.178.20:11434", "https://ki.example", "http://localhost.ki.example"]) {
    await assert.rejects(frageLokal({ adresse, modell: "m", frage: PROMPT, holen }));
    await assert.rejects(lokaleModelle(adresse, holen));
  }
  assert.deepEqual(abrufe, []);
});
