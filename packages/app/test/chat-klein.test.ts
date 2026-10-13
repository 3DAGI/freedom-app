/**
 * Schritt C-34 (Nutzertest C-3, C-4, C-5, C-9): Kleinigkeiten im Chat. Den Ablauf im Browser
 * prüft der Smoke-Test „chat_klein“.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang, t } from "../src/i18n.js";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const html = quelle("../src/shell/index.html");
const css = quelle("../src/shell/app.css");
const komm = quelle("../src/shell/tabs/kommunikation.ts");

test("ohne gewählte Unterhaltung keine Eingabe und keine Anruf-Knöpfe – von Anfang an und nach jedem Neuzeichnen", () => {
  assert.match(html, /<div class="chat-main ohne-unterhaltung">/, "schon vor dem ersten Zeichnen der Liste");
  assert.match(komm, /classList\.toggle\("ohne-unterhaltung", !conversations\.some\(\(c\) => c\.id === activeConversation\)\)/);
  assert.match(css, /\.chat-main\.ohne-unterhaltung \.chat-composer, \.chat-main\.ohne-unterhaltung \.chat-anruf-knoepfe,\n\.chat-main\.ohne-unterhaltung #chat-voice-status, \.chat-main\.ohne-unterhaltung #chat-attach-list \{ display: none; \}/);
});

test("„⇪ ⇩“ als Text im Menü „⋯“ – die Knöpfe bleiben als Ziel, aber unsichtbar und mit Namen", () => {
  assert.match(html, /<button id="chat-mehr" class="ghost mini" type="button" title="Mehr" aria-label="Mehr" data-i18n-title="komm\.mehr" data-i18n-aria="komm\.mehr">⋯<\/button>/);
  for (const id of ["chat-mesh-export", "chat-mesh-import"]) {
    assert.match(html, new RegExp(`<button id="${id}" class="ghost mini" type="button" hidden aria-label="[^"]+" data-i18n-aria="komm\\.mesh(Export|Import)">`), id);
  }
  assert.match(komm, /\{ text: t\("komm\.meshExport"\), tun: \(\) => document\.getElementById\("chat-mesh-export"\)\?\.click\(\) \}/);
  assert.match(komm, /\{ text: t\("komm\.meshImport"\), tun: \(\) => document\.getElementById\("chat-mesh-import"\)\?\.click\(\) \}/);
  setLang("de");
  assert.equal(t("komm.mehr"), "Mehr");
  setLang("en");
  assert.equal(t("komm.mehr"), "More");
});

test("Nachrichten anderer als Blase, der Zap-Knopf klein – im Agenten bleibt die Antwort ohne Blase", () => {
  assert.match(css, /#chat-thread \.bubble\.ai \{ background: var\(--card\); border: 1px solid var\(--border\);/);
  assert.match(css, /\.bubble\.ai \{ background: transparent; border: none;/, "Agent unverändert");
  assert.match(css, /\.zap-msg-btn \{ width: auto;/, "nicht mehr width: 100 % aus der Grundregel");
  assert.match(css, /@media \(max-width: 1023px\) \{\n  \.chat-anruf-knoepfe button \{ width: 40px; \}\n  \.zap-msg-btn \{ min-width: 40px; \}/, "mobil 40 px (C.5a)");
});

test("Lesefelder im Dialog mehrzeilig – der Sicherheitscode steht ganz da", () => {
  const dlg = quelle("../src/shell/dialog.ts");
  assert.match(dlg, /const e = f\.art === "textarea" \|\| f\.art === "nurlesen" \? el\("textarea"\) : el\("input"\);/);
  assert.match(dlg, /if \(f\.art === "nurlesen"\) \(e as HTMLTextAreaElement\)\.rows = Math\.min\(4, Math\.max\(1, Math\.ceil\(f\.wert\.length \/ 32\)\)\);/);
  assert.match(css, /\.dlg-nurlesen \{ resize: none;/);
  // Zwölf Gruppen zu fünf Ziffern und elf Leerzeichen: drei Zeilen
  assert.equal(Math.min(4, Math.max(1, Math.ceil((12 * 5 + 11) / 32))), 3);
});
