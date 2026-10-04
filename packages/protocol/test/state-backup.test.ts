/**
 * Tests fuer die Zustandssicherung. (Der allgemeine Ablauf, der hier mitgetestet
 * wurde, fiel mit B-21 – ablaufende Nachrichten testet private-dm.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent } from "../src/event.js";
import {
  deriveBackupKey, buildStateBackup, restoreStateBackup, latestBackup,
  stateFingerprint, backupInfo,
  KIND_STATE_BACKUP,
  waehleSicherung, filtereWiederherstellung, SICHERUNG_EINTRAEGE, SICHERUNG_MAX_BYTES,
} from "../src/state-backup.js";
import { regelKeinKlartext } from "../src/leak-rules.js";

const NOW = 1_800_000_000;
const TAG = 86400;
const KP = generateKeypair();
const ANDERE = generateKeypair();

const zustand = {
  conversations: [{ id: "a", name: "Max" }],
  petnames: [["pk1", "Chef"]],
  spaces: ["raum-1"],
};

// ------------------------------------------------------------ Sicherung

test("Der Sicherungsschluessel ist NICHT der Identitaetsschluessel", () => {
  // Denselben Schluessel zum Signieren und Verschluesseln zu verwenden ist
  // ein Fehler, den man nicht rueckgaengig machen kann.
  const b = deriveBackupKey(KP.sk);
  assert.notDeepEqual(b.sk, KP.sk);
  assert.notEqual(b.pk, KP.pk);
});

test("Dieselbe Merkphrase ergibt denselben Sicherungsschluessel", () => {
  // Sonst waere die Wiederherstellung nicht moeglich.
  assert.deepEqual(deriveBackupKey(KP.sk).sk, deriveBackupKey(KP.sk).sk);
});

test("Verschiedene Identitaeten ergeben verschiedene Schluessel", () => {
  assert.notDeepEqual(deriveBackupKey(KP.sk).sk, deriveBackupKey(ANDERE.sk).sk);
});

test("Sichern und wiederherstellen", async () => {
  const b = deriveBackupKey(KP.sk);
  const r = await buildStateBackup(KP.pk, b, zustand, NOW);
  const ev = signEvent(r.event as never, KP.sk);

  const wieder = await restoreStateBackup(ev, b);
  assert.equal(wieder.ok, true, wieder.message);
  assert.deepEqual(wieder.data, zustand);
  assert.equal(wieder.backedUpAt, NOW);
});

test("Eine fremde Sicherung ist nicht lesbar — und stuerzt nicht ab", async () => {
  // Wichtig: Der Nutzer soll hineinkommen, auch wenn die Sicherung
  // unbrauchbar ist.
  const meine = deriveBackupKey(KP.sk);
  const fremde = deriveBackupKey(ANDERE.sk);
  const ev = signEvent((await buildStateBackup(KP.pk, meine, zustand, NOW)).event as never, KP.sk);

  const r = await restoreStateBackup(ev, fremde);
  assert.equal(r.ok, false);
  assert.match(r.message, /kommst trotzdem hinein/);
});

test("Beschaedigte Sicherung wird nicht als Erfolg gemeldet", async () => {
  const b = deriveBackupKey(KP.sk);
  const ev = signEvent(buildEvent(KP.pk, KIND_STATE_BACKUP,
    [["d", "freedom-state"]], "kein gueltiger chiffretext", NOW), KP.sk);
  assert.equal((await restoreStateBackup(ev, b)).ok, false);
});

test("Ein fremder Ereignistyp wird abgelehnt", async () => {
  const b = deriveBackupKey(KP.sk);
  const ev = signEvent(buildEvent(KP.pk, 1, [], "text", NOW), KP.sk);
  assert.equal((await restoreStateBackup(ev, b)).ok, false);
});

test("Die Sicherung ist adressierbar und ersetzt die vorige", async () => {
  // Sonst laege nach einem Jahr taeglicher Sicherungen ein Berg auf den
  // Relays, aus dem niemand die richtige findet.
  const b = deriveBackupKey(KP.sk);
  const r = await buildStateBackup(KP.pk, b, zustand, NOW);
  assert.ok(r.event.tags.some((t) => t[0] === "d" && t[1] === "freedom-state"));
});

test("Die neueste Sicherung wird gefunden", async () => {
  const b = deriveBackupKey(KP.sk);
  const alt = signEvent((await buildStateBackup(KP.pk, b, zustand, NOW - 10 * TAG)).event as never, KP.sk);
  const neu = signEvent((await buildStateBackup(KP.pk, b, zustand, NOW)).event as never, KP.sk);
  assert.equal(latestBackup([alt, neu])?.created_at, NOW);
  assert.equal(latestBackup([]), null);
});

test("Die Pruefsumme erkennt Aenderungen", () => {
  // Damit nicht bei jeder Kleinigkeit eine neue Sicherung hochgeht.
  const a = stateFingerprint(zustand);
  assert.equal(a, stateFingerprint({ ...zustand }));
  assert.notEqual(a, stateFingerprint({ ...zustand, spaces: ["raum-2"] }));
});

test("Die Auskunft nennt, was gesichert wird und wer es lesen kann", async () => {
  const t = backupInfo(50_000, NOW);
  assert.match(t, /Unterhaltungen/);
  assert.match(t, /auch kein Relay/);
  assert.match(t, /Merkphrase allein genügt/);
});

// ------------------------------------------------- Was gesichert wird (8.12)

/** So sah localStorage eines Nutzers ohne Tresor aus – mit allem, was dort liegen kann. */
const GERAET: Record<string, string> = {
  "freedom.nsec": "ab".repeat(32),
  "freedom.bunker": "bunker://geheim",
  "freedom.nwc.uri": "nostr+walletconnect://x?secret=" + "cd".repeat(32),
  ["freedom.swap." + "01".repeat(32)]: JSON.stringify({ preimageHex: "ef".repeat(32) }),
  "freedom.htlc.x": JSON.stringify({ preimageHex: "7a".repeat(32) }),
  "freedom.solWallet": "5b".repeat(32),
  "freedom.nachfolge": JSON.stringify({ anteile: { x: { daten: "99".repeat(32) } } }),
  "freedom.suche.schluessel": "11".repeat(32),
  "freedom.mls.epoche": "gruppen-schluessel",
  "freedom.chats": JSON.stringify([{ id: "c1", type: "dm", name: "Beratungsstelle", lastTs: 1 }]),
  "freedom.petnames": JSON.stringify([["pk1", "Chef"]]),
  "freedom.spaces": JSON.stringify(["raum-1"]),
  "freedom.mod.raum-1": "off",
  "freedom.lang": "de",
  "andere.app": "fremd",
};
const GEHEIM_WERTE = ["ab".repeat(32), "bunker://geheim", "cd".repeat(32), "ef".repeat(32), "7a".repeat(32), "5b".repeat(32), "99".repeat(32), "11".repeat(32), "gruppen-schluessel"];

