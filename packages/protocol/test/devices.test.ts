/**
 * Tests fuer Geraetschluessel.
 *
 * Ein Geraetschluessel ist ein vollwertiger Schluessel — wer ihn hat, handelt
 * im Namen des Eigentuemers. Der Schwerpunkt liegt deshalb auf den Grenzen:
 * Was kann ein verlorenes Geraet, was ein entzogenes, und wer darf entziehen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent, NostrEvent } from "../src/event.js";
import {
  buildDeviceGrant, parseDeviceGrant, buildDeviceRevoke, listDevices,
  checkDeviceEvent, defaultPermissions, deviceWarning,
  ALL_DEVICE_PERMISSIONS, KIND_DEVICE_GRANT, DevicePermission, DeviceGrant,
} from "../src/devices.js";

const NOW = 1_800_000_000;
const TAG = 86400;
const HAUPT = generateKeypair();
const HANDY = generateKeypair();
const LAPTOP = generateKeypair();
const FREMD = generateKeypair();

const vollmacht = (
  geraet: string, perms: DevicePermission[], tage = 365, at = NOW - 100 * TAG, von = HAUPT,
) => signEvent(buildDeviceGrant({
  ownerPubkey: von.pk, devicePubkey: geraet, label: "Testgerät",
  permissions: perms, expiresAt: at + tage * TAG,
}, at), von.sk);

const entzug = (geraet: string, at = NOW, von = HAUPT) =>
  signEvent(buildDeviceRevoke(von.pk, geraet, "verloren", at), von.sk);

const geraeteEvent = (kp: typeof HANDY, at = NOW): NostrEvent =>
  signEvent(buildEvent(kp.pk, 4, [], "nachricht", at), kp.sk);

// ------------------------------------------------------------- Format

test("Vollmacht: Roundtrip", () => {
  const g = parseDeviceGrant(vollmacht(HANDY.pk, ["nachrichten", "raeume"]));
  assert.equal(g.devicePubkey, HANDY.pk);
  assert.deepEqual(g.permissions, ["nachrichten", "raeume"]);
});

test("Eine Vollmacht ohne Rechte ist sinnlos", () => {
  assert.throws(() => buildDeviceGrant({
    ownerPubkey: HAUPT.pk, devicePubkey: HANDY.pk, label: "x",
    permissions: [], expiresAt: NOW + TAG,
  }), /ohne Rechte/);
});

test("Ein Geraet kann sich nicht selbst bevollmaechtigen", () => {
  assert.throws(() => buildDeviceGrant({
    ownerPubkey: HANDY.pk, devicePubkey: HANDY.pk, label: "x",
    permissions: ["nachrichten"], expiresAt: NOW + TAG,
  }), /nicht selbst/);
});

test("Vollmacht ohne Ablauf wird abgelehnt", () => {
  // Eine unbefristete Vollmacht auf einem Geraet in der Schublade ist eine
  // dauerhafte offene Tuer.
  const ev = signEvent(buildEvent(HAUPT.pk, KIND_DEVICE_GRANT, [
    ["p", HANDY.pk, "", "device"], ["perm", "nachrichten"],
  ], ""), HAUPT.sk);
  assert.throws(() => parseDeviceGrant(ev), /ohne Ablauf/);
});

test("Erfundene Rechte werden verworfen", () => {
  const ev = signEvent(buildEvent(HAUPT.pk, KIND_DEVICE_GRANT, [
    ["p", HANDY.pk, "", "device"], ["perm", "alles"], ["perm", "nachrichten"],
    ["expiration", String(NOW + TAG)],
  ], ""), HAUPT.sk);
  assert.deepEqual(parseDeviceGrant(ev).permissions, ["nachrichten"]);
});

// ------------------------------------------------------------- Liste

test("Aktive Geraete werden aufgelistet", () => {
  const d = listDevices(HAUPT.pk, [
    vollmacht(HANDY.pk, ["nachrichten"]),
    vollmacht(LAPTOP.pk, ALL_DEVICE_PERMISSIONS),
  ], { nowSecs: NOW });
  assert.equal(d.length, 2);
  assert.ok(d.every((x) => x.status === "aktiv"));
});

test("Fremde Vollmachten zaehlen nicht", () => {
  // Sonst koennte jeder behaupten, ein Geraet von mir zu sein.
  const d = listDevices(HAUPT.pk, [vollmacht(HANDY.pk, ["nachrichten"], 365, NOW - TAG, FREMD)],
    { nowSecs: NOW });
  assert.equal(d.length, 0);
});

test("Abgelaufene Vollmachten verlieren ihre Rechte", () => {
  const d = listDevices(HAUPT.pk, [vollmacht(HANDY.pk, ["nachrichten"], 30, NOW - 100 * TAG)],
    { nowSecs: NOW });
  assert.equal(d[0].status, "abgelaufen");
  assert.equal(d[0].permissions.size, 0);
});

test("Kurz vor Ablauf wird gewarnt", () => {
  const d = listDevices(HAUPT.pk, [vollmacht(HANDY.pk, ["nachrichten"], 105, NOW - 100 * TAG)],
    { nowSecs: NOW });
  assert.match(d[0].message, /Tag\(en\) ab/);
});

test("Eine neuere Vollmacht ersetzt die aeltere", () => {
  // Rechte muessen aenderbar sein, ohne das Geraet neu einzurichten.
  const d = listDevices(HAUPT.pk, [
    vollmacht(HANDY.pk, ["nachrichten"], 365, NOW - 200 * TAG),
    vollmacht(HANDY.pk, ["nachrichten", "zahlungen"], 365, NOW - 10 * TAG),
  ], { nowSecs: NOW });
  assert.equal(d.length, 1);
  assert.equal(d[0].permissions.has("zahlungen"), true);
});

test("Nur der Eigentuemer kann entziehen", () => {
  // Sonst koennte ein Geraet ein anderes aussperren — oder ein Fremder alle.
  const d = listDevices(HAUPT.pk, [
    vollmacht(HANDY.pk, ["nachrichten"]),
    entzug(HANDY.pk, NOW, FREMD),
  ], { nowSecs: NOW });
  assert.equal(d[0].status, "aktiv");
});

test("Der Eigentuemer kann entziehen", () => {
  const d = listDevices(HAUPT.pk, [vollmacht(HANDY.pk, ["nachrichten"]), entzug(HANDY.pk)],
    { nowSecs: NOW });
  assert.equal(d[0].status, "entzogen");
  assert.equal(d[0].permissions.size, 0);
});

test("Aktive Geraete stehen oben", () => {
  const d = listDevices(HAUPT.pk, [
    vollmacht(HANDY.pk, ["nachrichten"]), entzug(HANDY.pk),
    vollmacht(LAPTOP.pk, ["nachrichten"]),
  ], { nowSecs: NOW });
  assert.equal(d[0].status, "aktiv");
});

// ------------------------------------------------------------- Pruefung

test("Ein bevollmaechtigtes Geraet darf, was es darf", () => {
  const d = listDevices(HAUPT.pk, [vollmacht(HANDY.pk, ["nachrichten"])], { nowSecs: NOW });
  assert.equal(checkDeviceEvent(geraeteEvent(HANDY), "nachrichten", d).valid, true);
});

test("Und nicht, was es nicht darf", () => {
  // Die wichtigste Grenze: Ein Chat-Geraet loest keine Zahlungen aus.
  const d = listDevices(HAUPT.pk, [vollmacht(HANDY.pk, ["nachrichten"])], { nowSecs: NOW });
  const r = checkDeviceEvent(geraeteEvent(HANDY), "zahlungen", d);
  assert.equal(r.valid, false);
  assert.match(r.reason, /Zahlungen auslösen/);
});

test("Ein unbekanntes Geraet darf nichts", () => {
  const d = listDevices(HAUPT.pk, [vollmacht(HANDY.pk, ["nachrichten"])], { nowSecs: NOW });
  assert.equal(checkDeviceEvent(geraeteEvent(FREMD), "nachrichten", d).valid, false);
});

test("Nach dem Entzug ist Schluss", () => {
  const d = listDevices(HAUPT.pk, [vollmacht(HANDY.pk, ["nachrichten"]), entzug(HANDY.pk, NOW - TAG)],
    { nowSecs: NOW });
  assert.equal(checkDeviceEvent(geraeteEvent(HANDY, NOW), "nachrichten", d).valid, false);
});

test("Was VOR dem Entzug entstand, bleibt gueltig", () => {
  // Sonst loescht ein verlorenes Handy die gesamte Vorgeschichte — auch die
  // Nachrichten, auf die andere geantwortet haben.
  const grants = new Map<string, DeviceGrant>([
    [HANDY.pk, parseDeviceGrant(vollmacht(HANDY.pk, ["nachrichten"]))],
  ]);
  const d = listDevices(HAUPT.pk, [vollmacht(HANDY.pk, ["nachrichten"]), entzug(HANDY.pk, NOW)],
    { nowSecs: NOW });
  const r = checkDeviceEvent(geraeteEvent(HANDY, NOW - 10 * TAG), "nachrichten", d, grants);
  assert.equal(r.valid, true);
  assert.match(r.reason, /Vor dem Entzug/);
});

test("Rueckwirkend gilt nur, was das Geraet je durfte", () => {
  const grants = new Map<string, DeviceGrant>([
    [HANDY.pk, parseDeviceGrant(vollmacht(HANDY.pk, ["nachrichten"]))],
  ]);
  const d = listDevices(HAUPT.pk, [vollmacht(HANDY.pk, ["nachrichten"]), entzug(HANDY.pk, NOW)],
    { nowSecs: NOW });
  const r = checkDeviceEvent(geraeteEvent(HANDY, NOW - 10 * TAG), "zahlungen", d, grants);
  assert.equal(r.valid, false);
  assert.match(r.reason, /durfte nie/);
});

// ------------------------------------------------------- Voreinstellung

test("Die Voreinstellung schliesst Zahlungen aus", () => {
  // Das ist die Grenze, an der ein verlorenes Geraet von aergerlich zu teuer
  // wird.
  const p = defaultPermissions("lesen-schreiben");
  assert.equal(p.includes("zahlungen"), false);
  assert.equal(p.includes("identitaet"), false);
  assert.equal(p.includes("nachrichten"), true);
});

test("Vollzugriff ist moeglich, aber ausdruecklich", () => {
  assert.equal(defaultPermissions("vollzugriff").length, ALL_DEVICE_PERMISSIONS.length);
  assert.deepEqual(defaultPermissions("nur-chat"), ["nachrichten"]);
});

test("Die Warnung nennt die Schwaeche, nicht nur die Funktion", () => {
  const ohne = deviceWarning(["nachrichten"], 365);
  assert.match(ohne, /bis du die Vollmacht entziehst/);
  assert.match(ohne, /erreicht nur\s+Clients, die ihn sehen/);
  assert.match(ohne, /kann ein verlorenes Gerät kein Geld ausgeben/);

  const mit = deviceWarning(["zahlungen", "identitaet"], 30);
  assert.match(mit, /Geld ausgeben/);
  assert.match(mit, /also alles/);
});
