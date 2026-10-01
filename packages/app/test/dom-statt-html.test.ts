/**
 * innerHTML abbauen (Schritt C-6a, Sammlung C-6): Listen und Zeilen, in denen
 * Fremddaten stehen, entstehen als DOM mit `textContent` – über `el()` aus
 * `shell/ui.ts`. Dateien, die fertig sind, bekommen kein `innerHTML` zurück und
 * keine Zeile in `scripts/innerhtml-ausnahmen.txt`. Im Browser schiebt der
 * Smoke-Test („fremdtext“) HTML durch Einnahme, Modell, Profil und Abzeichen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const ausnahmen = quelle("../../../scripts/innerhtml-ausnahmen.txt").split("\n").filter((z) => z && !z.startsWith("#"));

/** Ohne innerHTML gebaut (C-6a) – die Liste wächst mit jedem Teilschritt. */
const FERTIG = ["shell/tabs/agent-netz.ts", "shell/tabs/earn.ts", "shell/tabs/profil.ts"];

test("C-6a: fertige Dateien ohne innerHTML und ohne Ausnahme", () => {
  for (const d of FERTIG) {
    assert.doesNotMatch(quelle(`../src/${d}`), /innerHTML/, d);
    const name = d.split("/").pop()!;
    assert.deepEqual(ausnahmen.filter((z) => z.startsWith(`${name}|`)), [], `${name}: keine Ausnahme mehr`);
  }
});

test("C-6a: el() setzt Text nur über textContent", () => {
  const ui = quelle("../src/shell/ui.ts");
  const rumpf = /export function el<[^]*?\n\}/.exec(ui)?.[0] ?? "";
  assert.match(rumpf, /if \(text !== undefined\) e\.textContent = text;/);
  assert.match(rumpf, /if \(klasse\) e\.className = klasse;/);
  assert.doesNotMatch(rumpf, /innerHTML|insertAdjacentHTML/);
});

test("C-6a: Fremddaten in Zeilen – Modelle, Einnahmen, Profil, Abzeichen als Text", () => {
  const netz = quelle("../src/shell/tabs/agent-netz.ts");
  assert.match(netz, /el\("span", m\.manifest\.quant \? `\$\{m\.manifest\.name\} · \$\{m\.manifest\.quant\}` : m\.manifest\.name\)/);
  const earn = quelle("../src/shell/tabs/earn.ts");
  assert.match(earn, /el\("span", `\$\{get\("work_type"\)\} · \$\{t\("earn\.einheiten", \{ n: get\("units"\) \}\)\}`, "k"\)/);
  const profil = quelle("../src/shell/tabs/profil.ts");
  assert.match(profil, /const name = el\("h3", gespeichert\.name \|\| pkShort\(state\.keypair\.pk\)\);/);
  assert.match(profil, /const name = el\("span", b\.definition\.name\);/);
  // Das Bild nur als Eigenschaft, nie in einem HTML-Text
  assert.match(profil, /img\.src = bild;/);
  // Stilwerte als Option-Objekte; Layout und Muster aus der festen Auswahl nach normalizeStyle()
  assert.match(profil, /new Option\(STIL\[w\] \? t\(STIL\[w\]!\) : w, w, false, w === aktiv\)/);
  assert.match(profil, /kopf\.classList\.add\(`layout-\$\{stil\.layout\}`\);/);
});

test("C-6a: Befunde der Swap-Prüfung als Textknoten, Zap-Betrag als Wert des Feldes", () => {
  const waehrung = quelle("../src/shell/tabs/waehrung.ts");
  assert.match(waehrung, /statusEl\.replaceChildren\(el\("strong", t\("waehr\.nichtZahlen"\)\), \.\.\.verdict\.problems\.flatMap\(\(p\) => \[document\.createElement\("br"\), document\.createTextNode\(p\)\]\)\);/);
  assert.doesNotMatch(waehrung, /verdict\.problems\.map\(\(p\) => escapeHtml/);
  const zap = quelle("../src/chat-zap.ts");
  assert.doesNotMatch(zap, /value="\$\{state\.amount\}"/);
  assert.match(zap, /\(document\.getElementById\("zap-amount"\) as HTMLInputElement\)\.value = String\(state\.amount\);/);
  assert.equal(ausnahmen.filter((z) => z.startsWith("chat-zap.ts|") || z.startsWith("waehrung.ts|(Zuweisung) verdict")).length, 0);
});

test("C-6a: der Smoke-Test schiebt HTML durch die umgebauten Ansichten", () => {
  const smoke = quelle("../../../scripts/smoke_test.py");
  assert.match(smoke, /erg\["fremdtext"\] = fremdtext_pruefen\(browser,/);
  assert.match(smoke, /and erg\.get\("fremdtext", \{\}\)\.get\("bestanden"\) is True/);
  const probe = quelle("../../../scripts/fremdtext-probe.mts");
  assert.match(probe, /onerror=/, "die Probe trägt ein Skript, das nie laufen darf");
});
