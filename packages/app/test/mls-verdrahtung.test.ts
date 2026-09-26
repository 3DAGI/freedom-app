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

test("2.2b-d1: gesperrt mit Bunker und als Gerät; der rohe Schlüssel nur für den Kontobeweis", () => {
  assert.match(konto, /if \(mitBunker\(\)\) return /);
  assert.match(konto, /if \(alsGeraet\(\)\) return /);
  assert.deepEqual([...konto.matchAll(/mitRohemSchluessel\("([^"]+)"/g)].map((m) => m[1]), ["MLS-Kontobeweis"]);
  assert.match(konto, /new MlsZustand\(u\.zustand\(\), schluessel, pk\)/, "an die Identität gebunden");
});

test("2.2b-d2: Senden erst über MLS, sonst NIP-17; mit Ablauf, Bunker oder als Gerät nie MLS", () => {
  assert.match(kom, /if \(c\.type === "dm" && \(await sendeUeberMls\(c, /);
  assert.match(kom, /\} else if \(c\.type === "dm"\) \{\s*\/\/ NIP-17/, "der NIP-17-Pfad bleibt als Rückfall");
  assert.match(kom, /if \(c\.ablaufSecs \|\| mlsGesperrt\(\)\) return false;/);
  assert.match(kom, /Kann der Kontakt MLS, geht deine nächste Nachricht darüber\./, "ehrlicher Hinweis ohne MLS-Gruppe");
});

test("2.2b-d2: Einladung von Fremden wird zur Anfrage – wie eine NIP-17-Nachricht von ihnen", () => {
  assert.match(kom, /c = \{ id: e\.von, type: "dm", name: "Anfrage · " \+ pkShort\(e\.von\)/);
});
