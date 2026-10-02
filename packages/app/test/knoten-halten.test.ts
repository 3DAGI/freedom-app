/**
 * Halten bei meinem Knoten in der App (B-9b2, L4 A): Nach jedem
 * verschlüsselten Upload bittet die App den gekoppelten Knoten – nur mit
 * Haken –, den Blob zu halten. Die Antwort zeigt sie nur als Text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HALTEN_MAX_POW, LS_HALTEN, ablehnungsGrund, halteErgebnis, haltenAn } from "../src/knoten-halten.js";
import { settings } from "../src/texte/settings.js";

const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const speicher = (w: string | null) => ({ getItem: (k: string) => (k === LS_HALTEN ? w : null) });

test("B-9b2: Haken – Standard an, nur „0“ heißt aus; die Antwort heißt „alle“ nur bei jedem Stück", () => {
  assert.equal(LS_HALTEN, "freedom.knoten.halten");
  assert.equal(haltenAn(speicher(null)), true, "wer koppelt, will halten");
  assert.equal(haltenAn(speicher("1")), true);
  assert.equal(haltenAn(speicher("0")), false);
  assert.deepEqual(halteErgebnis({ gehalten: 24, noetig: 16, gesamt: 24 }), { art: "alle", gehalten: 24, gesamt: 24 });
  assert.deepEqual(halteErgebnis({ gehalten: 23, noetig: 16, gesamt: 24 }), { art: "teilweise", gehalten: 23, gesamt: 24 });
  assert.deepEqual(halteErgebnis({ gehalten: 0, noetig: 16, gesamt: 24 }), { art: "keins", gehalten: 0, gesamt: 24 });
  assert.equal(ablehnungsGrund("error: Halten nur für den Besitzer"), "Halten nur für den Besitzer");
  assert.equal(ablehnungsGrund("error: " + "x".repeat(500)).length, 120, "gekürzt");
  assert.equal(HALTEN_MAX_POW, 16, "dieselbe Grenze wie MAX_POW_APP");
  assert.match(lies("shell/tabs/agent.ts"), /const MAX_POW_APP = 16;/);
});

test("B-9b2: halteBeiMeinemKnoten – nur gekoppelt und mit Haken, an genau das Manifest, Ergebnis nur als Text", () => {
  const mk = lies("shell/knoten-halten-ui.ts");
  const fn = mk.slice(mk.indexOf("export async function halteBeiMeinemKnoten("), mk.indexOf("export function wireKnotenHalten("));
  const tor = fn.indexOf("if (!k || !haltenAn(localStorage)) return;");
  // seit B-9c2 ist der erste Schritt ins Netz der Weg zum Knoten (sein Relay oder der Pool)
  assert.ok(tor > 0 && tor < fn.indexOf("wegZumKnoten("), "ungekoppelt oder ohne Haken geht nichts hinaus");
  assert.match(fn, /const sitzung = new LocalSigner\(generateKeypair\(\)\.sk\);/, "ein frischer Sitzungsschlüssel, nie die Identität");
  assert.match(fn, /baueHalteAuftrag\(\{ sitzung, kopplung: k, blobId: r\.blobId, manifestId: r\.manifestEventId, powBits \}\)/);
  assert.match(fn, /angebot\.powBits <= HALTEN_MAX_POW \? angebot\.powBits : 0/);
  assert.doesNotMatch(fn, /signiere\(|state\.keypair/, "nie mit der Identität signiert");
  // Nur feste Texte, die Zahlen aus leseHalteAntwort(); der Grund einer Ablehnung gekürzt als Text
  assert.match(fn, /const gelesen = leseHalteAntwort\(antwort\.ergebnis\);\s*if \(!gelesen\) return toast\(t\("set\.knotenHaltenSchweigt"\), true\);/);
  for (const aufruf of fn.match(/toast\([^;]*\);/g) ?? []) assert.match(aufruf, /^toast\(t\(/, aufruf);
  const warten = mk.slice(mk.indexOf("async function warteAufHalten("), mk.indexOf("export async function halteBeiMeinemKnoten("));
  assert.match(warten, /if \(!a\.ok \|\| getTag\(a\.response, "e"\) !== requestId\) continue;/, "nur die Antwort auf genau diesen Auftrag");
  assert.match(warten, /return \{ abgelehnt: ablehnungsGrund\(a\.response\.content\) \};/);
  assert.doesNotMatch(warten, /setInterval/, "kein neuer Takt fürs Netz – nur während des Wartens");
  // Der Haken: nur gekoppelt zu sehen (mein-knoten.ts, nur DOM), gemerkt als „1“/„0“ (knoten-halten-ui.ts)
  assert.match(lies("shell/mein-knoten.ts"), /document\.getElementById\("knoten-halten-zeile"\)\?\.toggleAttribute\("hidden", !k\);/);
  assert.match(mk, /localStorage\.setItem\(LS_HALTEN, halten\.checked \? "1" : "0"\)/);
  assert.match(lies("shell/app.ts"), /wireMeinKnoten\(\);\n\s*wireKnotenHalten\(\);/);
  const html = lies("shell/index.html");
  assert.match(html, /<label id="knoten-halten-zeile"[^>]* hidden><input type="checkbox" id="knoten-halten" \/> <span data-i18n="set\.knotenHalten">/, "Häkchen im Label, ungekoppelt versteckt");
  for (const k of ["set.knotenHalten", "set.knotenHaltenAlle", "set.knotenHaltenTeil", "set.knotenHaltenKeins", "set.knotenHaltenSchweigt", "set.knotenHaltenAbgelehnt", "set.knotenHaltenFehler"]) {
    assert.ok(settings[k]?.de && settings[k]?.en, k);
  }
});

test("B-9b2: nach jedem verschlüsselten Upload – Bundles und Anhänge, nie die Kopie nur auf dem Gerät", () => {
  const blob = lies("blob-client.ts");
  assert.match(blob, /return \{ blobId: res\.blobId, manifestEventId: res\.manifestEventId, schluessel \};/, "uploadAnhang nennt das Manifest");
  const repos = lies("shell/tabs/repos.ts");
  const hoch = repos.slice(repos.indexOf("export async function ladeBundleHoch("), repos.indexOf("async function veroeffentlicheLokal("));
  const halten = hoch.indexOf("void halteBeiMeinemKnoten(res);");
  assert.ok(halten > hoch.indexOf("await uploadAnhang("), "erst hochgeladen");
  assert.ok(halten > hoch.indexOf("if (lokal) {") && hoch.indexOf("if (lokal) {") < hoch.indexOf("return true;"), "die Kopie nur auf dem Gerät kehrt vorher zurück");
  assert.ok(hoch.slice(hoch.indexOf("if (lokal) {"), hoch.indexOf("const { uploadAnhang }")).indexOf("halteBeiMeinemKnoten") < 0, "lokal geht nichts hinaus");
  const komm = ["kommunikation", "chat-anhaenge", "kontakte", "posteingang"].map((d) => lies(`shell/tabs/${d}.ts`)).join("\n");
  const anhang = komm.indexOf("const res = await uploadAnhang(file, pool as never, state.signer!);");
  assert.ok(anhang > 0 && komm.indexOf("void halteBeiMeinemKnoten(res);", anhang) > anhang, "auch Chat-Anhänge");
});
