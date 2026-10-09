/**
 * Modelle in der Selbstprüfung (Schritt E9-3b, Entwurf E9 V3): je Modell eine
 * Kennung – geprüft, ungeprüft angeboten, verändert, verschwunden, wartend oder
 * warum das Laden scheiterte – und was gerade lädt, im Status an den Besitzer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_DVM_KNOTEN_STATUS, LocalSigner, MemoryRelay, OutboxPool, baueStatusAuftrag, generateKeypair, knotenStatusText, leseKnotenStatus,
  neueKopplung, openPrivateJobResponse, type KnotenStatus,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import type { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";
import type { GeprueftesModell, ModellStand } from "../src/modell-laden.js";
import { MODELL_TEXT, modellFall, modellText, providerModelle, pruefeModelle } from "../src/modell-pruefung.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const geprueft = (name: string, ollama: string): GeprueftesModell =>
  ({ name, manifest: "a".repeat(64), herausgeber: "b".repeat(64), dateien: 4, bytes: 17_000_000_000, ollama, geprueft: 100 });
const leer = (): ModellStand => ({ modelle: [], ergebnisse: [] });
const kurz = (bs: ReturnType<typeof pruefeModelle>) => bs.map((b) => `${b.stufe} ${b.name} ${b.fall}`);

test("E9-3b: geprüft nur mit demselben Fingerabdruck bei Ollama – sonst verändert oder verschwunden", () => {
  const stand: ModellStand = { ...leer(), modelle: [geprueft("qwen3.8:27b", "sha256:aaa"), geprueft("gemma4:12b", "sha256:bbb"), geprueft("mistral:7b", "sha256:ccc")] };
  const ollama = [{ name: "qwen3.8:27b", digest: "sha256:aaa" }, { name: "gemma4:12b", digest: "sha256:anders" }];
  const b = pruefeModelle({ angeboten: ["qwen3.8:27b"], stand, wuensche: [], ollama });
  assert.deepEqual(kurz(b), ["ok qwen3.8:27b modell.geprueft", "fehler gemma4:12b modell.veraendert", "fehler mistral:7b modell.fehltBeiOllama"],
    "ein geprüftes Modell aus PROVIDER_MODELS steht nur einmal da");
  assert.deepEqual(b[0]!.werte, { dateien: 4, bytes: 17_000_000_000 });
  assert.match(b[0]!.text, /4 Dateien, 17 GB/);
});

test("E9-3b: PROVIDER_MODELS sind ungeprüft – fehlt eins bei Ollama, ist es nicht im Angebot; fehlen alle, bleiben sie (B-41) und scheitern", () => {
  const ollama = [{ name: "nemotron-3.5-lightning:latest", digest: "sha256:n" }];
  assert.deepEqual(kurz(pruefeModelle({ angeboten: ["nemotron-3.5-lightning", "llama4:70b"], stand: leer(), wuensche: [], ollama })),
    ["hinweis nemotron-3.5-lightning modell.ungeprueft", "fehler llama4:70b modell.fehltBeiOllama"], "ohne Tag wie Ollama „:latest“");
  assert.deepEqual(kurz(pruefeModelle({ angeboten: ["llama4:70b", "qwen3.8"], stand: leer(), wuensche: [], ollama })),
    ["fehler llama4:70b modell.fehltImAngebot", "fehler qwen3.8 modell.fehltImAngebot"]);
  // Ein geprüftes Modell im Angebot: die übrigen fallen wirklich heraus
  const stand: ModellStand = { ...leer(), modelle: [geprueft("gemma4:12b", "sha256:g")] };
  assert.deepEqual(kurz(pruefeModelle({ angeboten: ["llama4:70b"], stand, wuensche: [], ollama: [{ name: "gemma4:12b", digest: "sha256:g" }] })),
    ["ok gemma4:12b modell.geprueft", "fehler llama4:70b modell.fehltBeiOllama"]);
  assert.deepEqual(kurz(pruefeModelle({ angeboten: ["llama4:70b"], stand, wuensche: [], ollama: null })),
    ["hinweis gemma4:12b modell.ollamaStumm", "hinweis llama4:70b modell.ollamaStumm"], "ohne Antwort von Ollama keine Aussage");
});

test("E9-3b: Wünsche warten, das letzte Scheitern je Name zählt – außer derselbe Name ist wieder gewünscht", () => {
  const stand: ModellStand = {
    modelle: [],
    laeuft: { name: "mistral:7b", schritt: "laden", geladen: 10, gesamt: 100, seit: 50 },
    ergebnisse: [
      { name: "llama4:70b", fall: "passt.nicht", werte: { brauchtGb: 48, hatGb: 32 }, zeit: 10 },
      { name: "gemma4:12b", fall: "manifest.keins", zeit: 10 },
      { name: "phi4:14b", fall: "ok", zeit: 10 },
    ],
  };
  const wuensche = [{ name: "mistral:7b", seit: 50 }, { name: "gemma4:12b", seit: 20 }, { name: "qwen3.8:27b", seit: 30 }];
  const b = pruefeModelle({ angeboten: [], stand, wuensche, ollama: [] });
  assert.deepEqual(kurz(b), [
    "hinweis gemma4:12b modell.wartet", "hinweis qwen3.8:27b modell.wartet", "fehler llama4:70b modell.passtNicht",
  ], "was gerade lädt, steht im Fortschritt; „ok“ ist kein Befund; das alte Scheitern von gemma4 gilt nicht mehr");
  assert.deepEqual(b[2]!.werte, { brauchtGb: 48, hatGb: 32 });
  assert.equal(b[2]!.text, "braucht etwa 48 GB, das Gerät hat 32 GB (MODELL_SPEICHER_GB)");
});

test("E9-3b: jede Kennung, die das Laden liefern kann, hat einen Satz – und `npm run modell` nimmt dieselben", () => {
  const faelle = new Set(["fehler"]);
  for (const datei of ["../src/modell-laden.ts", "../../protocol/src/modell-ollama.ts"]) {
    for (const m of quelle(datei).matchAll(/fall: "([a-z]+\.[a-zA-Z]+)"/g)) faelle.add(m[1]!);
  }
  assert.ok(faelle.size >= 14, `${faelle.size} Kennungen`);
  for (const f of faelle) assert.ok(MODELL_TEXT[modellFall(f)], `${f} → ${modellFall(f)}`);
  assert.equal(modellFall("manifest.keins"), "modell.manifestKeins");
  assert.equal(modellFall("fehler"), "modell.fehler");
  assert.equal(modellText("modell.unbekannt"), "modell.unbekannt", "Unbekanntes nur als Kennung");
  // Jede Kennung aus `pruefeModelle()` steht in der Tabelle
  for (const m of quelle("../src/modell-pruefung.ts").matchAll(/"(modell\.[a-zA-Z]+)"/g)) assert.ok(MODELL_TEXT[m[1]!], m[1]);
  const cli = quelle("../src/modell.ts");
  assert.match(cli, /modellText\(modellFall\(fall\), werte\)/);
  assert.doesNotMatch(cli, /const FALL/, "keine zweite Tabelle");
  assert.deepEqual(providerModelle({ PROVIDER_MODELS: " a:1, b:2 ,a:1,," }), ["a:1", "b:2"]);
  assert.deepEqual(providerModelle({ OLLAMA_MODEL: "c:3" }), ["c:3"]);
});

test("E9-3b: im Status an den Besitzer – alles, was `pruefeModelle()` liefert, kommt unverändert an; Fortschritt dabei", () => {
  const stand: ModellStand = {
    modelle: [geprueft("qwen3.8:27b", "sha256:aaa")],
    laeuft: { name: "mistral:7b", schritt: "laden", geladen: 1_000, gesamt: 4_000, seit: 50 },
    ergebnisse: [
      { name: "llama4:70b", fall: "passt.nicht", werte: { brauchtGb: 48, hatGb: 32 }, zeit: 10 },
      { name: "gemma4:12b", fall: "ollama.laden", werte: { fehler: "OllamaFehler" }, zeit: 10 },
      { name: "phi4:14b", fall: "schicht.fremd", werte: { anzahl: 2 }, zeit: 10 },
      { name: "olmo:7b", fall: "manifest.uneinig", werte: { herausgeber: 2 }, zeit: 10 },
    ],
  };
  const befunde = pruefeModelle({ angeboten: ["nemotron-3.5-lightning"], stand, wuensche: [{ name: "x:1", seit: 60 }], ollama: [{ name: "qwen3.8:27b", digest: "sha256:aaa" }] });
  const status: KnotenStatus = {
    fassung: "0.1.0", seit: 1, rollen: ["ki"], modelle: ["qwen3.8:27b"], auftraege: { erledigt: 0, gratis: 0, abgelehnt: 0 },
    abgerechnetMsat: 0, speicher: null, relay: null,
    modellPruefung: { befunde: befunde.map(({ name, stufe, fall, werte }) => ({ name, stufe, fall, werte: werte ?? {} })), laeuft: stand.laeuft },
  };
  const gelesen = leseKnotenStatus(knotenStatusText(status));
  assert.ok(gelesen);
  assert.deepEqual(gelesen.modellPruefung, status.modellPruefung);
  assert.equal(gelesen.modellPruefung!.befunde.length, befunde.length, "nichts fällt weg");
  assert.ok(!knotenStatusText(status).includes("MODELL_SPEICHER_GB"), "kein Satz, nur Kennungen");
});

test("E9-3b: Verdrahtung – der Status nennt die Modelle, Ollama einmal je Angebot, `npm run pruefen` zeigt sie", () => {
  const main = quelle("../src/main.ts");
  assert.match(main, /modellPruefung: modellPruefung\(\),/);
  assert.match(main, /const befunde = pruefeModelle\(\{ angeboten: providerModelle\(process\.env\), stand, wuensche: leseWuensche\(wunschDatei\(\)\), ollama: ollamaStand \}\);/);
  assert.match(main, /ollamaNamen = await ollamaTags\(ollamaUrl\)\.then\(\(t\) => \(ollamaStand = t\)\.map/, "Namen und Fingerabdrücke aus derselben Antwort");
  assert.match(main, /\.\.\.providerModelle\(process\.env\),\n    \.\.\.gepruefteModelle,/, "Angebot und Status lesen PROVIDER_MODELS gleich");
  assert.match(quelle("../src/dvm-provider.ts"), /"weckSchluessel" \| "modellPruefung">/);
  const pruefen = quelle("../src/pruefen.ts");
  assert.match(pruefen, /pruefeModelle\(\{\n  angeboten: providerModelle\(process\.env\)/);
  assert.match(pruefen, /console\.log\(modellBefundeText\(modelle\)\)/);
});

test("E9-3b: über den Provider – der Besitzer fragt, die Antwort bringt Befunde und Fortschritt mit", async () => {
  const relay = new MemoryRelay(`mem://modell-status-${Math.random()}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const k = neueKopplung(kp.pk);
  const backend: InferenceBackend = {
    name: () => "attrappe", available: async () => true,
    complete: async (_r: InferenceRequest): Promise<InferenceResult> => ({ output: "x", model: "x", promptTokens: 1, completionTokens: 1, durationMs: 1 }),
  };
  const stand: ModellStand = { modelle: [geprueft("qwen3.8:27b", "sha256:aaa")], laeuft: { name: "mistral:7b", schritt: "vorpruefung", seit: 7 }, ergebnisse: [] };
  const befunde = pruefeModelle({ angeboten: ["kaputt\u0007name"], stand, wuensche: [], ollama: [{ name: "qwen3.8:27b", digest: "sha256:aaa" }] });
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s", besitzer: () => [k.geheimnis],
    status: () => ({
      fassung: "0.1.0", seit: 1, rollen: ["ki"], modelle: ["qwen3.8:27b"], relay: null,
      modellPruefung: { befunde: befunde.map(({ name, stufe, fall, werte }) => ({ name, stufe, fall, werte: werte ?? {} })), laeuft: stand.laeuft },
    }),
  }, pool, backend);
  const sitzung = new LocalSigner(generateKeypair().sk);
  const { wrap } = await baueStatusAuftrag({ sitzung, kopplung: k });
  await pool.publish(wrap);
  await provider.pollOnce();
  const offen = await Promise.all((await relay.query({ kinds: [1059], "#p": [sitzung.publicKey()] })).map((w) => openPrivateJobResponse(w, sitzung)));
  const antwort = offen.flatMap((a) => (a.ok ? [a.response] : [])).find((r) => r.kind === KIND_DVM_KNOTEN_STATUS + 1000);
  const gelesen = leseKnotenStatus(antwort!.content);
  assert.ok(gelesen, "lesbar, obwohl ein Name aus der Umgebung ein Steuerzeichen trägt");
  assert.deepEqual(gelesen.modellPruefung, {
    befunde: [{ name: "qwen3.8:27b", stufe: "ok", fall: "modell.geprueft", werte: { dateien: 4, bytes: 17_000_000_000 } }],
    laeuft: { name: "mistral:7b", schritt: "vorpruefung", seit: 7 },
  });
});
