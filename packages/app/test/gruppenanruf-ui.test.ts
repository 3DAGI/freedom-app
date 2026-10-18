/**
 * B-34d: Gruppenanrufe in der Oberfläche – Knopf und Zeilen nur im privaten Raum, fremden Anrufen nur nach der
 * Rückfrage beitreten, Bild und Ton nur als Spuren, nichts gemerkt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lies = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("B-34d: beitreten – fremd nur nach der Rückfrage zur IP, der eigene Anruf ohne; danach erst trittBei()", () => {
  const q = lies("src/shell/gruppenanruf-ui.ts");
  const rumpf = q.slice(q.indexOf("async function beitreten("), q.indexOf("/** Je laufendem Anruf"));
  assert.match(rumpf, /let zugestimmt = !zustimmungNoetig\(a, raum\.ich\);\n\s+if \(!zugestimmt\) \{\n\s+zugestimmt = await bestaetige\(\{ titel: t\("gruppenanruf\.ipTitel"\), text: t\("gruppenanruf\.ipText", \{ name \}\)/);
  assert.ok(rumpf.indexOf("bestaetige(") < rumpf.indexOf("trittBei("), "erst fragen, dann beitreten");
  assert.match(rumpf, /if \(!zugestimmt\) return;/, "abgebrochen geht nichts hinaus");
  // Anrufen nur gekoppelt, dann gleich dem eigenen Anruf beitreten (ohne Rückfrage – der SFU läuft beim eigenen Knoten)
  assert.match(q, /if \(!meineKopplung\(\)\) return toast\(t\("gruppenanruf\.ohneKnoten"\), true\);/);
  assert.match(q, /laufend\.find\(\(a\) => a\.von === raum\.ich && a\.zugang\)/);
  // Ist der eigene Anruf beendet, verlässt die App ihn
  assert.match(q, /if \(drin && drin\.gruppe === raum\.gruppe && !laufend\.some\(\(a\) => a\.anruf === drin\.anruf\)\) void verlasse\(\)/);
});

test("B-34d: Bild und Ton nur als Spuren, eigener Ton nie abgespielt; nur DOM, nichts gemerkt", () => {
  const q = lies("src/shell/gruppenanruf-ui.ts");
  assert.match(q, /if \(s\.eigen && s\.art === "audio"\) continue;/);
  assert.match(q, /m\.srcObject = new MediaStream\(\[s\.spur\]\);/);
  assert.doesNotMatch(q, /innerHTML|localStorage|geheim\.|console\.|from "livekit-client"/);
});

test("B-34d: verdrahtet – Knopf im Kopf des Kanals und Zeilen über dem Verlauf nur im privaten Raum; Leiste beim Start", () => {
  const raeume = lies("src/shell/tabs/raeume.ts");
  assert.match(raeume, /if \(anrufe\) zeigeGruppenanrufe\(anrufe, spacesUi\.privat, nameVon, \(\) => void raumNeuLaden\(\)\);/);
  const ui = lies("src/shell/gruppenanruf-ui.ts");
  assert.match(ui, /ansicht = raum \? \{ box, raum, name, neu \} : null;\n\s+if \(!raum\) \{\n\s+box\.replaceChildren\(\);\n\s+box\.classList\.add\("hidden"\);/, "im offenen Raum keine Zeilen – auch nicht nach einem Wechsel der Spuren");
  assert.match(raeume, /document\.getElementById\("raum-anruf"\)\?\.classList\.toggle\("hidden", !spacesUi\.privat\);/);
  assert.match(raeume, /if \(spacesUi\.privat\) void rufeImRaumAn\(spacesUi\.privat\);/);
  const html = lies("src/shell/index.html");
  assert.match(html, /<button id="raum-anruf" class="ghost icon-btn hidden" type="button"[^>]*data-i18n-aria="gruppenanruf\.starten">/);
  assert.match(html, /<div id="raum-anrufe" class="raum-anrufe hidden" role="region"[^>]*data-i18n-aria="gruppenanruf\.region">/);
  assert.match(lies("src/shell/app.ts"), /wireAnrufe\(\);\n\s+wireGruppenanrufe\(\);/);
});
