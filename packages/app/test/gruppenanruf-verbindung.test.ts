/**
 * B-34c2: Beitreten zu einem Gruppenanruf – Weg nur über den eigenen TURN oder nach Zustimmung, Schlüssel je MLS-Epoche
 * im Ring, livekit-client erst bei Bedarf und vorab minifiziert, der E2EE-Worker als Text im einen Skript.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TurnZugang } from "@freedomstack/protocol";
import { SCHLUESSEL_RING, beitrittsWeg, schluesselIndex, zustimmungNoetig } from "../src/gruppenanruf-ablauf.js";

const lies = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const TURN: TurnZugang = { urls: ["turns:turn.example.org:5349"], nutzer: "1790000000:abc", passwort: "geheim-passwort-abc", bis: 1_790_000_000 };

test("B-34d: fremdem Anruf nur nach Zustimmung – die Signalverbindung zeigt dem SFU die IP; Bild und Ton mit eigenem TURN nur relay", () => {
  const [ich, andere] = ["a".repeat(64), "b".repeat(64)];
  assert.equal(zustimmungNoetig({ von: andere }, ich), true, "auch mit eigenem TURN – der WebSocket geht direkt zum SFU");
  assert.equal(zustimmungNoetig({ von: ich }, ich), false, "der eigene Anruf läuft auf dem eigenen Knoten");
  assert.deepEqual(beitrittsWeg(TURN), {
    art: "turn", rtc: { iceServers: [{ urls: ["turns:turn.example.org:5349"], username: "1790000000:abc", credential: "geheim-passwort-abc" }], iceTransportPolicy: "relay" },
  });
  assert.deepEqual(beitrittsWeg(null), { art: "direkt", rtc: {} });
});

test("B-34c2: Schlüssel-Index je Epoche im Ring – die vorige bleibt lesbar", () => {
  assert.equal(SCHLUESSEL_RING, 16);
  assert.deepEqual([0, 1, 15, 16, 17, 255].map(schluesselIndex), [0, 1, 15, 0, 1, 15]);
  assert.notEqual(schluesselIndex(41), schluesselIndex(42), "zwei aufeinanderfolgende Epochen nie am selben Platz");
  for (const falsch of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) assert.throws(() => schluesselIndex(falsch), RangeError);
});

test("B-34c2: Beitreten – Schlüssel nur aus der Gruppe und genullt, erst nach Zustimmung, Worker aus dem Bundle", () => {
  const q = lies("src/shell/gruppenanruf-verbindung.ts");
  assert.match(q, /roh: mls\.anrufSchluessel\(gruppe, anruf, epoche\)/, "nur aus dem MLS-Exporter (B-34b)");
  assert.match(q, /roh\.fill\(0\);/, "die Bytes werden nach dem Übergeben genullt");
  assert.match(q, /this\.onSetEncryptionKey\(await lk\.createKeyMaterialFromBuffer\(kopie\), undefined, schluesselIndex\(epoche\)\)/);
  assert.match(q, /if \(p\.zugestimmt !== true\) return "warnung";\n\s+const weg = beitrittsWeg\(await eigenerTurnZugang\(\)\);/, "erst fragen, dann den Vermittler holen");
  assert.match(q, /await room\.setE2EEEnabled\(true\);\n\s+await room\.connect\(a\.url, a\.zugang\.token, \{ rtcConfig: weg\.rtc,/, "erst verschlüsseln, dann verbinden");
  assert.match(q, /await import\("freedom:e2ee-worker"\)/);
  assert.match(q, /new Worker\(adresse\)/);
  assert.doesNotMatch(q, /^import \{[^}]*\} from "livekit-client"/m, "livekit-client nur dynamisch – nie beim Start");
  assert.doesNotMatch(q, /localStorage|geheim\.|console\.|setLogLevel|setLogExtension/, "nichts gemerkt, nichts ins Log; loglevel schriebe sonst in localStorage");
  // Was die App von livekit-client nimmt, muss das vorab minifizierte Modul im Build anbieten
  const genutzt = [...new Set([...q.matchAll(/\blk\.([A-Za-z]+)/g)].map((m) => m[1]!))].sort();
  const build = lies("build.mjs");
  const angeboten = build.match(/export \{ ([A-Za-z, ]+) \} from "livekit-client"/)?.[1]?.split(", ").sort();
  assert.deepEqual(genutzt, angeboten);
});

test("B-34c2: Build – livekit-client vorab minifiziert, der E2EE-Worker als Text; keine neue Lockerung der CSP", () => {
  const build = lies("build.mjs");
  assert.match(build, /name: "livekit-klein"/);
  assert.match(build, /name: "e2ee-worker"/);
  assert.match(build, /stdin: \{ contents: 'import "livekit-client\/e2ee-worker";'/);
  assert.match(build, /return \{ contents: w\.outputFiles\[0\]\.text, loader: "text" \};/);
  assert.match(build, /"worker-src blob: 'self'",/, "Worker aus blob: war schon erlaubt (B-12c)");
  const pkg = JSON.parse(lies("package.json")) as { dependencies: Record<string, string> };
  assert.equal(pkg.dependencies["livekit-client"], "2.22.4", "exakt gepinnt");
  const da = JSON.parse(readFileSync(new URL("../../../node_modules/livekit-client/package.json", import.meta.url), "utf8")) as { license: string };
  assert.equal(da.license, "Apache-2.0");
});

test("B-34c2: verdrahtet – nach dem Abgleich eines privaten Raums zieht der laufende Anruf den Schlüssel nach", () => {
  const raeume = lies("src/shell/tabs/raeume.ts");
  assert.match(raeume, /spacesUi\.privat = raum;\n\s+\/\/[^\n]*\n\s+void schluesselNachziehen\(gruppe\);/);
});
