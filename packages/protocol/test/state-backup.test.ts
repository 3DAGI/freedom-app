/**
 * Tests fuer Zustandssicherung und Ablauf.
 *
 * Die Sicherung ist eine GARANTIE, der Ablauf eine BITTE. Dass beides
 * unterschiedlich benannt wird, ist wichtiger als die Funktion selbst — ein
 * falsches Sicherheitsgefuehl fuehrt dazu, dass jemand etwas schreibt, das er
 * sonst nicht geschrieben haette.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent, NostrEvent } from "../src/event.js";
import {
  deriveBackupKey, buildStateBackup, restoreStateBackup, latestBackup,
  stateFingerprint, backupInfo,
  expirationTag, checkExpiry, filterExpired, expiryWarning,
  EXPIRY_SECONDS, KIND_STATE_BACKUP, TAG_EXPIRATION,
} from "../src/state-backup.js";

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

// ------------------------------------------------------------- Ablauf

const mitAblauf = (preset: Parameters<typeof expirationTag>[0], at = NOW): NostrEvent =>
  signEvent(buildEvent(KP.pk, 4, expirationTag(preset, at), "text", at), KP.sk);

test("Ohne Ablauf wird kein Tag gesetzt", () => {
  assert.equal(expirationTag("keiner").length, 0);
  assert.equal(checkExpiry(mitAblauf("keiner")).expired, false);
});

test("Ablauf wird als absoluter Zeitpunkt gesetzt", () => {
  const tags = expirationTag("7t", NOW);
  assert.equal(tags[0][0], TAG_EXPIRATION);
  assert.equal(Number(tags[0][1]), NOW + EXPIRY_SECONDS["7t"]!);
});

test("Vor dem Ablauf ist die Nachricht da", () => {
  const r = checkExpiry(mitAblauf("7t", NOW), NOW + 3 * TAG);
  assert.equal(r.expired, false);
  assert.match(r.message, /4 Tagen ab/);
});

test("Nach dem Ablauf gilt sie als geloescht", () => {
  const r = checkExpiry(mitAblauf("24h", NOW), NOW + 2 * TAG);
  assert.equal(r.expired, true);
  // "Wohlmeinende" — das Wort traegt die ganze Einschraenkung.
  assert.match(r.message, /Wohlmeinende Relays/);
});

test("Kurz vor Ablauf wird in Stunden gerechnet", () => {
  const r = checkExpiry(mitAblauf("24h", NOW), NOW + 20 * 3600);
  assert.match(r.message, /Stunden/);
});

test("Unbrauchbare Ablaufangaben werden ignoriert, nicht geloescht", () => {
  // Im Zweifel behalten: Eine kaputte Angabe darf keine Nachricht kosten.
  const ev = signEvent(buildEvent(KP.pk, 4, [[TAG_EXPIRATION, "bald"]], "text", NOW), KP.sk);
  assert.equal(checkExpiry(ev, NOW + 999 * TAG).expired, false);
});

test("Abgelaufenes wird gefiltert, der Rest bleibt", () => {
  const r = filterExpired([
    mitAblauf("24h", NOW - 10 * TAG),
    mitAblauf("1j", NOW),
    mitAblauf("keiner", NOW - 500 * TAG),
  ], NOW);
  assert.equal(r.kept.length, 2);
  assert.equal(r.expired, 1);
});

test("DIE WICHTIGSTE MELDUNG: Ablauf ist eine Bitte, keine Garantie", () => {
  // Eine Funktion namens "verschwindende Nachrichten" ohne diesen Hinweis
  // erzeugt genau das falsche Sicherheitsgefuehl.
  const t = expiryWarning("7t");
  assert.match(t, /BITTE an die Relays, keine Garantie/);
  assert.match(t, /Andere nicht/);
  assert.match(t, /vorher kopiert hat, behält sie/);
  assert.match(t, /auch nicht mit Ablauf/);
});

test("Ohne Ablauf wird das ebenso klar gesagt", () => {
  assert.match(expiryWarning("keiner"), /dauerhaft.*abrufbar/);
});
