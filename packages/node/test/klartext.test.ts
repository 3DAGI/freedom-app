/**
 * Schritt 3.3 – Abnahme: Nach einem Job steht der Prompt weder im Log noch in
 * einer Datei. Dazu: Der Knoten behaelt ihn (und die Antwort) auch nicht im
 * Speicher – es gibt keinen Gespraechsverlauf mehr, den Kontext bringt die App.
 *
 * Geprueft wird der echte Weg: versiegelte Sitzung, versiegelte Anfrage,
 * `pollOnce()`; dazu `OllamaBackend` mit nachgebautem Ollama (Tool-Runde mit
 * Websuche), weil dort die Log-Zeilen mit Antworttext und Suchanfrage standen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIND_DVM_TEXT_GENERATION, LocalSigner, MemoryRelay, OutboxPool, buildEvent, buildPrivateJobRequest,
  buildPrivateSessionEvent, buildSessionOpen, generateKeypair,
} from "@freedomstack/protocol";
import { DvmProvider, type ProviderConfig } from "../src/dvm-provider.js";
import { OllamaBackend, type InferenceBackend, type InferenceRequest, type InferenceResult } from "../src/inference.js";

const PROMPT = "Mein Laborwert HbA1c ist 9,1 – was bedeutet das?";
const ANTWORT = "Ein HbA1c von 9,1 liegt deutlich ueber dem Zielbereich.";

/** Gibt die Antwort zurueck und merkt sich nichts. */
class StummesBackend implements InferenceBackend {
  anfragen: InferenceRequest[] = [];
  name(): string { return "stumm"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    this.anfragen.push(req);
    return { output: ANTWORT, model: "stumm", promptTokens: 1, completionTokens: 500, durationMs: 1 };
  }
}

/** Alles, was waehrend `fn` auf der Konsole landet. */
async function mitgeschrieben<T>(fn: () => Promise<T>): Promise<{ wert: T; log: string }> {
  const zeilen: string[] = [];
  const arten = ["log", "info", "warn", "error", "debug"] as const;
  const alt = arten.map((a) => console[a]);
  for (const a of arten) console[a] = (...xs: unknown[]) => { zeilen.push(xs.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : String(x))).join(" ")); };
  try {
    return { wert: await fn(), log: zeilen.join("\n") };
  } finally {
    arten.forEach((a, i) => { console[a] = alt[i]; });
  }
}

/** Sucht `text` in allem, was von `wurzel` aus erreichbar ist: Felder, Maps, Sets, Arrays. */
function findeIn(wurzel: unknown, text: string, weg = "provider", gesehen = new WeakSet<object>()): string[] {
  if (typeof wurzel === "string") return wurzel.includes(text) ? [weg] : [];
  if (wurzel === null || typeof wurzel !== "object" || gesehen.has(wurzel)) return [];
  gesehen.add(wurzel);
  if (ArrayBuffer.isView(wurzel)) return [];
  const funde: string[] = [];
  if (wurzel instanceof Map) {
    for (const [k, v] of wurzel) funde.push(...findeIn(k, text, `${weg}.key`, gesehen), ...findeIn(v, text, `${weg}[${String(k).slice(0, 12)}]`, gesehen));
  } else if (wurzel instanceof Set || Array.isArray(wurzel)) {
    let i = 0;
    for (const v of wurzel) funde.push(...findeIn(v, text, `${weg}[${i++}]`, gesehen));
  } else {
    for (const k of Object.getOwnPropertyNames(wurzel)) {
      funde.push(...findeIn((wurzel as Record<string, unknown>)[k], text, `${weg}.${k}`, gesehen));
    }
  }
  return funde;
}

/** Alle Dateien unter `dir` samt Inhalt. */
function dateien(dir: string): Array<{ pfad: string; inhalt: string }> {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => { const pfad = join(d.parentPath, d.name); return { pfad, inhalt: readFileSync(pfad, "utf8") }; });
}