test("8.12: gesichert wird nur die feste Liste – kein Schluessel, kein Zugang, keine Gruppenschluessel", () => {
  const d = waehleSicherung(Object.keys(GERAET), (k) => GERAET[k] ?? null);
  assert.deepEqual(Object.keys(d).sort(), ["freedom.chats", "freedom.lang", "freedom.mod.raum-1", "freedom.petnames", "freedom.spaces"]);
  const alles = JSON.stringify(d);
  for (const g of GEHEIM_WERTE) assert.ok(!alles.includes(g), `Geheimnis in der Sicherung: ${g.slice(0, 12)}`);
  // Die Liste selbst nennt nichts Geheimes
  assert.ok(SICHERUNG_EINTRAEGE.every((k) => !/nsec|bunker|nwc|swap|htlc|solWallet|vault|nachfolge|suche|mls|epoch/.test(k)));
});

test("8.12: WIEDERHERSTELLUNG OHNE KLARTEXT AUF RELAYS – und nur mit der eigenen Merkphrase", async () => {
  const d = waehleSicherung(Object.keys(GERAET), (k) => GERAET[k] ?? null);
  const key = deriveBackupKey(KP.sk);
  const r = await buildStateBackup(KP.pk, key, d, NOW);
  const ev = signEvent(r.event, KP.sk);
  assert.deepEqual(regelKeinKlartext([ev], ["Beratungsstelle", "Chef", "raum-1", ...GEHEIM_WERTE]), []);
  // Neues Geraet, dieselbe Merkphrase
  const zurueck = await restoreStateBackup(ev, deriveBackupKey(KP.sk));
  assert.equal(zurueck.ok, true);
  assert.deepEqual(filtereWiederherstellung(zurueck.data!), d);
  assert.equal((await restoreStateBackup(ev, deriveBackupKey(ANDERE.sk))).ok, false);
});

test("8.12: eine alte Sicherung mit Schluessel stellt den Schluessel NICHT wieder her", () => {
  // Bis 8.12 ging freedom.nsec mit in die Sicherung – beim Zurueckholen bleibt es draussen.
  const alt = { ...GERAET, "freedom.nsec": "ff".repeat(32), "freedom.zahl": 5 as unknown as string };
  const w = filtereWiederherstellung(alt);
  assert.equal(w["freedom.nsec"], undefined);
  assert.equal(w["freedom.nwc.uri"], undefined);
  assert.equal(w["freedom.mls.epoche"], undefined);
  assert.equal(w["andere.app"], undefined);
  assert.equal(w["freedom.chats"], GERAET["freedom.chats"]);
});

test("8.12: zu grosse Sicherung wird klar abgelehnt statt still abgeschnitten", async () => {
  const gross = { "freedom.chats": "x".repeat(SICHERUNG_MAX_BYTES) };
  await assert.rejects(buildStateBackup(KP.pk, deriveBackupKey(KP.sk), gross, NOW), /zu groß/);
});
