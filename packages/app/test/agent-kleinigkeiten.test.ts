/**
 * Schritt C-32 (Nutzertest A-3, E-6, A-5, A-6, A-8, N-2): Kleinigkeiten auf der Agent-Seite.
 * Werkzeug-Knöpfe ohne Kurs nur in sats, „erneut“ ohne doppelte Frage, Einzahl bei einer
 * Nachricht, der Name des Tarifs statt seiner Kennung, Markdown schon beim Tippen,
 * „Mein Knoten“ oben in der Modellwahl. Den Ablauf im Browser prüft der Smoke-Test
 * „agent_klein“ (Knöpfe, „erneut“) und „lokal“ (Reihenfolge der Modellwahl).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ausMsat, knopfPreis } from "../src/preis-anzeige.js";
import { werkzeugPreisText } from "../src/werkzeug-preise.js";
import { setLang, t } from "../src/i18n.js";

setLang("de");
const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const anzeige = quelle("../src/shell/tabs/agent-anzeige.ts");
const verlauf = quelle("../src/shell/tabs/agent-verlauf.ts");
const agent = quelle("../src/shell/tabs/agent.ts");
const wahl = quelle("../src/shell/tabs/modellwahl.ts");
const KURS = { satsProSol: 150_000 };

test("Werkzeug-Knopf: ohne Kurs nur sats, die Lücke steht im Tooltip; mit Kurs beide Einheiten", () => {
  assert.equal(knopfPreis(21_000), "21 sats");
  assert.equal(knopfPreis(21_000, KURS, "sats"), ausMsat(21_000, KURS, "sats"));
  assert.equal(knopfPreis(21_000, KURS, "sol"), ausMsat(21_000, KURS, "sol"));
  assert.equal(knopfPreis(-5), "0 sats", "negativ wird 0 wie in ausMsat()");
  assert.match(werkzeugPreisText({ msat: 21_000, angeboten: true }), /kein Kurs/, "der Tooltip sagt weiter, dass der Kurs fehlt");
  assert.match(quelle("../src/shell/tabs/agent-eingabe.ts"), /el\.textContent = preis \? knopfPreis\(preis\.msat, kurs\) : t\("agent\.preisUnbekannt"\);/);
});

test("„erneut“: die alte Frage samt Fehlerblase weicht – auch im gespeicherten Verlauf, sonst ginge sie doppelt mit", () => {
  assert.match(anzeige, /if \(frage instanceof HTMLElement && frage\.classList\.contains\("user"\) && vergissLetzteFrage\(retryPrompt\)\) frage\.remove\(\);\n\s*blase\.remove\(\);/);
  const f = verlauf.slice(verlauf.indexOf("export function vergissLetzteFrage("), verlauf.indexOf("export function zeigeVerlaeufe("));
  // Nur die letzte Nachricht und nur, wenn sie genau diese Frage ist – eine frühere gleiche Frage mit Antwort bleibt
  assert.match(f, /const letzte = aktuellerVerlauf\?\.messages\.at\(-1\);/);
  assert.match(f, /letzte\?\.role !== "user" \|\| letzte\.text !== text\.slice\(0, 20_000\)\) return false;/);
  assert.match(f, /aktuellerVerlauf\.messages\.pop\(\);[^]*speichereVerlaeufe\(alle\);/);
});

test("eine Nachricht heißt „1 Nachricht“ – in der Liste der Verläufe und in der Wechsel-Notiz", () => {
  assert.equal(t("agent.eineNachricht"), "1 Nachricht");
  assert.equal(t("agent.kontextMitEiner"), "der Kontext wird mitgegeben (1 Nachricht)");
  assert.equal(t("agent.nachrichten", { n: 2 }), "2 Nachrichten");
  assert.match(verlauf, /v\.messages\.length === 1 \? t\("agent\.eineNachricht"\) : t\("agent\.nachrichten", \{ n: v\.messages\.length \}\)/);
  assert.match(agent, /msgs\.length === 1 \? t\("agent\.kontextMitEiner"\) : t\("agent\.kontextMit", \{ n: msgs\.length \}\)/);
});

test("Wechsel-Notiz mit dem Namen aus der Wahl, gezählt wird weiter nach der Kennung", () => {
  assert.match(agent, /selectedOptions\[0\]\?\.textContent\?\.split\(" — "\)\[0\]\?\.trim\(\);\n\s*maybeInsertModelSwitchSummary\(selTier, tarifName \|\| selTier\);/);
  assert.match(agent, /if \(lastTier && lastTier !== newTier && pendingContextSummary\)/);
  assert.equal(t("tierFree").split(" — ")[0], "Free");
  setLang("en");
  assert.equal(t("tierFree").split(" — ")[0], "Free");
  setLang("de");
});

test("Tippen zeigt schon Markdown – in Schritten, damit auch lange Antworten bald stehen", () => {
  const f = anzeige.slice(anzeige.indexOf("export function addAiMessageStreaming("), anzeige.indexOf("/** Claude-Stil"));
  assert.match(f, /const schritt = Math\.max\(2, Math\.ceil\(text\.length \/ 200\)\);/);
  assert.match(f, /i = Math\.min\(text\.length, i \+ schritt\);\n\s*bodyEl\.replaceChildren\(antwortDom\(text\.slice\(0, i\)\)\);/);
  assert.doesNotMatch(f, /bodyEl\.textContent = /, "kein roher Text mehr mit „##“ und „**“");
});

test("Modellwahl: „Mein Knoten“ oben, dann „Dieses Gerät“, dann das Netz", () => {
  const knoten = wahl.slice(wahl.indexOf("async function zeigeKnotenBereich("), wahl.indexOf("// ------------------------------------------------ KI auf diesem Gerät"));
  assert.match(knoten, /pop\.prepend\(bereich\);/);
  const lokal = wahl.slice(wahl.indexOf("function zeigeLokalBereich("), wahl.indexOf("/** Modelle auf diesem Rechner suchen"));
  assert.match(lokal, /const knoten = pop\.querySelector\("\.knoten-bereich"\);\n\s*if \(knoten\) knoten\.after\(bereich\); else pop\.prepend\(bereich\);/);
  assert.doesNotMatch(lokal, /pop\.append\(bereich\)/);
});

test("C-46: „Kopieren“ unter jeder Antwort, „Alle kopieren“ im Arbeitsbereich – keine Knopfreihe unter der Eingabe", () => {
  const html = quelle("../src/shell/index.html");
  assert.doesNotMatch(html, /id="copy-last"|class="composer-actions"/);
  assert.match(html, /<h2 class="panel-title" data-i18n="agent\.unterhaltung">Unterhaltung<\/h2>\s*<button id="copy-all"/);
  const geruest = anzeige.slice(anzeige.indexOf("function blasenGeruest("), anzeige.indexOf("\n}\n", anzeige.indexOf("function blasenGeruest(")));
  assert.match(geruest, /if \(role === "ai"\) \{/, "nur unter Antworten, nicht unter den eigenen Fragen");
  assert.match(geruest, /navigator\.clipboard\.writeText\(koerper\.textContent\?\.trim\(\) \?\? ""\)/, "nur der Text, kein HTML");
  assert.match(geruest, /kopieren\.setAttribute\("aria-label", t\("agent\.kopierenAntwort"\)\);/);
});

test("C-46: der Untertitel sagt dasselbe wie das Kontingent; Beispiele ohne Anführungszeichen; kein Text, der wie ein Knopf aussieht", async () => {
  const { GERAET_GRATIS } = await import("../src/gratis-kontingent.js");
  for (const sprache of ["de", "en"] as const) {
    setLang(sprache);
    assert.match(t("emptySub"), new RegExp(`\\b${GERAET_GRATIS.antworten}\\b`), sprache);
    assert.doesNotMatch(t("emptySub"), /^(Stell eine Frage\. Du zahlst pro Anfrage\.|Ask a question\. You pay per request\.)$/);
    for (const k of ["agent.beispiel1", "agent.beispiel2", "agent.beispiel3"]) assert.doesNotMatch(t(k), /[„“”"…]/, `${sprache} ${k}`);
  }
  setLang("de");
  const html = quelle("../src/shell/index.html");
  assert.doesNotMatch(html, /ai-empty-hint|data-i18n="emptyHint"/);
  // „Auto“ ist ein Zustand, keine Hauptaktion: der Modellknopf trägt keine grüne Klasse (Grundform aus C-42b)
  assert.match(html, /<button type="button" id="ai-model-btn" class="tier-select model-btn"/);
});
