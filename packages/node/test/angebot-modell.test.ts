/**
 * Angebotenes Modell = ausgeliefertes Modell (Sammlung B-41, Lauf 2 des lokalen
 * Agenten): Nennt eine Anfrage kein angebotenes Modell, antwortet der Knoten mit
 * dem ersten angebotenen – nicht mit `OLLAMA_MODEL` des Backends. Angeboten wird
 * nur, was Ollama hat (`nurBeiOllama()`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LocalSigner, MemoryRelay, OutboxPool, buildJobRequest, buildPrivateJobRequest, generateKeypair, mitBesitzerNachweis, neueKopplung,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import type { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";
import { nurBeiOllama } from "../src/modell-laden.js";

class MerkBackend implements InferenceBackend {
  modelle: Array<string | undefined> = [];
  name(): string { return "merk"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    this.modelle.push(req.model);
    return { output: "Antwort", model: req.model ?? "standard", promptTokens: 1, completionTokens: 1, durationMs: 1 };
  }
}

test("B-41: ohne Wunsch und mit fremdem Wunsch das erste angebotene Modell, mit angebotenem Wunsch genau das", async () => {
  const relay = new MemoryRelay(`mem://angebot-${Math.random()}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const k = neueKopplung(kp.pk);
  const backend = new MerkBackend();
  // Der Besitzer rechnet gratis (B-8b) – so prüft der Test nur die Modellwahl
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s", privatePowBits: 8,
    besitzer: () => [k.geheimnis], modelle: () => ["qwen3.8:27b", "gemma4:12b"],
  }, pool, backend);
  for (const wunsch of [undefined, "nemotron-3.5-lightning", "gemma4:12b"]) {
    const sitzung = new LocalSigner(generateKeypair().sk);
    const kern = buildJobRequest({
      customerPubkey: sitzung.publicKey(), input: `Frage ${wunsch}`, bidMsat: 0, providerPubkey: kp.pk,
      ...(wunsch ? { params: [["model", wunsch]] } : {}),
    });
    const { wrap } = await buildPrivateJobRequest({ request: mitBesitzerNachweis(kern, k), sessionSigner: sitzung, providerPk: kp.pk, powBits: 8 });
    await pool.publish(wrap);
    assert.equal((await provider.pollOnce()).length, 1);
  }
  assert.deepEqual(backend.modelle, ["qwen3.8:27b", "qwen3.8:27b", "gemma4:12b"],
    "nie das Standardmodell des Backends, das nicht angeboten ist");
});

test("B-41: nur anbieten, was Ollama hat – ohne Tag wie Ollama „:latest“; bliebe nichts, bleibt alles (nie still vom Netz)", () => {
  const ollama = ["qwen3.8:27b", "nemotron-3.5-lightning:latest", "gemma4:12b"];
  assert.deepEqual(nurBeiOllama(["qwen3.8:27b", "nemotron-3.5-lightning", "llama4:70b"], ollama),
    { modelle: ["qwen3.8:27b", "nemotron-3.5-lightning"], fehlen: ["llama4:70b"] });
  assert.deepEqual(nurBeiOllama(["qwen3.8"], ollama), { modelle: ["qwen3.8"], fehlen: ["qwen3.8"] }, "„qwen3.8“ ist nicht „qwen3.8:27b“");
  assert.deepEqual(nurBeiOllama(["a:1", "b:2"], []), { modelle: ["a:1", "b:2"], fehlen: ["a:1", "b:2"] });
  assert.deepEqual(nurBeiOllama([], ollama), { modelle: [], fehlen: [] });
});

test("B-41: Verdrahtung – das Angebot fragt Ollama bei jedem Erneuern, der Provider nimmt sonst das erste angebotene", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const provider = readFileSync(new URL("../src/dvm-provider.ts", import.meta.url), "utf8");
  assert.match(main, /const angebotModelle = \(\) => \(ollamaNamen \? nurBeiOllama\(alleAngebotenen\(\), ollamaNamen\)\.modelle : alleAngebotenen\(\)\)/);
  const angebot = main.slice(main.indexOf("const baueAngebot = async () => {"));
  assert.ok(angebot.indexOf("ollamaNamen = await ollamaTags(ollamaUrl)") < angebot.indexOf("const models = angebotModelle();"), "erst fragen, dann anbieten");
  assert.match(provider, /const requestedModel = modelParam && offeredModels\.includes\(modelParam\) \? modelParam : offeredModels\[0\];/);
});