function aufbau(extra: Partial<ProviderConfig> = {}) {
  const relay = new MemoryRelay(`mem://klartext-${Math.random()}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const backend = new StummesBackend();
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    privatePowBits: 8, ...extra,
  }, pool, backend);
  return { pool, kp, backend, provider };
}

/** Versiegelte Sitzung und zwei versiegelte Anfragen darin – wie die App seit 3.2e. */
async function privateSitzungMitAnfragen(pool: OutboxPool, providerPk: string, prompts: string[]): Promise<void> {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const open = buildSessionOpen({
    customerPubkey: sitzung.publicKey(), providerPubkey: providerPk, sessionId: "sess-klartext",
    maxTotalMsat: 100_000, maxRatePerKTokenMsat: 1000, settleEveryMsat: 50_000, ttlSecs: 3600,
  });
  await pool.publish((await buildPrivateSessionEvent({ event: open, sessionSigner: sitzung, providerPk, powBits: 8 })).wrap);
  for (const text of prompts) {
    const request = buildEvent(sitzung.publicKey(), KIND_DVM_TEXT_GENERATION, [["i", text, "text"], ["session", "sess-klartext"], ["p", providerPk]], "");
    await pool.publish((await buildPrivateJobRequest({ request, sessionSigner: sitzung, providerPk, powBits: 8 })).wrap);
  }
}

test("3.3 Abnahme: nach einem Job stehen Prompt und Antwort weder im Log noch in einer Datei noch im Knoten", async () => {
  const dir = mkdtempSync(join(tmpdir(), "klartext-"));
  const cwd = process.cwd();
  const home = process.env.HOME;
  process.chdir(dir);
  process.env.HOME = dir;
  try {
    const { pool, kp, backend, provider } = aufbau();
    await privateSitzungMitAnfragen(pool, kp.pk, [PROMPT]);
    const { wert: jobs, log } = await mitgeschrieben(() => provider.pollOnce());
    assert.equal(jobs.length, 1, "Job lief ueber die versiegelte Sitzung");
    assert.equal(jobs[0].amountMsat, 500);
    assert.ok(backend.anfragen[0].prompt.includes(PROMPT), "das Modell bekam den Prompt");
    for (const t of [PROMPT, ANTWORT, "HbA1c"]) {
      assert.ok(!log.includes(t), `Log enthaelt „${t}“`);
      // Das Test-Backend merkt sich die Anfrage – es gehoert nicht zum Knoten.
      assert.deepEqual(findeIn(provider, t, "provider", new WeakSet<object>([backend])), [], `Knoten haelt „${t}“ noch`);
    }
    assert.equal(jobs[0].outputPreview, "", "keine Vorschau ohne LOG_KLARTEXT");
    // Keine Datei, schon gar keine mit dem Prompt
    assert.deepEqual(dateien(dir).map((d) => d.pfad), []);
  } finally {
    process.chdir(cwd);
    process.env.HOME = home;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("3.3: kein Gespraechsverlauf im Knoten – jede Anfrage steht fuer sich, Kontext kommt in der Anfrage", async () => {
  const { pool, kp, backend, provider } = aufbau();
  const zweite = "[Bisheriger Verlauf]:\nDu: Hallo\nKI: Hallo!\n\n[Neue Nachricht]:\nWas war meine erste Frage?";
  await privateSitzungMitAnfragen(pool, kp.pk, ["Hallo", zweite]);
  await mitgeschrieben(() => provider.pollOnce());
  assert.equal(backend.anfragen.length, 2);
  assert.deepEqual(backend.anfragen.map((a) => a.history), [undefined, undefined], "kein Verlauf vom Knoten");
  // Beide Anfragen tragen dieselbe Sekunde – die Reihenfolge in pollOnce() ist nicht festgelegt.
  assert.deepEqual(backend.anfragen.map((a) => a.prompt).sort(), ["Hallo", zweite].sort(), "der Kontext der App geht unveraendert ans Modell");
});

test("3.3: LOG_KLARTEXT schaltet die Vorschau fuer die Fehlersuche ein – nur dann", async () => {
  const { pool, kp, provider } = aufbau({ klartextProtokoll: true });
  await privateSitzungMitAnfragen(pool, kp.pk, [PROMPT]);
  const { wert: jobs } = await mitgeschrieben(() => provider.pollOnce());
  assert.equal(jobs[0].outputPreview, ANTWORT.slice(0, 120));
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /const klartextProtokoll = process\.env\.LOG_KLARTEXT === "1";/);
  assert.match(main, /privatePowBits,\s*klartextProtokoll,/);
});

test("3.3: OllamaBackend protokolliert weder Antworttext noch Suchanfrage", async () => {
  const frage = "Wie hoch ist mein Kredit bei der Sparkasse Musterstadt?";
  const suche = "Kreditzins Sparkasse Musterstadt";
  const antwort = "Dazu habe ich keine gesicherten Zahlen gefunden.";
  let runde = 0;
  const altFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/api/chat")) {
      runde++;
      const message = runde === 1
        ? { content: "", tool_calls: [{ function: { name: "web_search", arguments: { query: suche } } }] }
        : { content: antwort };
      return new Response(JSON.stringify({ message, prompt_eval_count: 5, eval_count: 7 }));
    }
    // Wie Playwright: Die Fehlermeldung nennt die URL samt Suchanfrage.
    if (url.includes("api.duckduckgo.com")) throw new TypeError(`fetch failed: ${url}`);
    return new Response(`<a class="result__a" href="https://example.org/zins">Zinsen</a>`);
  }) as typeof fetch;
  try {
    const backend = new OllamaBackend("http://ollama.test", "testmodell");
    const { wert, log } = await mitgeschrieben(() => backend.complete({ jobId: "j1", prompt: frage }));
    assert.equal(wert.output, antwort);
    assert.equal(runde, 2, "Tool-Runde lief");
    assert.match(log, /Instant Answer fehlgeschlagen \(TypeError\)/);
    assert.match(log, /finale Antwort \(\d+ Zeichen\)/);
    for (const t of [frage, suche, encodeURIComponent(suche), antwort, "Musterstadt"]) {
      assert.ok(!log.includes(t), `Log enthaelt „${t}“`);
    }
  } finally {
    globalThis.fetch = altFetch;
  }
});

test("3.3: der Job-Pfad schreibt keine Dateien", () => {
  for (const datei of ["dvm-provider.ts", "inference.ts"]) {
    const quelle = readFileSync(new URL(`../src/${datei}`, import.meta.url), "utf8");
    assert.doesNotMatch(quelle, /writeFile|appendFile|createWriteStream|writeSync/, datei);
  }
});
