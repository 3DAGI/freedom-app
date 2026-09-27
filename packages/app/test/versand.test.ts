/**
 * Schritt 6.4: Verkehrsmuster in der App – jede Kopie einer Direktnachricht mit
 * eigener Zufallsverzögerung, Wartendes beim Verlassen sofort, Abrufe im
 * gemeinsamen Takt statt fester Zeitgeber.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LS_VERSAND_VERZOEGERUNG, maxVerzoegerungSek, sendeWartendeSofort, versendeVerzoegert, wartendeSendungen } from "../src/shell/versand.js";

const q = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const speicher = (wert: string | null) => ({ getItem: (k: string) => (k === LS_VERSAND_VERZOEGERUNG ? wert : null) });

test("6.4: Verzögerung – Standard 30 s, nur erlaubte Werte, aus heißt sofort", () => {
  assert.equal(maxVerzoegerungSek(speicher(null)), 30);
  assert.equal(maxVerzoegerungSek(speicher("5")), 5);
  assert.equal(maxVerzoegerungSek(speicher("0")), 0);
  assert.equal(maxVerzoegerungSek(speicher("120")), 120);
  assert.equal(maxVerzoegerungSek(speicher("7")), 30, "unbekannter Wert → Standard");
  assert.equal(maxVerzoegerungSek(speicher("abc")), 30);
});

test("6.4: jede Kopie wartet einzeln; ohne Verzögerung sofort; beim Verlassen alles sofort", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const gesendet: string[] = [];
    const los = (name: string) => async () => { gesendet.push(name); };
    versendeVerzoegert(los("sofort"), 0);
    await Promise.resolve();
    assert.deepEqual(gesendet, ["sofort"]);
    for (const n of ["empfaenger", "selbst", "geraet"]) versendeVerzoegert(los(n), 30);
    // Sehr wahrscheinlich warten alle drei (Verzögerung 0 hat Wahrscheinlichkeit ~1/30001 je Kopie)
    const wartet = wartendeSendungen();
    assert.ok(wartet >= 2, `wartend: ${wartet}`);
    mock.timers.tick(30_001);
    await Promise.resolve();
    assert.deepEqual([...gesendet].sort(), ["empfaenger", "geraet", "selbst", "sofort"]);
    assert.equal(wartendeSendungen(), 0);
    // Verlassen der Seite: Wartendes geht sofort hinaus
    versendeVerzoegert(los("spaet"), 120);
    const n = wartendeSendungen();
    assert.equal(sendeWartendeSofort(), n);
    await Promise.resolve();
    assert.ok(gesendet.includes("spaet") || n === 0);
    assert.equal(wartendeSendungen(), 0);
  } finally {
    mock.timers.reset();
  }
});

test("6.4: Verdrahtung – Direktnachrichten je Kopie verzögert, Abrufe im Takt, beim Verlassen senden, Einstellung", () => {
  const kom = q("../src/shell/tabs/kommunikation.ts");
  assert.match(kom, /versendeVerzoegert\(\(\) => veroeffentlicheDm\(dm\.toRecipient, c\.id\)\.then\(fertig\)\);/);
  assert.match(kom, /versendeVerzoegert\(\(\) => veroeffentlicheDm\(dm\.toSelf, ich\)\.then\(fertig\)\);/);
  // Sofort im eigenen Verlauf, „wird gesendet“, bis beide Kopien hinaus sind; weg, sobald die eigene Kopie zurück ist
  assert.match(kom, /unterwegs\.set\(c\.id, \[\.\.\.\(unterwegs\.get\(c\.id\) \?\? \[\]\), eintrag\]\);/);
  assert.match(kom, /const offen = \(unterwegs\.get\(c\.id\) \?\? \[\]\)\.filter\(\(e\) => !da\.has\(e\.id\)\);/);
  assert.match(kom, /id: dm\.rumorId, pubkey: ich,/);
  assert.match(kom, /for \(const k of dm\.weitere\) versendeVerzoegert\(\(\) => veroeffentlicheDm\(k\.wrap, /);
  assert.doesNotMatch(kom, /await veroeffentlicheDm\(dm\.to(Recipient|Self)/, "nie mehr alle Kopien im selben Augenblick");
  assert.match(kom, /abrufTakt\.melde\("raum", /);
  const app = q("../src/shell/app.ts");
  assert.match(app, /abrufTakt\.melde\("posteingang", posteingangAbgleichen, 2\);\s*starteVerkehr\(\);/);
  assert.doesNotMatch(app, /setInterval\(\(\) => void posteingangAbgleichen\(\)/);
  assert.match(q("../src/shell/streitfall-ui.ts"), /abrufTakt\.melde\("urteile", pruefeUrteile, 4\);/);
  const versand = q("../src/shell/versand.ts");
  assert.match(versand, /addEventListener\("pagehide", \(\) => sendeWartendeSofort\(\)\);/);
  assert.match(versand, /const ms = zufallsVerzoegerung\(maxSek \* 1000\);/);
  assert.match(q("../src/shell/index.html"), /<select id="versand-verzoegerung"[\s\S]*?<option value="30"[^>]*>bis 30 Sekunden \(Standard\)<\/option>/);
});
