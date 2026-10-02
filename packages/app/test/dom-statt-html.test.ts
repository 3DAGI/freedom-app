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
const FERTIG = [
  "shell/tabs/agent-netz.ts", "shell/tabs/earn.ts", "shell/tabs/profil.ts", "shell/tabs/settings.ts", "shell/state.ts",
  "shell/tabs/kommunikation.ts", "shell/tabs/raeume.ts", "shell/tabs/agent.ts",
  "shell/app.ts", "shell/ui.ts", "shell/tresor.ts", "shell/einrichtung-ui.ts",
];

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
  const waehrung = quelle("../src/shell/tabs/tausch.ts");
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

test("C-6b: Settings und RPC-Stand – Gerätenamen, Fehler der Anbieter und Prüfsumme als Text", () => {
  const settings = quelle("../src/shell/tabs/settings.ts");
  assert.match(settings, /zeile\.append\(el\("span", x\.label\), stand\);/);
  assert.match(settings, /knopf\.dataset\.pk = x\.devicePubkey;/);
  assert.match(settings, /el\("span", hash, "mono-sm"\)/);
  assert.doesNotMatch(settings, /escapeHtml/, "nichts mehr zu maskieren");
  const st = quelle("../src/shell/state.ts");
  assert.match(st, /el\("span", `\$\{name\} · \$\{s\.lastError \?\? t\("ein\.keineAntwortRpc"\)\}`, "err"\)/);
});

