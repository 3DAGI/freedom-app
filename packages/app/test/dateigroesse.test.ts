/**
 * Sammlung C-5: große Dateien aufgeteilt – reine Umzüge, keine
 * Verhaltensänderung (je Datei ein Schritt, MENSCH 02.10.2026). Was aufgeteilt
 * ist, bleibt es: Wächst eine Datei über die Grenze, ist das der Anlass, sie
 * weiter zu teilen – nicht, die Grenze zu heben.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lies = (d: string): string => readFileSync(new URL(`../src/${d}`, import.meta.url), "utf8");
const GRENZE = 700;
const AUFGETEILT = [
  "shell/tabs/waehrung.ts", "shell/tabs/tausch.ts", "shell/tabs/hinterlegen.ts",
  "shell/tabs/kommunikation.ts", "shell/tabs/chat-anhaenge.ts", "shell/tabs/kontakte.ts", "shell/tabs/posteingang.ts",
  "shell/tabs/settings.ts", "shell/tabs/sicherung.ts", "shell/tabs/mesh.ts",
  "shell/tabs/agent.ts", "shell/tabs/modellwahl.ts", "shell/tabs/agent-verlauf.ts", "shell/tabs/agent-wege.ts", "shell/tabs/agent-anzeige.ts",
  "shell/tabs/agent-eingabe.ts",
];

test("C-5: aufgeteilte Dateien bleiben unter 700 Zeilen", () => {
  for (const d of AUFGETEILT) {
    const zeilen = lies(d).split("\n").length;
    assert.ok(zeilen <= GRENZE, `${d}: ${zeilen} Zeilen`);
  }
});

test("C-5a: Tausch und Hinterlegen aus ihren eigenen Modulen, der Währung-Tab bleibt Seite, Solana-Wallet und NWC", () => {
  const waehrung = lies("shell/tabs/waehrung.ts");
  for (const fn of ["startSwap", "startRueckSwap", "claimActiveSwap", "startDeposit", "refundDeposit", "geldVorgangLaeuft"]) {
    assert.doesNotMatch(waehrung, new RegExp(`function ${fn}\\(`), `${fn} steht nicht mehr in waehrung.ts`);
  }
  assert.match(waehrung, /import \{ startRueckSwap, startSwap, starteRueckholWaechter \} from "\.\/tausch\.js";/);
  assert.match(lies("shell/tabs/tausch.ts"), /^export async function startSwap\(/m);
  assert.match(lies("shell/tabs/hinterlegen.ts"), /^export async function startDeposit\(/m);
  const app = lies("shell/app.ts");
  assert.match(app, /import \{ claimActiveSwap, exportSwapBackup \} from "\.\/tabs\/tausch\.js";/);
  assert.match(app, /import \{ geldVorgangLaeuft, refundDeposit, startDeposit \} from "\.\/tabs\/hinterlegen\.js";/);
  // Der Tresor sperrt weiter nicht, solange Tausch, Hinterlegen oder Einzahlung laufen
  assert.match(lies("shell/tabs/hinterlegen.ts"), /import \{ activeSwap, sperren, starteRueckholWaechter \} from "\.\/tausch\.js";/);
});

test("C-5b: Anhänge, Kontakte und Posteingang aus ihren eigenen Modulen; der Chat bleibt Liste, Verlauf und Senden", () => {
  const komm = lies("shell/tabs/kommunikation.ts");
  for (const fn of ["handleChatFiles", "oeffneUmschlag", "syncDmInbox", "veroeffentlicheDm", "sichereKontakte", "aktualisiereSchluessel"]) {
    assert.doesNotMatch(komm, new RegExp(`function ${fn}\\(`), `${fn} steht nicht mehr in kommunikation.ts`);
  }
  for (const fn of ["loadChatList", "loadChatMessages", "sendChatMessage", "newDm"]) assert.match(komm, new RegExp(`^export (async )?function ${fn}\\(`, "m"));
  assert.match(lies("shell/tabs/chat-anhaenge.ts"), /^export async function handleChatFiles\(/m);
  assert.match(lies("shell/tabs/posteingang.ts"), /^async function oeffneUmschlag\(/m, "die Kette der Umschläge steht beisammen");
  assert.match(lies("shell/tabs/kontakte.ts"), /^export async function sichereKontakte\(/m);
  // Nur das Anhang-Modul weist die vorgemerkten Anhänge neu zu
  assert.match(komm, /input\.value = "";\s*leereAnhaenge\(\);/);
  assert.match(lies("shell/tabs/chat-anhaenge.ts"), /export function leereAnhaenge\(\): void \{\s*chatAttachments = \[\];\s*\}/);
  assert.doesNotMatch(komm, /chatAttachments = /);
  // Aufrufer anderer Module holen Posteingang und Geräte aus dem neuen Ort
  assert.match(lies("shell/mls-konto.ts"), /\(await import\("\.\/tabs\/posteingang\.js"\)\)\.geraeteBuch/);
  assert.match(lies("shell/app.ts"), /import \{ posteingangAbgleichen \} from "\.\/tabs\/posteingang\.js";/);
});

test("C-5c: Sicherung, Geräte und Mesh aus ihren eigenen Modulen; die Settings bleiben Stand, Nachfolge, Gebühren, Echtheit und Relays", () => {
  const settings = lies("shell/tabs/settings.ts");
  for (const fn of ["zeigeSicherung", "zeigeGeraete", "wireSicherheitsKnoepfe", "wireMeshTab", "sendeUeberFunk", "funkGeraetVerbunden"]) {
    assert.doesNotMatch(settings, new RegExp(`function ${fn}\\(`), `${fn} steht nicht mehr in settings.ts`);
  }
  for (const fn of ["zeigeNachfolge", "aktualisiereSicherheitsStand", "pruefeEigeneEchtheit", "wireGebuehrenKarte"]) assert.match(settings, new RegExp(`^export (async )?function ${fn}\\(`, "m"));
  assert.match(lies("shell/tabs/sicherung.ts"), /^export async function zeigeGeraete\(/m);
  assert.match(lies("shell/tabs/mesh.ts"), /^export async function sendeUeberFunk\(/m);
  // Aufrufer holen den Funk aus dem Mesh-Modul
  assert.match(lies("shell/tabs/agent.ts"), /import \{ funkGeraetVerbunden, sendeUeberFunk \} from "\.\/mesh\.js";/);
  assert.match(lies("shell/offline-zahlung.ts"), /await import\("\.\/tabs\/mesh\.js"\)/);
});

test("C-5d: Modellwahl, Verlauf, Wege, Anzeige und Eingabe aus eigenen Modulen; agent.ts bleibt Frage, Auftrag und Antwort (Konsens seit 04.10.2026 entfernt)", () => {
  const agent = lies("shell/tabs/agent.ts");
  for (const fn of ["refreshModelDropdown", "zeigeVerlaeufe", "askWithFailover", "addAiMessage", "addUsageBubble", "setupAttach"]) {
    assert.doesNotMatch(agent, new RegExp(`function ${fn}\\(`), `${fn} steht nicht mehr in agent.ts`);
  }
  for (const fn of ["askAi", "buildJobEvent", "waitForAnswer", "handleAnswer", "setupFunkAntworten"]) assert.match(agent, new RegExp(`^export (async )?function ${fn}\\(`, "m"));
  // Wer den laufenden Auftrag abbricht oder setzt, steht beim Auftrag selbst – keine fremde Neuzuweisung
  assert.match(agent, /^export let jobAbort: AbortController \| null = null;/m);
  for (const d of ["modellwahl", "agent-verlauf", "agent-wege", "agent-anzeige", "agent-eingabe"]) {
    assert.doesNotMatch(lies(`shell/tabs/${d}.ts`), /\bjobAbort = /, d);
  }
  assert.match(lies("shell/tabs/agent-anzeige.ts"), /^async function reklamiere\(/m, "Reklamation neben der Kosten-Blase, die sie anbietet");
  assert.match(lies("shell/app.ts"), /import \{ askAi, setupFunkAntworten \} from "\.\/tabs\/agent\.js";/);
});

test("04.10.2026: kein „vergleichen“ für Kunden – weder auf der Agent-Seite noch im Code des Agenten", () => {
  assert.doesNotMatch(lies("shell/index.html"), /ai-konsens/);
  for (const d of ["agent", "modellwahl", "agent-verlauf", "agent-wege", "agent-anzeige", "agent-eingabe"]) {
    assert.doesNotMatch(lies(`shell/tabs/${d}.ts`), /konsens|consensus/i, d);
  }
});
