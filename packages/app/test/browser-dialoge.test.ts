/**
 * Schritt C-1 (Sammlung C-1): Browser-Dialoge (`prompt()`, `confirm()`,
 * `alert()`) weichen den Dialogen aus `shell/dialog.ts` – Teil für Teil. Die
 * Liste unten hält fest, wo es sie noch gibt: Sie darf nur schrumpfen, eine
 * neue Stelle fällt hier auf.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ganzeSats } from "../src/shell-logic.js";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
/** Code ohne Kommentare – ein Wort im Kommentar ist kein Aufruf. */
const ohneKommentare = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const BROWSER_DIALOG = /\b(prompt|confirm|alert)\(/g;

function dateien(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? dateien(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []);
}

/** Wo es noch Browser-Dialoge gibt (Datei → Zahl) – C-1b und C-1c leeren den Rest. */
const NOCH_OFFEN: Record<string, number> = {
  "chat-zap.ts": 2,
  "shell/app.ts": 1,
  "shell/bunker.ts": 2,
  "shell/eingebaute-wallet.ts": 1,
  "shell/nachfolge-ui.ts": 2,
  "shell/notfall.ts": 1,
  "shell/offline-zahlung.ts": 4,
  "shell/pruefauftraege-ui.ts": 1,
  "shell/tabs/agent-netz.ts": 6,
  "shell/tabs/agent.ts": 5,
  "shell/tabs/kommunikation.ts": 5,
  "shell/tabs/profil.ts": 3,
  "shell/tabs/settings.ts": 12,
  "shell/zahlkanal-ui.ts": 1,
};

test("C-1: Browser-Dialoge nur noch, wo sie noch nicht umgestellt sind – keine neuen", () => {
  const gefunden: Record<string, number> = {};
  for (const f of dateien(SRC)) {
    const n = ohneKommentare(readFileSync(f, "utf8")).match(BROWSER_DIALOG)?.length ?? 0;
    if (n) gefunden[relative(SRC, f).split("\\").join("/")] = n;
  }
  assert.deepEqual(gefunden, NOCH_OFFEN);
});

test("C-1a: ganze sats aus einem Eingabefeld – nur Ziffern, sonst 0", () => {
  assert.equal(ganzeSats("21000"), 21000);
  assert.equal(ganzeSats("  500 "), 500, "Leerraum am Rand zählt nicht");
  // Was Number() still anders läse als getippt
  for (const v of ["1e3", "0x10", "1.5", "1,5", "-5", "+5", "5 000", "Infinity", "NaN", ""]) assert.equal(ganzeSats(v), 0, v);
  assert.equal(ganzeSats("0"), 0, "null sats tauscht man nicht");
  assert.equal(ganzeSats("0007"), 7);
  assert.equal(ganzeSats("9".repeat(16)), 0, "zu lang");
  assert.equal(ganzeSats("9007199254740993".slice(0, 15)), 900719925474099);
  assert.equal(ganzeSats(undefined), 0);
  assert.equal(ganzeSats(["5"]), 0, "eine Mehrfachwahl ist kein Betrag");
  assert.equal(ganzeSats(5), 0, "nur Text aus dem Feld");
});

test("C-1a: Währung-Tab fragt nur über Dialoge – Beträge, Adresse und Rechnung geprüft im Dialog", () => {
  const w = readFileSync(join(SRC, "shell/tabs/waehrung.ts"), "utf8");
  assert.doesNotMatch(ohneKommentare(w), BROWSER_DIALOG);
  assert.match(w, /import \{ bestaetige, dialog \} from "\.\.\/dialog\.js";/);
  const hin = w.slice(w.indexOf("async function startSwap("), w.indexOf("async function pollSwapResponse("));
  // Betrag: nur ganze sats; Adresse: nur eine Solana-Adresse, Vorschlag bleibt die frische
  assert.match(hin, /pruefe: \(w\) => \(ganzeSats\(w\.betrag\) \? null : t\("waehr\.ungueltigerBetrag"\)\),/);
  assert.match(hin, /const amount = w \? ganzeSats\(w\.betrag\) : 0;\s*if \(!amount\) return;/);
  assert.match(hin, /wert: frisch \?\? solWallet\.pubkey \?\? "", pflicht: true, mono: true/);
  assert.match(hin, /pruefe: \(w\) => \(isValidSolanaAddress\(String\(w\.adresse\)\.trim\(\)\) \? null : t\("waehr\.keineSolAdresse"\)\),/);
  assert.match(hin, /const solAddr = String\(wa\?\.adresse \?\? ""\)\.trim\(\);\s*if \(!solAddr\) return;/, "abgebrochen → kein Tausch");
  // Erst die Warnungen bestätigen, dann die Adresse – wie bisher
  const [warnung, adresse, tresor] = ['titel: t("waehr.bevorTitel")', 'label: t("waehr.empfangsadresse")', "verlangeTresor("].map((x) => hin.indexOf(x));
  assert.ok(warnung > 0 && warnung < adresse && adresse < tresor, "warnen → Adresse → Tresor");

  const rueck = w.slice(w.indexOf("async function startRueckSwap("), w.indexOf("async function warteAufRueckAntwort("));
  assert.match(rueck, /return n < offer\.minSats \|\| n > offer\.maxSats \? t\("waehr\.betragBereich", \{ min: offer\.minSats, max: offer\.maxSats \}\) : null;/, "nur im Rahmen des Angebots");
  assert.match(rueck, /const sats = ws \? ganzeSats\(ws\.sats\) : 0;\s*if \(!sats\) return;/);
  assert.match(rueck, /name: "rechnung", label: t\("waehr\.rechnungFrage", \{ sats \}\), pflicht: true, mono: true/);
  assert.match(rueck, /text: \(warnung \? `\$\{warnung\}\\n\\n` : ""\) \+ t\("waehr\.sperrenFrage"/, "die Kurswarnung steht im selben Dialog");

  // Relayer und Deposit: abgelehnt heißt nichts geschieht
  assert.match(w, /if \(!\(await bestaetige\(\{ titel: t\("waehr\.relayerTitel"\), text: t\("waehr\.relayerFrage", \{ betrag: solText\(teuerster\) \}\), ok: t\("waehr\.einloesen"\) \}\)\)\) return undefined;/);
  assert.match(w, /if \(kursWarnung && !\(await bestaetige\(\{ titel: t\("waehr\.solHinterlegen"\), text: t\("waehr\.trotzdemHinterlegen", \{ warnung: kursWarnung \}\), ok: t\("waehr\.hinterlegenTrotzdem"\) \}\)\)\) return;/);
});
