/**
 * Kopplung im Knoten (Sammlung B-8b, L1 A): Das Geheimnis liegt in einer
 * Datei nur für den Knoten, `npm run koppeln` zeigt den Code als QR. Der
 * Besitzer rechnet gratis – nur mit gültigem Nachweis aus einem Umschlag.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIND_DVM_TEXT_GENERATION, LocalSigner, MemoryRelay, OutboxPool, buildEvent, buildJobRequest, buildPrivateJobRequest, generateKeypair,
  kopplungscode, leseKopplungscode, mitBesitzerNachweis, neueKopplung, openPrivateJobResponse, qrCode, signEvent, type Kopplung,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import type { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";
import { erneuereKopplung, kopplungImTerminal, leseKopplung } from "../src/kopplung-datei.js";

class MerkBackend implements InferenceBackend {
  prompts: string[] = [];
  name(): string { return "merk"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    this.prompts.push(JSON.stringify(req));
    return { output: "Antwort", model: "merk", promptTokens: 1, completionTokens: 500, durationMs: 1 };
  }
}

test("B-8b: Datei – nur für den Knoten lesbar, streng gelesen, ein neues Geheimnis ersetzt das alte", () => {
  const knoten = generateKeypair().pk;
  const datei = join(mkdtempSync(join(tmpdir(), "kopplung-")), ".freedom", "kopplung.json");
  assert.equal(leseKopplung(datei, knoten), null, "ohne Datei kein Besitzer");
  const k = erneuereKopplung(datei, knoten);
  assert.equal(statSync(datei).mode & 0o777, 0o600);
  assert.deepEqual(leseKopplung(datei, knoten), k);
  assert.equal(leseKopplung(datei, generateKeypair().pk), null, "nur zum eigenen Schlüssel");
  const neu = erneuereKopplung(datei, knoten);
  assert.notEqual(neu.geheimnis, k.geheimnis);
  assert.deepEqual(leseKopplung(datei, knoten), neu);
  for (const kaputt of ["{", JSON.stringify({ knoten, geheimnis: "kurz" }), JSON.stringify({ knoten })]) {
    writeFileSync(datei, kaputt);
    assert.equal(leseKopplung(datei, knoten), null, kaputt);
  }
});

test("B-8b: der Code als QR fürs Terminal – Ruhezone, zwei Modulzeilen je Zeile, schwarz auf weiß", () => {
  const k: Kopplung = neueKopplung(generateKeypair().pk);
  const qr = qrCode(kopplungscode(k), { stufe: "L" });
  const zeilen = kopplungImTerminal(k).split("\n");
  assert.equal(zeilen.length, Math.ceil((qr.groesse + 8) / 2));
  for (const z of zeilen) {
    assert.ok(z.startsWith("\x1b[30;47m") && z.endsWith("\x1b[0m"));
    assert.equal([...z.slice(8, -4)].length, qr.groesse + 8);
  }
  assert.equal(zeilen[0]!.slice(8, -4).trim(), "", "Ruhezone oben");
  // Zurückgerechnet ergeben die Zeichen genau die Module von qrCode() (dessen Bits prüft protocol/test/qr.test.ts)
  const n = qr.groesse + 8;
  const zurueck: boolean[][] = Array.from({ length: n + (n % 2) }, () => Array<boolean>(n).fill(false));
  zeilen.forEach((z, i) => [...z.slice(8, -4)].forEach((c, x) => {
    zurueck[2 * i]![x] = c === "█" || c === "▀";
    zurueck[2 * i + 1]![x] = c === "█" || c === "▄";
  }));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const innen = x >= 4 && y >= 4 && x < qr.groesse + 4 && y < qr.groesse + 4;
    assert.equal(zurueck[y]![x], innen && qr.module[y - 4]![x - 4]!, `Modul ${x},${y}`);
  }
  assert.deepEqual(leseKopplungscode(kopplungscode(k)), k);
});

function aufbau(geheimnisse: () => readonly string[]) {
  const relay = new MemoryRelay(`mem://kopplung-${Math.random()}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const backend = new MerkBackend();
  // Kein Gratis-Angebot, Mindestgebot gesetzt: ein Fremder ohne Gebot bekommt nichts
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s", privatePowBits: 8, besitzer: geheimnisse,
  }, pool, backend);
  return { relay, pool, kp, backend, provider };
}

async function anfrage(providerPk: string, text: string, k?: Kopplung) {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const kern = buildJobRequest({ customerPubkey: sitzung.publicKey(), input: text, bidMsat: 0, providerPubkey: providerPk });
  const { wrap } = await buildPrivateJobRequest({ request: k ? mitBesitzerNachweis(kern, k) : kern, sessionSigner: sitzung, providerPk, powBits: 8 });
  return { wrap, sitzung };
}

test("B-8b: der Besitzer rechnet gratis – ohne Gebot und ohne Gratis-Angebot; ohne oder mit altem Nachweis nicht", async () => {
  const geheim = { liste: [] as string[] };
  const { relay, pool, kp, backend, provider } = aufbau(() => geheim.liste);
  const k = neueKopplung(kp.pk);
  geheim.liste = [k.geheimnis];
  const { wrap, sitzung } = await anfrage(kp.pk, "Frage des Besitzers", k);
  await pool.publish(wrap);
  const jobs = await provider.pollOnce();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.amountMsat, 0, "gratis");
  assert.ok(backend.prompts.some((p) => p.includes("Frage des Besitzers")));
  const antworten = await Promise.all((await relay.query({ kinds: [1059], "#p": [sitzung.publicKey()] })).map((w) => openPrivateJobResponse(w, sitzung)));
  assert.ok(antworten.some((a) => a.ok && a.response.kind === KIND_DVM_TEXT_GENERATION + 1000), "Antwort versiegelt an die Sitzung");
  // Ohne Nachweis, mit fremdem Geheimnis, nach dem Erneuern: wie jeder Fremde – kein Gebot, keine Arbeit
  const fremd = await anfrage(kp.pk, "ohne Nachweis");
  const falsch = await anfrage(kp.pk, "fremdes Geheimnis", neueKopplung(kp.pk));
  for (const a of [fremd, falsch]) await pool.publish(a.wrap);
  assert.equal((await provider.pollOnce()).length, 0);
  geheim.liste = [neueKopplung(kp.pk).geheimnis];
  await pool.publish((await anfrage(kp.pk, "nach dem Erneuern", k)).wrap);
  assert.equal((await provider.pollOnce()).length, 0, "ein neues Geheimnis widerruft das alte");
  assert.ok(!backend.prompts.some((p) => /ohne Nachweis|fremdes Geheimnis|nach dem Erneuern/.test(p)));
});

test("B-8b: offen nie – eine offene Anfrage mit Nachweis wird abgelehnt, bevor gerechnet wird", async () => {
  const geheim = { liste: [] as string[] };
  const { pool, kp, backend, provider } = aufbau(() => geheim.liste);
  const k = neueKopplung(kp.pk);
  geheim.liste = [k.geheimnis];
  const kunde = generateKeypair();
  // Mit Gebot – ohne Nachweis liefe sie (Gegenprobe), mit Nachweis nie
  const offen = (text: string) => buildEvent(kunde.pk, KIND_DVM_TEXT_GENERATION, [["i", text, "text"], ["bid", "1000"], ["p", kp.pk]], "");
  await pool.publish(signEvent(mitBesitzerNachweis(offen("offen mit Nachweis"), k), kunde.sk));
  assert.equal((await provider.pollOnce()).length, 0);
  assert.equal(backend.prompts.length, 0);
  await pool.publish(signEvent(offen("offen ohne Nachweis"), kunde.sk));
  await provider.pollOnce();
  assert.ok(backend.prompts.some((p) => p.includes("offen ohne Nachweis")), "Gegenprobe: mit Gebot läuft sie");
  assert.ok(!readFileSync(new URL("../src/kopplung-datei.ts", import.meta.url), "utf8").includes("console.log"), "das Geheimnis kommt nie ins Log");
});