test("C-6b: Merkphrase, Sicherungs-Warnung und Sprachmenü als DOM", () => {
  const app = quelle("../src/shell/app.ts");
  assert.match(app, /liste\.append\(\.\.\.woerter\.map\(\(w\) => el\("li", w\)\)\);/);
  assert.match(app, /feld\.dataset\.pos = String\(p\);/);
  assert.match(app, /warn\.replaceChildren\(`⚠ \$\{st\.warning\} `, knopf\);/);
  assert.match(app, /const b = el\("button", `\$\{l\.code\.toUpperCase\(\)\} · \$\{l\.label\}`, l\.code === getLang\(\) \? "active" : undefined\);/);
  // Was bleibt, sind feste Vorlagen ohne Fremddaten: der Rahmen des Merkphrasen-Dialogs, Symbole, das Logo
  assert.doesNotMatch(app, /woerter\.map\(\(w\) => `/);
  assert.deepEqual(ausnahmen.filter((z) => z.startsWith("app.ts|")).length, 0);
  const smoke = quelle("../../../scripts/smoke_test.py");
  assert.match(smoke, /erg\["sprachen"\] != \[\["DE · Deutsch", "button", "active"\], \["EN · English", "button", ""\]\]/);
});

test("C-6c: Anhänge aus anhangAnsicht() nur über Eigenschaften und dataset, kein HTML-Baustein mehr", () => {
  const komm = ["kommunikation", "chat-anhaenge", "kontakte", "posteingang"].map((d) => quelle(`../src/shell/tabs/${d}.ts`)).join("\n");
  const rumpf = /function anhangElement\([^]*?\n\}/.exec(komm)?.[0] ?? "";
  assert.match(rumpf, /const v = anhangAnsicht\(a\);/);
  assert.match(rumpf, /Object\.assign\(b\.dataset, v\.daten\);/);
  assert.match(rumpf, /img\.src = v\.url;/);
  assert.match(rumpf, /img\.alt = v\.name;/);
  assert.match(rumpf, /l\.relList\.add\("noopener", "noreferrer"\);/, "fremde Links ohne window.opener");
  assert.doesNotMatch(rumpf, /innerHTML|setAttribute\("on|insertAdjacentHTML/);
  const logik = quelle("../src/shell-logic.ts");
  assert.doesNotMatch(logik, /renderAttachment|<img|<a /, "kein HTML-Baustein für Anhänge");
});

test("C-6c: Chat-Liste, Verlauf und Kanalliste als DOM – Namen, Text und Gerätenamen als Text", () => {
  const komm = ["kommunikation", "chat-anhaenge", "kontakte", "posteingang"].map((d) => quelle(`../src/shell/tabs/${d}.ts`)).join("\n");
  assert.match(komm, /zeile\.append\(el\("span", c\.type === "community" \? "🏠" : c\.name\.slice\(0, 1\)\.toUpperCase\(\), "av"\), el\("span", c\.name, "label"\)\);/);
  assert.match(komm, /const inhalt = el\("div", text, "txt"\);\s*inhalt\.append\(\.\.\.media\);/);
  assert.match(komm, /if \(g\) wer\.append\(" ", el\("span", `· \$\{g\.text\}`/);
  assert.match(komm, /zap\.dataset\.pk = ev\.pubkey;/);
  const raeume = quelle("../src/shell/tabs/raeume.ts");
  assert.match(raeume, /knopf\.append\(el\("span", c\.privacy === "verschluesselt" \? "🔒" : "#", "hash"\), el\("span", c\.name\)\);/);
  assert.match(raeume, /knopf\.setAttribute\("aria-current", String\(c\.id === spacesUi\.channelId\)\);/);
  // Im Browser: eine versiegelte Direktnachricht eines Fremden mit HTML in Name, Text und Anhängen
  const smoke = quelle("../../../scripts/smoke_test.py");
  assert.match(smoke, /erg\["chat"\] != \{"text": html\("text"\), "bild": html\("bild"\)/);
  assert.match(quelle("../../../scripts/fremdtext-probe.mts"), /const dm = await buildPrivateDm\(\{/);
});

test("C-6d1: agent.ts – Modellwahl, Verlauf, Werkzeuge, Fehler und Vorschau als DOM; Symbole nur aus der festen Tabelle", () => {
  const agent = quelle("../src/shell/tabs/agent.ts");
  // Modellwahl: Namen aus fremden Angeboten nur als Text und als Eigenschaft
  assert.match(agent, /b\.dataset\.model = wert;/);
  assert.match(agent, /kopf\.append\(el\("b", name\), tempo\);/);
  assert.match(agent, /btn\.replaceChildren\(iconEl\(symbol, 14\), ` \$\{text\}`\);/);
  // Verlauf, Werkzeuge, Fehler, Hinweis zum Modellwechsel, Vorschau eines Bildes
  assert.match(agent, /b\.append\(el\("span", v\.title, "history-title"\)/);
  assert.match(agent, /el\("span", x\.name, "panel-name"\)/);
  assert.match(agent, /koerper\.append\(el\("b", cause\)\);/);
  assert.match(agent, /innen\.append\(el\("b", newTier\)/);
  assert.match(agent, /bild\.src = attachment\.dataUrl;/);
  assert.doesNotMatch(agent, /\b(pop|btn|box|c|note|status)\.innerHTML/);
  // Die Helfer setzen nur Symbole aus der festen Tabelle
  assert.match(quelle("../src/icons.ts"), /export function iconEl\([^]*?vorlage\.innerHTML = icon\(name, size\);/);
  assert.match(quelle("../src/shell/ui.ts"), /export function haekchenEl\([^]*?svgEl\("path", \{ d: "M5 12l5 5L20 7" \}\)/);
  // Die Liste schrumpft nur – was bleibt, baut C-6d2 um (Blasen, Kosten, Schritte)
  assert.ok(ausnahmen.filter((z) => z.startsWith("agent.ts|")).length <= 12);
  // Im Browser: ein Angebot mit HTML im Modellnamen
  assert.match(quelle("../../../scripts/fremdtext-probe.mts"), /signEvent\(buildCapabilities\(\{/);
  assert.match(quelle("../../../scripts/smoke_test.py"), /if erg\["modellwahl"\] != \[html\("ki"\), 0, True, \[html\("ki"\), 0, True\]\]:/);
});

test("C-6d2: Antworten über markdownDom(), Code-Blöcke, Kosten und Schritte als DOM – renderMarkdown() entfällt", () => {
  const agent = quelle("../src/shell/tabs/agent.ts");
  // Blasen: Modellname vom Provider nur als Text, Antworten nur über antwortDom()
  assert.match(agent, /blase\.append\(el\("div", role === "user" \? t\("komm\.du"\) : `agent\$\{model \? ` · \$\{model\}` : ""\}`, "who"\), koerper\);/);
  assert.match(agent, /koerper\.append\(role === "ai" \? antwortDom\(text\) : text\);/);
  assert.match(agent, /bodyEl\.replaceChildren\(antwortDom\(text\)\);/);
  // Kosten: Werkzeugnamen vom Provider nur als Text; eine Klappe mit richtigem aria-expanded
  assert.match(agent, /karte\.append\(haken\(\), el\("span", w\.name, "tool-name"\)/);
  assert.match(agent, /const zu = koerper\.classList\.toggle\("hidden"\);\n\s*toggle\.setAttribute\("aria-expanded", String\(!zu\)\);/);
  assert.doesNotMatch(agent, /agent\.details|tog\.textContent/, "der Kopf der Klappe bleibt beim Aufklappen");
  // Schritte: Symbole nur aus der festen Tabelle
  assert.match(agent, /ic\.append\(iconEl\(symbol, 12\)\);/);
  // Der Zeichner: markdownDom() mit Umbrüchen, Code nur über textContent
  const antwort = quelle("../src/shell/antwort-ui.ts");
  assert.match(antwort, /markdownDom\(text, "antwort", \{ umbrueche: true \}\)/);
  assert.match(antwort, /codeTeile\(roh\)\.map\(\(s\) => \(s\.art \? el\("span", s\.text, `tok-\$\{s\.art\}`\) : document\.createTextNode\(s\.text\)\)\)/);
  assert.match(antwort, /navigator\.clipboard\.writeText\(roh\)/, "kopiert wird der Code, nicht das Gefärbte");
  assert.doesNotMatch(antwort, /innerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(quelle("../src/shell/ui.ts"), /renderMarkdown|activateCodeBlocks|highlightCode|pendingCodeBlocks/);
  assert.doesNotMatch(quelle("../src/shell/app.ts"), /activateCodeBlocks/);
  // Im Browser: eine Antwort mit HTML und einem Code-Block
  assert.match(quelle("../../../scripts/smoke_test.py"), /if erg\["antwort_md"\] != /);
});

test("C-6e: die letzten Ausnahmen – Logo, Tresor-Dialoge, Einrichtung, Rahmen der Merkphrase – als DOM; die Liste ist leer", () => {
  assert.deepEqual(ausnahmen, [], "keine bewertete Ausnahme mehr");
  const ui = quelle("../src/shell/ui.ts");
  // Eigene Zeichen als SVG-Elemente; das Favicon aus demselben Element
  assert.match(ui, /function svgEl<[^]*?document\.createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", tag\);[^]*?e\.setAttribute\(k, String\(v\)\);/);
  assert.match(ui, /kopf\?\.replaceChildren\(markEl\(18\)\);/);
  assert.match(ui, /const svg = new XMLSerializer\(\)\.serializeToString\(markEl\(64, "#7BC80A"\)\);/);
  assert.doesNotMatch(ui, /markSvg/);
  // Tresor: Felder für die Passphrase mit Namen für Vorleser, Meldungen nur als Text
  const tresor = quelle("../src/shell/tresor.ts");
  assert.match(tresor, /f\.setAttribute\("aria-label", platzhalter\);/);
  assert.match(tresor, /box\.querySelector\("#tr-meldung"\)!\.textContent = text;/);
  assert.doesNotMatch(tresor, /escapeHtml/);
  // Einrichtung und Merkphrase: Aussehen über style (CSSOM), Symbole über iconEl()
  assert.match(quelle("../src/shell/einrichtung-ui.ts"), /b\.style\.cssText = haupt \? HAUPT_STIL : KNOPF_STIL;/);
  const app = quelle("../src/shell/app.ts");
  assert.match(app, /x\.replaceChildren\(iconEl\(x\.dataset\.icon!\)\);/);
  assert.doesNotMatch(app, /escapeHtml/);
  // Im Browser: alle Seiten der Einrichtung, Logo und Favicon
  assert.match(quelle("../../../scripts/smoke_test.py"), /erg\["einrichtung"\] = einrichtung_pruefen\(browser, /);
});
