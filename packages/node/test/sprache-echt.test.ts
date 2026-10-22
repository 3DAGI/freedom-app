/**
 * B-38b3: Text aus Sprache mit dem echten `whisper-cli` (aus `scripts/whisper-bauen.sh`) in echtem bubblewrap – mit dem
 * Testmodell des Projekts (Gewichte ohne Sinn: der Text ist leer oder Unsinn, geprüft wird der Weg). Ohne
 * `WHISPER_TEST_CLI` und `WHISPER_TEST_MODELL` überspringt sich der Test; die CI baut beides.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPRACHE_GRENZEN, baueWav } from "@freedomstack/protocol";
import { pruefeSandbox } from "../src/sandbox.js";
import { Whisper, whisperAusUmgebung } from "../src/whisper.js";

const CLI = process.env.WHISPER_TEST_CLI;
const MODELL = process.env.WHISPER_TEST_MODELL;

test("B-38b3: echtes whisper-cli in der Sandbox – Ton hinein, Text heraus, nichts bleibt liegen", async (t) => {
  if (!CLI || !MODELL) return t.skip("WHISPER_TEST_CLI und WHISPER_TEST_MODELL nicht gesetzt");
  if (!(await pruefeSandbox()).ok) return t.skip("bubblewrap geht hier nicht");
  const { dienst, grund } = whisperAusUmgebung({ WHISPER_MODELL: MODELL, WHISPER_CLI: CLI, WHISPER_THREADS: "2", WHISPER_FRIST_SEK: "120" });
  assert.ok(dienst, grund ?? "ohne Grund");
  const basis = mkdtempSync(join(tmpdir(), "freedom-whisper-echt-"));
  try {
    // Drei Sekunden: ein Ton mit wechselnder Höhe – das Testmodell erkennt darin nichts, das Programm muss aber durchlaufen
    const proben = Int16Array.from({ length: 3 * SPRACHE_GRENZEN.abtastrate }, (_, i) => Math.round(6000 * Math.sin(i * (0.05 + (i % 8000) / 80_000))));
    const vorher = readFileSync(MODELL);
    for (const sprache of ["de", "en", "auto"] as const) {
      const text = await new Whisper(dienst, basis).transkribiere(baueWav(proben), sprache);
      assert.equal(typeof text, "string", sprache);
      assert.ok(text.length <= SPRACHE_GRENZEN.textZeichen && !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text), `${sprache}: sauber`);
      assert.deepEqual(readdirSync(basis), [], `${sprache}: Ton und Text sind weg`);
    }
    assert.deepEqual(readFileSync(MODELL), vorher, "das Modell bleibt unverändert");
  } finally {
    rmSync(basis, { recursive: true, force: true });
  }
});

test("B-38b3: whisper-bauen.sh – feste Fassung und Commit, ohne OpenMP, ohne Server, Lizenz dabei", () => {
  const s = readFileSync(new URL("../../../scripts/whisper-bauen.sh", import.meta.url), "utf8");
  assert.match(s, /^WHISPER_FASSUNG=v1\.9\.5$/m);
  assert.match(s, /^WHISPER_COMMIT=d1be6fde11ac6e0407606b4e42fe72d34add8037$/m);
  assert.match(s, /\[ "\$STAND" = "\$WHISPER_COMMIT" \] \|\| \{/, "nach dem Holen gegen den Commit geprüft");
  assert.match(s, /-DBUILD_SHARED_LIBS=OFF -DGGML_OPENMP=OFF/);
  assert.match(s, /-DWHISPER_BUILD_SERVER=OFF/, "kein Server – in der Sandbox ohne Netz wäre er nicht erreichbar");
  assert.match(s, /install -m 0644 "\$ARBEIT\/whisper\.cpp\/LICENSE" "\$ZIEL\/whisper\.cpp-LICENSE"/);
  assert.doesNotMatch(s, /curl |wget /, "nie ein fertiges Programm herunterladen");
  const lies = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
  const docker = lies("docker/node.Dockerfile");
  assert.match(docker, /FROM node:22-slim AS whisper-bau\nARG WHISPER=0\n/, "eigene Stufe – Compiler bleiben draußen");
  assert.match(docker, /&& bash \/tmp\/whisper-bauen\.sh \/tmp\/whisper \\\n/);
  assert.match(docker, /COPY --from=whisper-bau \/aus\/ \/\n/);
  const sprache = lies("docker-compose.sprache.yml");
  for (const z of ['WHISPER: "1"', "- seccomp=docker/seccomp-vibecoden.json", "- systempaths=unconfined", "- apparmor=unconfined", 'WHISPER_MODELL: "${WHISPER_MODELL:-']) {
    assert.ok(sprache.includes(z), z);
  }
  assert.ok(!/WHISPER/.test(lies("docker-compose.yml")), "der Standard baut kein whisper-cli und lockert nichts");
  const ci = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /bash scripts\/whisper-bauen\.sh "\$RUNNER_TEMP\/whisper" --testmodell/, "die CI prüft das echte Programm");
});
