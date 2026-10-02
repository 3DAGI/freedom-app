/**
 * Datenexport (B-6): was hineinkommt und was nie, verschlüsselt wie der
 * Tresor, beim Einlesen gefiltert – auch eine fremde oder veränderte Datei
 * bringt keinen Schlüssel zurück.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang } from "../src/i18n.js";
import { EXPORT_ART, EXPORT_MAX_BYTES, EXPORT_ZUSAETZLICH, baueExport, exportDateiname, filtereExport, leseExport, waehleExport } from "../src/datenexport.js";
import { verschluesseleMitPassphrase } from "../src/vault.js";

const PASS = "richtig-langes-passwort";
const lokal: Record<string, string> = {
  "freedom.chats": JSON.stringify([{ id: "a".repeat(64), name: "Alice Muster" }]),
  "freedom.petnames": JSON.stringify({ ["b".repeat(64)]: "Bob Beispiel" }),
  "freedom.lang": "de",
  "freedom.agentHistory": JSON.stringify([{ id: "1", title: "Frage zum Wetter" }]),
  "freedom.quittungen": JSON.stringify([{ provider: "c".repeat(64) }]),
  "freedom.kontakte.geprueft": JSON.stringify({ ["b".repeat(64)]: 1_800_000_000 }),
  // nie in den Export:
  "freedom.nsec": "nsec1geheim",
  "freedom.nwc.uri": "nostr+walletconnect://geheim",
  "freedom.kanaele": "[]",
  "freedom.mls.schluessel": "geheim",
  "freedom.nachfolge": "{}",
  "freedom.solWallet": "geheim",
  "freedom.htlc.x": "preimage",
  "freedom.merkphrase": "zwoelf woerter",
  "fremd.eintrag": "x",
};
const lese = (k: string) => lokal[k] ?? null;
const NIE = ["freedom.nsec", "freedom.nwc.uri", "freedom.kanaele", "freedom.mls.schluessel", "freedom.nachfolge", "freedom.solWallet", "freedom.htlc.x", "freedom.merkphrase", "fremd.eintrag"];

test("B-6: Export – Sicherung plus KI-Verläufe und Quittungen, nie Schlüssel, Zugänge oder Geld-Geheimnisse", () => {
  const daten = waehleExport(Object.keys(lokal), lese);
  for (const k of ["freedom.chats", "freedom.petnames", "freedom.lang", "freedom.agentHistory", "freedom.quittungen", "freedom.kontakte.geprueft"]) {
    assert.equal(daten[k], lokal[k], k);
  }
  for (const k of NIE) assert.ok(!(k in daten), `nie: ${k}`);
  assert.deepEqual([...EXPORT_ZUSAETZLICH], ["freedom.agentHistory", "freedom.quittungen"]);
});

test("B-6: hin und zurück – gleiche Daten, Zeit und Kennung in der Hülle, kein Klartext", async () => {
  const daten = waehleExport(Object.keys(lokal), lese);
  const datei = await baueExport(daten, PASS, 1_800_000_000);
  const huelle = JSON.parse(datei) as { art: string; v: number; zeit: number; tresor: string };
  assert.equal(huelle.art, EXPORT_ART);
  assert.equal(huelle.v, 1);
  assert.equal(huelle.zeit, 1_800_000_000);
  // mit Leerzeichen: „Bob“ allein steht in ~0,3 % der Läufe zufällig im Base64-Chiffrat (so in C-1e gesehen, wie B-8b beim MLS-Test)
  for (const w of ["Alice Muster", "Bob Beispiel", "Frage zum Wetter"]) assert.ok(!datei.includes(w), `kein Klartext: ${w}`);
  const zurueck = await leseExport(datei, PASS);
  assert.deepEqual(zurueck, { daten, zeit: 1_800_000_000 });
});

test("B-6: falsche Passphrase, veränderte Datei, fremde Datei – Meldung statt Daten", async () => {
  setLang("de");
  const datei = await baueExport({ "freedom.lang": "de" }, PASS);
  await assert.rejects(leseExport(datei, "falsches-passwort-123"), { name: "FalschePassphrase" });
  const h = JSON.parse(datei) as { tresor: string };
  const t = JSON.parse(h.tresor) as { ct: string };
  const kaputt = JSON.stringify({ ...JSON.parse(datei), tresor: JSON.stringify({ ...JSON.parse(h.tresor), ct: (t.ct[0] === "A" ? "B" : "A") + t.ct.slice(1) }) });
  await assert.rejects(leseExport(kaputt, PASS), { name: "FalschePassphrase" });
  await assert.rejects(leseExport("{kein json", PASS), /keine Export-Datei von FreedomStack/);
  await assert.rejects(leseExport(JSON.stringify({ art: "anderes", v: 1, zeit: 1, tresor: h.tresor }), PASS), /keine Export-Datei/);
  await assert.rejects(leseExport(JSON.stringify({ ...JSON.parse(datei), v: 2 }), PASS), /keine Export-Datei/);
  await assert.rejects(leseExport("x".repeat(EXPORT_MAX_BYTES + 1), PASS), /zu groß/);
  await assert.rejects(baueExport({}, "kurz"), /mindestens|at least/);
});

test("B-6: eine untergeschobene Datei mit Schlüsseln bringt keinen zurück", async () => {
  // Jemand baut eine Datei mit bekannter Passphrase und legt Schlüssel und Zugänge hinein
  const boese = JSON.stringify({ art: EXPORT_ART, v: 1, zeit: 1, tresor: await verschluesseleMitPassphrase(JSON.stringify({ ...lokal, "freedom.lang": "en" }), PASS) });
  const { daten } = await leseExport(boese, PASS);
  for (const k of NIE) assert.ok(!(k in daten), `nie: ${k}`);
  assert.equal(daten["freedom.lang"], "en");
  assert.deepEqual(filtereExport({ "freedom.chats": 5, "freedom.agentHistory": { nicht: "text" } }), {}, "nur Text");
});

test("B-6: Dateiname mit Datum, ohne Namen oder Schlüssel", () => {
  assert.equal(exportDateiname(1_800_000_000), "freedom-export-2027-01-15.json");
});

test("B-6: verdrahtet – Knöpfe in der Sicherung, Passphrase verdeckt, eingelesen erst nach Rückfrage", () => {
  const lies = (pfad: string) => readFileSync(new URL(`../src/${pfad}`, import.meta.url), "utf8");
  const html = lies("shell/index.html");
  assert.match(html, /<button id="export-datei" [^>]*data-i18n="set\.exportDatei">/);
  assert.match(html, /<button id="export-einlesen" [^>]*data-i18n="set\.exportEinlesen">/);
  assert.match(html, /<input type="file" id="export-file" accept="\.json,application\/json" style="display:none" \/>/);
  const s = ["settings", "sicherung", "mesh"].map((d) => lies(`shell/tabs/${d}.ts`)).join("\n");
  assert.match(s, /if \(ex\) ex\.onclick = \(\) => void exportiereDaten\(\);/);
  assert.match(s, /const daten = waehleExport\(alle, \(k\) => \(istGeheimnis\(k\) \? geheim\.getItem\(k\) : localStorage\.getItem\(k\)\)\);/, "jeder Wert aus seinem Speicher");
  const einlesen = s.slice(s.indexOf("async function leseExportDatei("), s.indexOf("async function leseExportDatei(") + 1500);
  assert.ok(einlesen.indexOf("await bestaetige(") < einlesen.indexOf("geheim.setItem(k, v)"), "erst fragen, dann schreiben");
  assert.match(einlesen, /const \{ daten, zeit \} = await leseExport\(await datei\.text\(\), String\(w\.pass\)\);/, "nur gefilterte Daten");
  assert.match(s, /\{ name: "pass", label: t\("set\.exportPass"\), art: "text", pflicht: true, verdeckt: true \}/);
  // Seit B-15b kommen Datum und Uhrzeit dazu – verdeckt bleibt vorn
  assert.match(lies("shell/dialog.ts"), /e\.type = "verdeckt" in f && f\.verdeckt \? "password" : "typ" in f && f\.typ \? f\.typ : "text";/);
});
