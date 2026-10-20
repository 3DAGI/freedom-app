/**
 * B-34c2: Beitreten zu einem Gruppenanruf – Weg nur über den eigenen TURN oder nach Zustimmung, Schlüssel je MLS-Epoche
 * im Ring, livekit-client erst bei Bedarf und vorab minifiziert, der E2EE-Worker als Text im einen Skript.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TurnZugang } from "@freedomstack/protocol";
import { SCHLUESSEL_RING, beitrittsWeg, schluesselIndex, signalAdresse, zustimmungNoetig } from "../src/gruppenanruf-ablauf.js";

const lies = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const TURN: TurnZugang = { urls: ["turns:turn.example.org:5349"], nutzer: "1790000000:abc", passwort: "geheim-passwort-abc", bis: 1_790_000_000 };

test("B-34d/B-34e2: fremdem Anruf ohne Rückfrage nur mit Signal und Bild und Ton über den eigenen Knoten", () => {
  const [ich, andere] = ["a".repeat(64), "b".repeat(64)];
  const signal = `wss://knoten.example.org/signal/${"c".repeat(64)}`;
  assert.equal(zustimmungNoetig({ von: andere }, ich), true, "ohne Weg: fragen");
  assert.equal(zustimmungNoetig({ von: andere }, ich, beitrittsWeg(TURN)), true, "nur TURN – der WebSocket ginge direkt zum SFU (Befund B-34d)");
  assert.equal(zustimmungNoetig({ von: andere }, ich, beitrittsWeg(null, signal)), true, "nur das Signal – Bild und Ton gingen direkt");
  assert.equal(zustimmungNoetig({ von: andere }, ich, beitrittsWeg(TURN, signal)), false, "beides über den eigenen Knoten (LK5 A)");
  assert.equal(zustimmungNoetig({ von: ich }, ich), false, "der eigene Anruf läuft auf dem eigenen Knoten");
  assert.deepEqual(beitrittsWeg(TURN), {
    art: "turn", rtc: { iceServers: [{ urls: ["turns:turn.example.org:5349"], username: "1790000000:abc", credential: "geheim-passwort-abc" }], iceTransportPolicy: "relay" },
    signal: null,
  });
  assert.deepEqual(beitrittsWeg(null), { art: "direkt", rtc: {}, signal: null });
  assert.equal(beitrittsWeg(TURN, signal).signal, signal);
});

test("B-34e2: Adresse über den eigenen Knoten – Relay ohne Pfad plus /signal/<zeichen>, sonst keine", () => {
  const z = "0f".repeat(32);
  assert.equal(signalAdresse("wss://knoten.example.org", z), `wss://knoten.example.org/signal/${z}`);
  assert.equal(signalAdresse("wss://knoten.example.org/", z), `wss://knoten.example.org/signal/${z}`);
  assert.equal(signalAdresse("ws://192.168.1.5:7777", z), `ws://192.168.1.5:7777/signal/${z}`, "Heimnetz wie die Relay-Verbindung selbst");
  assert.equal(signalAdresse("ws://abcdefghijklmnop.onion", z), `ws://abcdefghijklmnop.onion/signal/${z}`);
  for (const [relay, zeichen] of [
    ["https://knoten.example.org", z], ["wss://knoten.example.org/relay", z], ["wss://a:b@knoten.example.org", z], ["wss://knoten.example.org?x=1", z],
    ["wss://knoten.example.org#x", z], ["kein relay", z], ["wss://knoten.example.org", z.slice(2)], ["wss://knoten.example.org", z.toUpperCase()],
  ] as const) {
    assert.equal(signalAdresse(relay, zeichen), null, `${relay} ${zeichen.length}`);
  }
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
  assert.match(q, /const weg = await wegFuer\(a, zustimmungNoetig\(a, p\.ich\), p\.zugestimmt === true\);\n\s+if \(zustimmungNoetig\(a, p\.ich, weg\) && p\.zugestimmt !== true\) return "warnung";/,
    "erst den eigenen Weg holen, ohne ihn nur nach Zustimmung");
  assert.ok(q.indexOf('return "warnung";') < q.indexOf('await import("livekit-client")'), "vor der Zustimmung kein livekit-client, kein Worker, keine Verbindung");
  assert.match(q, /const \[turn, signal\] = await Promise\.all\(\[eigenerTurnZugang\(\), fremd \? signalWegVomKnoten\(a\.url, a\.bis\) : null\]\);/,
    "die Weiterleitung nur für fremde Anrufe – den eigenen SFU erreicht man direkt");
  assert.match(q, /const g = gemerkterWeg;\n\s+gemerkterWeg = null;\n\s+if \(nachRueckfrage && g\?\.anruf === a\.anruf && g\.bis > Date\.now\(\)\) return g\.weg;/,
    "gemerkt nur für den Versuch gleich nach der Rückfrage – nach dem Koppeln fragt die App neu");
  assert.match(q, /await room\.setE2EEEnabled\(true\);\n\s+await room\.connect\(weg\.signal \?\? a\.url, a\.zugang\.token, \{ rtcConfig: weg\.rtc,/, "erst verschlüsseln, dann verbinden – über den eigenen Knoten, wenn er es kann");
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

test("B-34e2: der Weg vom eigenen Knoten – nur mit Relay und Rolle „signal“, versiegelt, Antwort streng gelesen", () => {
  const q = lies("src/shell/gruppenanruf.ts");
  const rumpf = q.slice(q.indexOf("export async function signalWegVomKnoten("), q.indexOf("const APP:"));
  assert.match(rumpf, /const \[relay, status\] = await Promise\.all\(\[knotenRelay\(k\.knoten\), frageKnotenStatus\(k\)\]\);\n\s+if \(!relay \|\| !\("status" in status\) \|\| !status\.status\.rollen\.includes\("signal"\)\) return null;/,
    "ein älterer Knoten läse 5082 als gewöhnlichen Auftrag – erst den Status");
  assert.ok(rumpf.indexOf("frageKnotenStatus") < rumpf.indexOf("baueSignalAnfrage"));
  assert.match(rumpf, /await warteAufKnoten\(weg, sitzung, requestId, KIND_DVM_SIGNAL \+ 1000, STATUS_ZEIT_MS, STATUS_TAKT_MS\);/);
  assert.match(rumpf, /return z \? signalAdresse\(relay, z\.zeichen\) : null;/);
  assert.match(rumpf, /finally \{\n\s+weg\.schliesse\(\);/);
  assert.doesNotMatch(rumpf, /localStorage|geheim\.|console\./, "das Zeichen wird nie gemerkt");
});
