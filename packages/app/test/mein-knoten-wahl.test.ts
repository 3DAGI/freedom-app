/**
 * Mein Knoten in der Modellwahl (B-9a): Wer gekoppelt ist (B-8c), wählt
 * „Mein Knoten“ – die Frage geht dann nur an diesen Knoten, gratis mit
 * Nachweis, ohne Kontingent und ohne Ausweichen auf andere Provider.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KNOTEN_PRAEFIX, knotenModellAus, knotenWahlwert } from "../src/knoten-wahl.js";
import { lokalesModellAus, lokalerWahlwert } from "../src/ki-lokal.js";

const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const agent = lies("shell/tabs/agent.ts");
const teil = (von: string, bis: string) => agent.slice(agent.indexOf(von), agent.indexOf(bis, agent.indexOf(von) + von.length));

test("B-9a: Wahlwert – knoten:<modell>, leer heißt das Modell des Knotens; nie mit Netz oder Gerät verwechselt", () => {
  assert.equal(KNOTEN_PRAEFIX, "knoten:");
  assert.equal(knotenWahlwert("llama3:8b"), "knoten:llama3:8b");
  assert.equal(knotenModellAus(knotenWahlwert("llama3:8b")), "llama3:8b");
  assert.equal(knotenModellAus(knotenWahlwert("")), "", "das Modell, das der Knoten wählt");
  for (const anders of ["", "llama3:8b", lokalerWahlwert("llama3"), undefined, null]) assert.equal(knotenModellAus(anders), null, String(anders));
  assert.equal(lokalesModellAus(knotenWahlwert("x")), undefined, "kein lokales Modell");
});

test("B-9a: askAi – Mein Knoten nach Funk und Gerät, vor Kontingent und Netz; danach geht nichts an andere", () => {
  const ask = teil("export async function askAi(", "async function askWithFailover(");
  const knoten = ask.indexOf("await frageMeinenKnoten(prompt, knotenModell, btn);");
  assert.ok(knoten > 0, "askAi fragt meinen Knoten");
  assert.ok(knoten > ask.indexOf("await frageAufDiesemGeraet("), "das Gerät zuerst – wer es wählt, will nichts im Netz");
  assert.ok(knoten < ask.indexOf("if (quotaExhausted)"), "vor dem Kontingent – der eigene Knoten kostet nichts");
  assert.ok(knoten < ask.indexOf("await askWithFailover("), "vor dem Netz");
  assert.match(ask.slice(knoten, knoten + 80), /\n\s*return;/, "danach kein Ausweichen");
  // Stopp vor der Prüfung des Prompts – der ist nach dem Senden leer (Fund aus B-9a)
  assert.ok(ask.indexOf("jobAbort.abort();") > 0 && ask.indexOf("jobAbort.abort();") < ask.indexOf("if (!prompt) return;"), "Stopp wirkt auch mit leerem Feld");
});

test("B-9a: frageMeinenKnoten – nur an den gekoppelten Knoten, ohne Gebot, mit dem Nachweis aus buildJobEvent", () => {
  const fn = teil("async function frageMeinenKnoten(", "/** So lange wartet die App");
  assert.match(fn, /const k = meineKopplung\(\);\s*if \(!k\) \{\s*toast\(t\("agent\.knotenNichtGekoppelt"\), true\);/, "ungekoppelt geht nichts hinaus");
  assert.match(fn, /await buildJobEvent\(prompt, 0, "free", k\.knoten, ensureSessionClient\(\), \[\], modell\)/, "Gebot 0, Ziel nur der Knoten");
  // seit B-9c2 mit der Quelle des Wegs (Relay meines Knotens oder Pool) – weiter nur dieser Knoten
  assert.match(fn, /await waitForAnswer\(requestId, KNOTEN_ZEIT_MS, k\.knoten, \{ signal: jobAbort\.signal, quelle: weg \}\)/);
  for (const anderes of ["findProviders", "askWithFailover", "askRace", "askSwarm", "privatFaehig", "for (", "zahle("]) {
    assert.ok(!fn.includes(anderes), `kein ${anderes} – nur dieser Knoten`);
  }
  // Ablehnung oder Schweigen stehen im Verlauf, nie ein stiller Wechsel
  assert.match(fn, /if \(!antwort\) addAiMessage\("ai", t\("agent\.knotenSchweigt"/);
  assert.match(fn, /addAiMessage\("ai", t\("agent\.knotenLehntAb", \{ grund: antwort\.providerError\.slice\(0, 200\) \}\), ""\)/);
  // Rechenarbeit nur aus dem Angebot des Knotens und nur in der Grenze der App
  assert.match(fn, /if \(angebot\?\.powBits !== undefined && angebot\.powBits <= MAX_POW_APP\) powJeProvider\.set\(k\.knoten, angebot\.powBits\);/);
  // buildJobEvent: der Nachweis kommt über kopplungFuer() – also nur für genau diesen Knoten
  const bau = teil("async function buildJobEvent(", "/** Abbruch-Signal");
  assert.match(bau, /const eigen = kopplungFuer\(targetPubkey\);/);
  assert.match(bau, /const gewaehltesModell = modell \?\? \(\$\("#ai-model"\) as HTMLSelectElement \| null\)\?\.value \?\? "";/, "das Modell ohne „knoten:“");
});

test("B-9a: Modellwahl – Gruppe „Mein Knoten“ nur gekoppelt, zwischen Netz und Gerät, nur Text", () => {
  const bereich = teil("async function zeigeKnotenBereich(", "/**\n * Frage an meinen Knoten");
  assert.match(bereich, /const k = meineKopplung\(\);/);
  assert.match(bereich, /pop\.querySelector\("\.knoten-bereich"\)\?\.remove\(\);\s*if \(!k\) return;/, "ungekoppelt keine Gruppe");
  assert.match(bereich, /await angebotVon\(k\.knoten\)/, "Modelle aus dem Angebot des eigenen Knotens");
  assert.match(bereich, /const modelle = angebot\?\.models\?\.length \? angebot\.models : \[""\];/, "ohne Angebot: Modell des Knotens");
  assert.match(bereich, /pop\.insertBefore\(bereich, pop\.querySelector\("\.lokal-bereich"\)\);/, "vor „Dieses Gerät“");
  assert.doesNotMatch(bereich, /innerHTML/, "Modellnamen kommen aus dem Angebot – nur textContent");
  assert.match(agent, /\} finally \{\n\s*zeigeLokalBereich\(\);\n\s*void zeigeKnotenBereich\(\);/, "auch ohne Netz-Modelle steht „Mein Knoten“ in der Wahl");
  assert.match(teil("export function setupModelPicker(", "// klick außerhalb"), /if \(pop\.classList\.contains\("hidden"\)\) return;\s*\/\/[^\n]*\n\s*void zeigeKnotenBereich\(\);/, "beim Öffnen neu – auch gleich nach dem Koppeln");
  // Gratis in der Schätzung, Knopf mit eigenem Zeichen
  assert.match(agent, /if \(knotenModellAus\(\(\$\("#ai-model"\) as HTMLInputElement \| null\)\?\.value\) !== null\) \{ el\.textContent = t\("agent\.knotenGratis"\); return; \}/);
  // Seit C-6d als DOM: Symbol „server“, dann der Name (oder „Standard“) als Text
  assert.match(agent, /\? \["server", `\$\{knotenModell\.split\(":"\)\[0\] \|\| t\("agent\.knotenStandard"\)\} · \$\{t\("agent\.knotenKurz"\)\}`\]/);
  assert.match(agent, /btn\.replaceChildren\(iconEl\(symbol, 14\), ` \$\{text\}`\);/);
});
