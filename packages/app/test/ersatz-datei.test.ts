/**
 * Schritt B-28 (Nutzertest 08.10., Befund T-2): Der Ersatzschlüssel aus
 * „Diebstahl vorbeugen“ lag nur als Klartext-Datei vor. Jetzt auf Wunsch mit
 * Passphrase (Format des Tresors), und der Widerruf nimmt die Datei an.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeypair, toHex } from "@freedomstack/protocol";
import { ERSATZ_ART, baueErsatzDatei, istErsatzDatei, leseErsatz } from "../src/ersatz-datei.js";

const kp = generateKeypair();
const SK = toHex(kp.sk);
const PASS = "lange genug für den Tresor 2026";

test("B-28: ohne Passphrase wie bisher Klartext, mit Passphrase verschlüsselt – der private Schlüssel steht nicht darin", async () => {
  const klar = await baueErsatzDatei(SK, kp.pk, `privat: ${SK}`, undefined);
  assert.deepEqual([klar.name, klar.typ], ["freedom-ersatzschluessel.txt", "text/plain"]);
  assert.ok(klar.inhalt.includes(SK));
  const zu = await baueErsatzDatei(SK, kp.pk, `privat: ${SK}`, PASS);
  assert.deepEqual([zu.name, zu.typ], ["freedom-ersatzschluessel.json", "application/json"]);
  assert.ok(!zu.inhalt.includes(SK), "nur Chiffrat");
  const d = JSON.parse(zu.inhalt);
  assert.deepEqual([d.art, d.version, d.oeffentlich], [ERSATZ_ART, 1, kp.pk]);
  assert.ok(istErsatzDatei(zu.inhalt));
  // Zu kurze Passphrase: wie beim Tresor abgewiesen
  await assert.rejects(baueErsatzDatei(SK, kp.pk, "", "kurz"));
});

test("B-28: Widerruf liest Hex oder die Datei mit ihrer Passphrase – sonst nichts", async () => {
  const zu = (await baueErsatzDatei(SK, kp.pk, "", PASS)).inhalt;
  assert.equal(await leseErsatz(zu, PASS), SK);
  assert.equal(await leseErsatz(`  ${SK.toUpperCase()} `), SK, "Hex wie bisher");
  await assert.rejects(leseErsatz(zu, "falsche Passphrase, aber lang genug"));
  assert.equal(await leseErsatz("kein Schlüssel"), null);
  assert.equal(await leseErsatz(JSON.stringify({ art: "etwas-anderes", version: 1, chiffre: "x" }), PASS), null);
  assert.equal(istErsatzDatei("{kaputt"), false);
});

test("B-28: verdrahtet – Passphrase vor dem Erzeugen, Datei über baueErsatzDatei(), Widerruf über leseErsatz() vor fromHex", () => {
  const quelle = readFileSync(new URL("../src/shell/tabs/sicherung.ts", import.meta.url), "utf8");
  const wv = quelle.slice(quelle.indexOf("async function bereiteWechselVor("), quelle.indexOf("async function widerrufeSchluessel("));
  const frage = wv.indexOf('titel: t("set.ersatzPassTitel")');
  assert.ok(frage > 0 && frage < wv.indexOf("generateKeypair()"), "gefragt, bevor ein Schlüssel oder Mandat entsteht");
  assert.match(wv, /if \(verschluesselungMoeglich\(\)\) \{/);
  assert.match(wv, /const datei = await baueErsatzDatei\(th\(ersatz\.sk\), ersatz\.pk, t\("set\.ersatzDatei", \{ privat: th\(ersatz\.sk\), oeffentlich: ersatz\.pk \}\), passphrase \|\| undefined\);/);
  assert.match(wv, /a\.download = datei\.name;/);
  const wr = quelle.slice(quelle.indexOf("async function widerrufeSchluessel("));
  assert.ok(wr.indexOf("await leseErsatz(") > 0 && wr.indexOf("await leseErsatz(") < wr.indexOf("fromHex(ersatzHex)"));
  assert.match(wr, /name: "ersatzPass", label: t\("set\.ersatzPassWiderruf"\), verdeckt: true/);
});
