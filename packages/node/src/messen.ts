/**
 * Durchsatz messen (Sammlung B-29b): `npm run messen` im Ordner `packages/node`,
 * mit derselben Umgebung wie der Knoten (`KI_ANTRIEB`, `KI_URL`, `OLLAMA_URL`,
 * `PROVIDER_MODELS`). Je Stufe (`--gleichzeitig 1,4,8`) stellt es feste
 * Übungsfragen ohne Werkzeuge und zeigt Tokens je Sekunde, Antworten je Minute,
 * Median und p95 der Dauer. Vorher eine Anfrage zum Aufwärmen (Modell laden),
 * die nicht zählt. Am besten, solange der Knoten keine Aufträge bedient.
 */
import { OllamaBackend } from "./inference.js";
import { antriebAusUmgebung } from "./ki-antrieb.js";
import { providerModelle } from "./modell-pruefung.js";
import { anfragenFuer, leseMessWunsch, messTabelle, missStufe, werteAus } from "./messung.js";

const { wunsch, grund } = leseMessWunsch(process.argv.slice(2));
if (!wunsch) {
  console.error(grund);
  process.exit(1);
}
const { antrieb, grund: antriebGrund } = antriebAusUmgebung(process.env);
if (!antrieb) {
  console.error(`KI-Antrieb: ${antriebGrund}`);
  process.exit(1);
}
const modell = wunsch.modell ?? providerModelle(process.env)[0];
if (!modell) {
  console.error("Kein Modell: --modell <name> oder PROVIDER_MODELS setzen.");
  process.exit(1);
}
const backend = new OllamaBackend(antrieb.url, modell, { antrieb: antrieb.art, schluessel: antrieb.schluessel });
if (!(await backend.available())) {
  console.error(`KI-Antrieb nicht erreichbar (${backend.name()}).`);
  process.exit(1);
}
console.log(`Aufwärmen: ${modell} (${antrieb.art}) …`);
const warm = await missStufe(backend, { modell, gleichzeitig: 1, anfragen: 1, tokens: wunsch.tokens });
if (warm.fehler.length) {
  console.error(`Aufwärmen gescheitert (${warm.fehler.join(", ")}) – stimmt der Modellname beim Antrieb?`);
  process.exit(1);
}
const auswertungen = [];
const fehler: string[] = [];
for (const n of wunsch.gleichzeitig) {
  const anfragen = anfragenFuer(wunsch, n);
  console.log(`Stufe ${n} gleichzeitig: ${anfragen} Anfragen …`);
  const stufe = await missStufe(backend, { modell, gleichzeitig: n, anfragen, tokens: wunsch.tokens });
  auswertungen.push(werteAus(stufe));
  fehler.push(...stufe.fehler);
}
console.log(`\n${messTabelle(antrieb.art, modell, auswertungen, fehler)}`);
if (antrieb.art === "ollama") console.log("Ollama bedient gleichzeitige Anfragen nur bis OLLAMA_NUM_PARALLEL (Umgebung des Ollama-Dienstes).");
process.exit(auswertungen.some((a) => a.fertig === 0) ? 1 : 0);
