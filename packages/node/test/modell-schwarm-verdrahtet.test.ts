/**
 * Schritt B-29c2c: der Schwarm im Knoten verdrahtet – aria2c nur mit TORRENT=1 und
 * einem OpenAI-kompatiblen Antrieb, zuerst aus dem Schwarm, dann vom Betreiber
 * (Pirate Face), dann Hugging Face; geprüft geteilt und gemeldet (38058).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("Verdrahtet (B-29c2c): main startet aria2c nur mit TORRENT=1 und OpenAI-kompatiblem Antrieb, holt zuerst aus dem Schwarm, teilt und meldet", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /const torrentWahl = torrentAusUmgebung\(process\.env, join\(process\.env\.HOME \?\? "\.", "\.freedom", "aria2"\)\);\n  if \(torrentWahl\.grund\) \{\n    console\.error\(`\[schwarm\] \$\{torrentWahl\.grund\} – der Knoten startet nicht`\);\n    process\.exit\(1\);/);
  assert.match(main, /if \(torrentWahl\.einstellung && !mitOllama\) \{\n    schwarm = await starteAria2\(torrentWahl\.einstellung\)/);
  assert.match(main, /process\.on\("exit", \(\) => schwarm\?\.stoppe\(\)\);/, "aria2c endet mit dem Knoten");
  assert.match(main, /quellen: async \(m\) => magnetQuellen\(await pool\.query\(\{ kinds: \[KIND_MODEL_SEED\], "#d": \[`seed:\$\{m\.modelId\}`\], limit: 200 \}\), m, /);
  assert.match(main, /hole: \(magnet, m, ordner, fortschritt\) => holeUndTeile\(schwarm!\.aria2, magnet, m, \{ ordner, schwarm: schwarmOrt \}/);
  assert.match(main, /const t = await teileModell\(schwarm!\.aria2, m, \{ ordner, schwarm: schwarmOrt \}\);\n              await meldeVorhalten\(m, t\.magnet\);/);
  assert.match(main, /buildModelSeed\(m\.modelId, keypair\.pk, m\.files\.map\(\(f\) => f\.name\), undefined, undefined, \{ magnet, inhalt: inhaltsKennung\(m\) \}\)/);
  assert.match(main, /x\.quelle === "hf" && x\.ordner && ordnerAbdruck\(x\.ordner\) === x\.abdruck/, "nur unveränderte Ordner teilen");
  // Der Lader: erst das Netz, dann der Magnet des Betreibers, dann Hugging Face
  const laden = readFileSync(new URL("../src/modell-laden.ts", import.meta.url), "utf8");
  assert.match(laden, /const magnete = hf\.schwarm \? \[\.\.\.await hf\.schwarm\.quellen\(m\)\.catch\(\(\) => \[\]\), \.\.\.\(vomBetreiber \? \[vomBetreiber\] : \[\]\)\] : \[\];/);
  assert.match(readFileSync(new URL("../src/modell.ts", import.meta.url), "utf8"), /merkeWunsch\(wunschDatei\(\), name, undefined, ausQuelle, whisper \? "whisper" : hf \? "hf" : "ollama", magnet\)/);
  // Docker: aria2 im Image; der Schwarm-Port nicht von selbst offen
  assert.match(readFileSync(new URL("../../../docker/node.Dockerfile", import.meta.url), "utf8"), /apt-get install -y --no-install-recommends aria2/);
  assert.match(readFileSync(new URL("../../../docker-compose.yml", import.meta.url), "utf8"), /TORRENT: "\$\{TORRENT:-0\}"/);
});
