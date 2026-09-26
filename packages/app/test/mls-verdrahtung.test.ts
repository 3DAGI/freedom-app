/**
 * Verdrahtung von Schritt 2.2b-d1: Das MLS-Konto hängt an den richtigen Stellen
 * im Chat – und nur dort, wo es gebraucht wird (die Engine lädt nie beim Start).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const kom = readFileSync(new URL("../src/shell/tabs/kommunikation.ts", import.meta.url), "utf8");
const konto = readFileSync(new URL("../src/shell/mls-konto.ts", import.meta.url), "utf8");

test("2.2b-d1: KeyPackage erst beim Öffnen einer 1:1-Unterhaltung", () => {
  assert.match(kom, /if \(c\?\.type === "dm"\) void mlsErreichbar\(\)/);
  assert.equal(kom.match(/mlsErreichbar\(/g)?.length, 1, "nirgends sonst – etwa nicht beim Abgleich im Hintergrund");
});

test("2.2b-d1: Einladungen nur aus Umschlägen, die keine DM sind; Gruppen nur, wenn es welche gibt", () => {
  assert.match(kom, /if \(!e\) await alsMlsEinladung\(w\);/);
  assert.match(kom, /conversations\.find\(\(x\) => x\.type === "dm" && x\.id === e\.von\)/, "vom Kontakt: in dessen Unterhaltung");
  assert.match(kom, /if \(mitMls\.length > 0 && !mlsGesperrt\(\)\) \{\s*const zahlen = await mlsAbgleichen\(/);
});

test("2.2b-d1/e1: gesperrt mit Bunker und ohne Tresor, als Gerät nicht; der rohe Schlüssel nur für den Kontobeweis", () => {
  assert.match(konto, /if \(mitBunker\(\)\) return /);
  assert.match(konto, /if \(!tresorEingerichtet\(\)\) return "nur mit Tresor/);
  assert.doesNotMatch(konto, /alsGeraet\(\)/, "als Gerät ein eigenes Konto (Entscheidung 2.2b-e: A)");
  assert.deepEqual([...konto.matchAll(/mitRohemSchluessel\("([^"]+)"/g)].map((m) => m[1]), ["MLS-Kontobeweis"]);
  assert.match(konto, /new MlsZustand\(u\.zustand\(\), schluessel, pk\)/, "an die Identität gebunden");
});

test("2.2b-d2: Senden erst über MLS, sonst NIP-17; mit Ablauf, Bunker oder ohne Tresor nie MLS", () => {
  assert.match(kom, /if \(c\.type === "dm" && \(await sendeUeberMls\(c, /);
  assert.match(kom, /\} else if \(c\.type === "dm"\) \{\s*\/\/ NIP-17/, "der NIP-17-Pfad bleibt als Rückfall");
  assert.match(kom, /if \(c\.ablaufSecs \|\| mlsGesperrt\(\)\) return false;/);
  assert.match(kom, /Kann der Kontakt MLS und hat keiner von euch Geräte, geht deine nächste Nachricht darüber\./, "ehrlicher Hinweis ohne MLS-Gruppe");
});

test("2.2b-d2: Einladung von Fremden wird zur Anfrage – wie eine NIP-17-Nachricht von ihnen", () => {
  assert.match(kom, /c = \{ id: e\.von, type: "dm", name: "Anfrage · " \+ pkShort\(e\.von\)/);
});

test("2.2b-d3: Mit Geräten auf einer Seite (oder wenn das unklar ist) bleibt es bei NIP-17 – jedes Gerät bekommt seine Kopie", () => {
  const f = kom.slice(kom.indexOf("async function sendeUeberMls("), kom.indexOf("export async function newDm("));
  assert.match(f, /\[c\.id, ich\]\.map\(\(pk\) => geraeteBuch\.kopienFuer\(pk\)\.catch\(\(\) => null\)\)/);
  assert.match(f, /if \(geraete\.some\(\(g\) => g === null \|\| g\.length > 0\)\) return false;/);
  assert.ok(f.indexOf("kopienFuer") < f.indexOf("mlsSendeAn("), "vor jedem MLS-Versuch");
});

test("2.2b-e1: In 1:1-Gruppen ist auch der Kontakt Admin – jeder darf eigene Geräte aufnehmen und entzogene entfernen", () => {
  assert.match(konto, /gruendeGruppe\(\{[^}]*admins: \[kp\.pubkey\] \}\)/);
});
