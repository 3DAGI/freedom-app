/**
 * Schritt 8.16 (Variante B): Deutsch und Englisch vollständig. Findet
 * fehlende, unbenutzte und rohe Texte. Rohtext zählt in index.html je
 * Bereich und im Code je Datei (`i18n-offen.ts`): fertige stehen auf 0,
 * offene dürfen nur sinken, neue Dateien sind von Anfang an fertig.
 * Fertig: Rahmen (8.16a), Kommunikation (8.16c), Agent-Seite und tabs/agent.ts (8.16d1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { join as pfad, relative } from "node:path";
import { BEREICHE, LANGS, detectLang, gebietsschema, gespeicherteSprache, getLang, setLang, t } from "../src/i18n.js";
import { OFFEN_CODE, OFFEN_HTML } from "./i18n-offen.js";
import { rohtexte, rohtexteImCode } from "./i18n-rohtext.js";

const SRC = new URL("../src/", import.meta.url).pathname;
const html = readFileSync(join(SRC, "shell/index.html"), "utf8");
const dateien = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "texte" ? [] : dateien(join(dir, e.name))) : e.name.endsWith(".ts") && e.name !== "i18n.ts" ? [join(dir, e.name)] : []);
const quellen = dateien(SRC).map((f) => ({ datei: relative(SRC, f), text: readFileSync(f, "utf8") }));
const code = quellen.map((q) => q.text).join("\n");
const alle = Object.assign({}, ...Object.values(BEREICHE)) as Record<string, { de: string; en: string }>;

test("8.16: nur Deutsch und Englisch – jeder Text in beiden, nicht leer, mit denselben Platzhaltern, in genau einem Bereich", () => {
  assert.deepEqual(LANGS.map((l) => l.code), ["de", "en"]);
  const gesehen = new Map<string, string>();
  const platzhalter = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [bereich, texte] of Object.entries(BEREICHE)) {
    for (const [k, v] of Object.entries(texte)) {
      assert.ok(!gesehen.has(k), `${k} in ${bereich} und ${gesehen.get(k)}`);
      gesehen.set(k, bereich);
      assert.deepEqual(Object.keys(v).sort(), ["de", "en"], k);
      assert.ok(v.de.trim() && v.en.trim(), `${k}: leer`);
      assert.deepEqual(platzhalter(v.de), platzhalter(v.en), `${k}: Platzhalter verschieden`);
    }
  }
});

test("8.16: t() – aktuelle Sprache, Werte eingesetzt, Unbekanntes sichtbar; Sprache aus Wahl oder Browser", () => {
  const vorher = getLang();
  try {
    setLang("de");
    assert.equal(t("navComm"), "Kommunikation");
    setLang("en");
    assert.equal(t("navComm"), "Chat");
    assert.equal(t("gibt-es-nicht"), "gibt-es-nicht", "unbekannt → der Schlüssel selbst");
    assert.equal(t("{n} von {m}", { n: 2, m: 5 }), "2 von 5");
    assert.equal(t("{n} und {x}", { n: 1 }), "1 und {x}", "fehlender Wert bleibt sichtbar");
  } finally {
    setLang(vorher);
  }
  assert.equal(detectLang("de-AT"), "de");
  assert.equal(detectLang("DE"), "de");
  assert.equal(detectLang("en-US"), "en");
  assert.equal(detectLang("fr-FR"), "en", "andere Sprachen → Englisch");
  assert.equal(gespeicherteSprache("de"), "de");
  assert.equal(gespeicherteSprache("fr"), null, "bis 8.16 gewählt, gibt es nicht mehr");
  assert.equal(gespeicherteSprache(null), null);
});

test("8.16: Oberfläche – jeder Schlüssel aus index.html und jedes t(…) im Code existiert, jeder Text wird benutzt", () => {
  const ausHtml = [...html.matchAll(/data-(?:i18n(?:-ph|-title|-aria)?|prompt-key)="([^"]+)"/g)].map((m) => m[1]);
  const ausCode = [...code.matchAll(/\bt\(\s*["'`]([\w.-]+)["'`]/g)].map((m) => m[1]);
  assert.ok(ausHtml.length > 30);
  for (const k of [...ausHtml, ...ausCode]) assert.ok(k in alle, `Schlüssel fehlt: ${k}`);
  const benutzt = (k: string) => ausHtml.includes(k) || code.includes(`"${k}"`) || code.includes(`'${k}'`);
  const unbenutzt = Object.keys(alle).filter((k) => !benutzt(k));
  assert.deepEqual(unbenutzt, [], "unbenutzte Texte");
});

test("8.16: Rohtext-Suche – findet Text und Attribute ohne Schlüssel, übersieht Eigennamen und Übersetztes", () => {
  const probe = `<header title="Kopf">FREEDOM <span data-i18n="x">Hallo</span> Offen</header>
    <section id="page-x"><p data-i18n="y">Übersetzt <b>auch innen</b></p><input placeholder="Suche" /><input placeholder="Suche" data-i18n-ph="z" />
    <button aria-label="Schließen" data-i18n-aria="w">×</button><!-- Kommentar zählt nicht --><script>var s = "Code";</script>
    <span>12 sats</span><span>Lightning</span><svg><text>Grafik</text></svg><div>Noch roh</div></section><footer>Fuß</footer>`;
  assert.deepEqual(rohtexte(probe), [
    { bereich: "rahmen", text: 'title="Kopf"' },
    { bereich: "rahmen", text: "Offen" },
    { bereich: "page-x", text: 'placeholder="Suche"' },
    { bereich: "page-x", text: "Noch roh" },
    { bereich: "rahmen", text: "Fuß" },
  ]);
});

test("8.16: kein roher Text in fertigen Bereichen von index.html, in offenen nicht mehr als bisher", () => {
  const je: Record<string, string[]> = {};
  for (const r of rohtexte(html)) (je[r.bereich] ??= []).push(r.text);
  for (const bereich of new Set([...Object.keys(je), ...Object.keys(OFFEN_HTML)])) {
    const gefunden = je[bereich] ?? [];
    assert.ok(bereich in OFFEN_HTML, `neuer Bereich ${bereich}: in OFFEN_HTML eintragen`);
    assert.ok(gefunden.length <= OFFEN_HTML[bereich], `${bereich}: ${gefunden.length} rohe Texte (erlaubt ${OFFEN_HTML[bereich]})${OFFEN_HTML[bereich] === 0 ? `: ${gefunden.join(" | ")}` : ""}`);
  }
});

test("8.16: Rohtext-Suche im Code – findet sichtbaren Text, auch in Vorlagen, übersieht Code und Vermerktes", () => {
  const probe = [
    'toast("Nicht gesendet – kein Relay");',
    'el.textContent = "lade…";',
    'const x = prompt("Raum-Kennung:");',
    'box.innerHTML = `<div class="muted">${items.map((i) => `<b title="Zap senden">${i}</b>`).join("")}</div>`;',
    'const s = `${n} Antwort ·`;',
    'document.querySelector("button span");',
    'localStorage.getItem("freedom.lang");',
    'console.warn("nur für Entwickler");',
    'el.className = "mono-sm muted";',
    'if (e.key === "Enter") senden();',
    'const h = { "Content-Type": "text/html" };',
    'const re = /Nicht gesendet/;',
    '// toast("im Kommentar");',
    'const kanal = { name: "ankündigungen" }; // kein UI-Text',
    'toast(t("komm.erledigt"));',
  ].join("\n");
  assert.deepEqual(rohtexteImCode(probe).map((f) => [f.zeile, f.text]), [
    [1, "Nicht gesendet – kein Relay"],
    [2, "lade…"],
    [3, "Raum-Kennung:"],
    [4, '<b title="Zap senden"> </b>'],
    [5, "  Antwort ·"],
  ]);
});

test("8.16: kein roher Text im Code fertiger und neuer Dateien, in offenen nicht mehr als bisher", () => {
  for (const { datei, text } of quellen) {
    const gefunden = rohtexteImCode(text);
    const erlaubt = OFFEN_CODE[datei] ?? 0;
    assert.ok(gefunden.length <= erlaubt,
      `${datei}: ${gefunden.length} rohe Texte (erlaubt ${erlaubt})${erlaubt === 0 ? `: ${gefunden.map((f) => `${f.zeile}: ${f.text}`).join(" | ")}` : ""}`);
  }
  for (const datei of Object.keys(OFFEN_CODE)) assert.ok(quellen.some((q) => q.datei === datei), `${datei} gibt es nicht mehr – aus OFFEN_CODE streichen`);
});

test("8.16a: Rahmen – Navigation und Kopfzeile über Schlüssel, gespeicherte Sprache geprüft, das nie gezeigte Wallet-Gate ist weg", () => {
  const app = readFileSync(join(SRC, "shell/app.ts"), "utf8");
  assert.match(app, /setLang\(gespeicherteSprache\(localStorage\.getItem\("freedom\.lang"\)\) \?\? detectLang\(\)\);\s*document\.documentElement\.lang = getLang\(\);/);
  assert.match(app, /querySelectorAll\("\[data-i18n-title\]"\)/);
  assert.match(app, /querySelectorAll\("\[data-i18n-aria\]"\)/);
  for (const k of ["navAi", "navComm", "navWallet", "navEarn", "navProfile", "navSettings"]) assert.match(html, new RegExp(`<span data-i18n="${k}">`));
  assert.doesNotMatch(html, /id="gate"|gate-lightning|gate-solana|gate-local/);
  assert.doesNotMatch(app, /#gate/);
});

test("8.16b: Zahlen und Daten im Gebietsschema der Sprache; ein Sprachwechsel zeichnet den offenen Tab neu", () => {
  const vorher = getLang();
  try {
    setLang("en");
    assert.equal(gebietsschema(), "en-US");
    setLang("de");
    assert.equal(gebietsschema(), "de-DE");
  } finally {
    setLang(vorher);
  }
  assert.match(readFileSync(pfad(SRC, "shell/tabs/kommunikation.ts"), "utf8"), /toLocaleTimeString\(gebietsschema\(\), \{/, "Uhrzeit im Raum");
  const app = readFileSync(pfad(SRC, "shell/app.ts"), "utf8");
  assert.match(app, /applyI18n\(\);\s*\/\/[^\n]*\n\s*const offen = document\.querySelector<HTMLElement>\("\.app-nav button\.active"\)\?\.dataset\.tab;\s*if \(offen\) switchTab\(offen\);/);
});

test("8.16c: Kommunikation – Texte über Schlüssel; die Markierung abgelöster Unterhaltungen in beiden Sprachen erkannt", () => {
  const kom = readFileSync(pfad(SRC, "shell/tabs/kommunikation.ts"), "utf8");
  assert.match(kom, /import \{ gebietsschema, t \} from "\.\.\/\.\.\/i18n\.js";/);
  assert.doesNotMatch(kom, /"de-DE"/);
  assert.ok(!("shell/tabs/kommunikation.ts" in OFFEN_CODE) && OFFEN_HTML["page-comm"] === 0, "fertig: Seite und Code auf 0");
  // Die Markierung steht im gespeicherten Namen – eine Unterhaltung aus der anderen Sprache bleibt erkannt
  const marke = /^\((alter Schlüssel|old key)\) /;
  assert.match(kom, /const ALT_MARKE = \/\^\\\(\(alter Schlüssel\|old key\)\\\) \/;/);
  const vorher = getLang();
  try {
    for (const l of ["de", "en"] as const) {
      setLang(l);
      assert.match(t("komm.alterSchluessel", { name: "Ana" }), marke, l);
    }
    setLang("en");
    assert.equal(t("komm.gemeldet", { n: 2 }), "Reported – sealed to 2 moderator(s)");
    setLang("de");
    assert.equal(t("komm.eineAntwort", { n: 1 }), "1 Antwort");
    assert.equal(t("komm.antworten", { n: 3 }), "3 Antworten");
  } finally {
    setLang(vorher);
  }
});

test("8.16d1: Agent – Seite und tabs/agent.ts über Schlüssel; eigene Meldungen nicht umgedeutet, Beispiel-Prompts in der Sprache", () => {
  const ag = readFileSync(pfad(SRC, "shell/tabs/agent.ts"), "utf8");
  assert.ok(!("shell/tabs/agent.ts" in OFFEN_CODE) && OFFEN_HTML["page-ai"] === 0, "fertig: Seite und Code auf 0");
  assert.doesNotMatch(ag, /"de-DE"/);
  // Eigene Meldungen sind schon übersetzt – explainError deutet sie nicht nach deutschen Mustern um
  assert.match(ag, /if \(e instanceof EigeneMeldung\) return e\.message;/);
  assert.match(ag, /if \(\/relay\|websocket\|eose\|pool\/\.test\(m\)\) return t\("agent\.fehlerRelay"\);/);
  // Beispiele: der gesendete Prompt folgt der Sprache, nicht nur die Beschriftung
  assert.match(ag, /const prompt = t\(\(b as HTMLElement\)\.dataset\.promptKey \?\? ""\);/);
  for (const n of [1, 2, 3]) assert.match(html, new RegExp(`data-prompt-key="agent\\.beispiel${n}Prompt"`));
  assert.doesNotMatch(html, /data-prompt="/);
  // Beim Öffnen des Tabs neu gezeichnet – so folgen Verlauf und Budget einem Sprachwechsel
  assert.match(readFileSync(pfad(SRC, "shell/app.ts"), "utf8"), /if \(name === "ai"\) \{ zeigeVerlaeufe\(\); updateBudgetBar\(\);/);
  const vorher = getLang();
  try {
    setLang("en");
    assert.equal(t("agent.beispiel1Prompt"), "Explain the Nostr protocol in one sentence.");
    assert.equal(t("agent.sitzung", { bezahlt: 3, max: 10, pct: 30 }), "session: 3/10 sats (30%)");
  } finally {
    setLang(vorher);
  }
});
