/**
 * VKf (K1): Code zum Eintippen im Knoten. `npm run koppeln -- --code` legt nur die Datei an (0600);
 * der laufende Knoten veröffentlicht das Event, die App findet und liest es, und eingelöst
 * (Statusabfrage mit Nachweis und `kurzcode`), abgelaufen oder ersetzt löscht der Knoten es samt
 * Datei. Ins Log nie Code oder Suchkennung; einlösen kann nur der Besitzer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIND_KURZCODE, KURZCODE_GUELTIG, LocalSigner, MemoryRelay, OutboxPool, baueStatusAuftrag, generateKeypair, getTag,
  kurzcodeAbleitung, leseKurzcodeEvent, neueKopplung, type NostrEvent,
} from "@freedomstack/protocol";
import { kurzcodeDatei, legeKurzcodeAn, leseKurzcodeEintrag } from "../src/kopplung-datei.js";
import { KurzcodeDienst } from "../src/kurzcode-dienst.js";
import { DvmProvider } from "../src/dvm-provider.js";
import type { InferenceBackend } from "../src/inference.js";

const JETZT = 1_790_000_000;

function mitLog<T>(fn: () => Promise<T>): Promise<{ wert: T; log: string }> {
  const zeilen: string[] = [];
  const [log, warn] = [console.log, console.warn];
  console.log = (...a: unknown[]) => { zeilen.push(a.join(" ")); };
  console.warn = (...a: unknown[]) => { zeilen.push(a.join(" ")); };
  return fn().then((wert) => ({ wert, log: zeilen.join("\n") })).finally(() => { console.log = log; console.warn = warn; });
}

test("VKf: Datei des Codes – 0600, gültig zehn Minuten, streng gelesen", () => {
  const datei = kurzcodeDatei(mkdtempSync(join(tmpdir(), "kurzcode-")));
  assert.equal(leseKurzcodeEintrag(datei), null);
  const e = legeKurzcodeAn(datei, JETZT);
  assert.equal(statSync(datei).mode & 0o777, 0o600);
  assert.equal(e.bis, JETZT + KURZCODE_GUELTIG);
  assert.deepEqual(leseKurzcodeEintrag(datei), e);
  writeFileSync(datei, JSON.stringify({ code: "kaputt", bis: JETZT }));
  assert.equal(leseKurzcodeEintrag(datei), null);
  writeFileSync(datei, "{");
  assert.equal(leseKurzcodeEintrag(datei), null);
});

test("VKf: der Knoten veröffentlicht den Code, die App liest ihn; eingelöst, abgelaufen oder ersetzt wird gelöscht", async () => {
  const kp = generateKeypair();
  const k = neueKopplung(kp.pk);
  const datei = kurzcodeDatei(mkdtempSync(join(tmpdir(), "kurzcode-")));
  const draussen: NostrEvent[] = [];
  let uhr = JETZT;
  let gekoppelt = false;
  const dienst = new KurzcodeDienst({
    datei, sk: kp.sk, kopplung: () => (gekoppelt ? k : null), veroeffentliche: async (ev) => { draussen.push(ev); }, jetzt: () => uhr,
  });
  await dienst.takt();
  assert.equal(draussen.length, 0, "ohne Datei nichts");

  const e = legeKurzcodeAn(datei, uhr);
  const { log: ohneKopplung } = await mitLog(() => dienst.takt());
  assert.equal(draussen.length, 0, "ohne Kopplung nichts");
  assert.match(ohneKopplung, /nicht gekoppelt/);

  gekoppelt = true;
  uhr += 30;
  const { log } = await mitLog(async () => { await dienst.takt(); await dienst.takt(); });
  assert.equal(draussen.length, 1, "einmal veröffentlicht");
  const ev = draussen[0]!;
  assert.equal(ev.kind, KIND_KURZCODE);
  assert.equal(getTag(ev, "expiration"), String(e.bis), "läuft mit der Frist aus der Datei ab");
  const ab = await kurzcodeAbleitung(e.code);
  assert.deepEqual(await leseKurzcodeEvent(ev, ab, uhr), k, "die App liest die Kopplung");
  for (const geheim of [e.code, e.code.replace(/-/g, ""), ab.suche, k.geheimnis]) assert.ok(!log.includes(geheim), "nichts davon ins Log");

  // Eingelöst mit einer fremden Kennung: nichts; mit der richtigen: Löschung (NIP-09) und Datei weg
  dienst.eingeloest("ab".repeat(32));
  await dienst.takt();
  assert.equal(draussen.length, 1);
  dienst.eingeloest(ab.suche);
  await mitLog(() => dienst.takt());
  const loeschung = draussen[1]!;
  assert.equal(loeschung.kind, 5);
  assert.deepEqual(loeschung.tags, [["e", ev.id], ["a", `${KIND_KURZCODE}:${kp.pk}:${ab.suche}`], ["k", String(KIND_KURZCODE)]]);
  assert.ok(!existsSync(datei), "der Code verfällt");
  await dienst.takt();
  assert.equal(draussen.length, 2);

  // Abgelaufen: gelöscht, Datei weg
  legeKurzcodeAn(datei, uhr);
  await mitLog(() => dienst.takt());
  assert.equal(draussen.length, 3);
  uhr += KURZCODE_GUELTIG;
  await mitLog(() => dienst.takt());
  assert.equal(draussen[3]!.kind, 5);
  assert.ok(!existsSync(datei));

  // Ein neuer Code ersetzt den alten: der alte wird gelöscht, der neue bleibt und geht im nächsten Takt hinaus
  legeKurzcodeAn(datei, uhr);
  await mitLog(() => dienst.takt());
  const neu = legeKurzcodeAn(datei, uhr);
  await mitLog(() => dienst.takt());
  assert.equal(draussen[5]!.kind, 5);
  assert.ok(existsSync(datei));
  await mitLog(() => dienst.takt());
  assert.equal(getTag(draussen[6]!, "d"), (await kurzcodeAbleitung(neu.code)).suche);
});

const STUMM: InferenceBackend = {
  name: () => "stumm", available: async () => true,
  complete: async () => ({ output: "", model: "stumm", promptTokens: 0, completionTokens: 0, durationMs: 0 }),
};

test("VKf: eingelöst wird nur aus der Statusabfrage des Besitzers", async () => {
  const relay = new MemoryRelay(`mem://kurzcode-${randomBytes(4).toString("hex")}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const k = neueKopplung(kp.pk);
  const eingeloest: string[] = [];
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    besitzer: () => [k.geheimnis], kurzcodeEingeloest: (s) => eingeloest.push(s),
    status: () => ({ fassung: "0.1.0", seit: JETZT, rollen: ["ki"], modelle: ["stumm"], relay: null }),
  }, pool, STUMM);
  const suche = "cd".repeat(32);
  // Mit fremdem Geheimnis: abgelehnt, nichts eingelöst
  await pool.publish((await baueStatusAuftrag({ sitzung: new LocalSigner(generateKeypair().sk), kopplung: neueKopplung(kp.pk), kurzcode: suche })).wrap);
  await provider.pollOnce();
  assert.deepEqual(eingeloest, []);
  await pool.publish((await baueStatusAuftrag({ sitzung: new LocalSigner(generateKeypair().sk), kopplung: k, kurzcode: suche })).wrap);
  assert.equal((await provider.pollOnce()).length, 1);
  assert.deepEqual(eingeloest, [suche]);
});

test("VKf: main.ts – Dienst im Takt, Einlösen aus dem Provider, koppeln --code schreibt nur die Datei", async () => {
  const { readFileSync } = await import("node:fs");
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /new KurzcodeDienst\(\{\s*datei: kurzcodeDatei\(\), sk: keypair\.sk, kopplung: \(\) => leseKopplung\(kopplungOrt, keypair\.pk\), veroeffentliche: \(ev\) => pool\.publish\(ev\),/);
  assert.match(main, /setInterval\(\(\) => void kurzcode\.takt\(\), 5_000\);/);
  assert.match(main, /kurzcodeEingeloest: \(suche\) => \{ kurzcode\.eingeloest\(suche\); void kurzcode\.takt\(\); \},/);
  const koppeln = readFileSync(new URL("../src/koppeln.ts", import.meta.url), "utf8");
  assert.match(koppeln, /legeKurzcodeAn\(kurzcodeDatei\(\), Math\.floor\(Date\.now\(\) \/ 1000\)\)/);
  assert.doesNotMatch(koppeln, /WebSocketRelay|OutboxPool|\.publish\(|torWebSocket/, "verbindet sich mit keinem Relay (Tor, 8.2c)");
});
