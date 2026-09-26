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
  assert.match(kom, /conversations\.find\(\(x\) => x\.type === "dm" && x\.id === r\.partner\)/, "in die Unterhaltung mit dem Partner (seit 2.2b-e2 aus den Mitgliedern, nicht der Einladende)");
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
  assert.match(kom, /Können der Kontakt und eure Geräte MLS, geht deine nächste Nachricht darüber\./, "ehrlicher Hinweis ohne MLS-Gruppe");
});

test("2.2b-d2: Einladung von Fremden wird zur Anfrage – wie eine NIP-17-Nachricht von ihnen", () => {
  assert.match(kom, /c = \{ id: r\.partner, type: "dm", name: "Anfrage · " \+ pkShort\(r\.partner\)/);
});

test("2.2b-e2: Geräte sind Mitglieder – vor jedem Senden abgeglichen; lässt sich das nicht herstellen, NIP-17 (ersetzt d3)", () => {
  const f = kom.slice(kom.indexOf("async function sendeUeberMls("), kom.indexOf("export async function newDm("));
  assert.doesNotMatch(f, /kopienFuer/, "keine pauschale Geräte-Sperre mehr");
  assert.match(f, /if \(r\?\.gruppe\) c\.mls = r\.gruppe;\s*return !!r\?\.gesendet;/);
  const senden = konto.slice(konto.indexOf("export async function mlsSendeAn("));
  assert.match(senden, /if \(!soll\?\.has\(k\.pk\)\) return \{ gesendet: false \};/, "als Gerät ohne gültige Vollmacht nie");
  assert.ok(senden.indexOf("gleicheAb(") < senden.indexOf("sendeInGruppe("), "erst abgleichen, dann senden");
  assert.match(senden, /posteingang: \(pk\) => k\.u\.netz\.posteingang\(soll\.get\(pk\) \?\? pk\)/, "Einladungen an Geräte an den Posteingang der Person");
  assert.match(konto, /partnerDerGruppe\(mls\.mitglieder\(gruppe\), state\.person \?\? pk, pk, u\.geraete\)/);
});

test("2.2b-e2: MLS-Nachrichten von Geräten werden wie NIP-17-Kopien zugeordnet", () => {
  const f = kom.slice(kom.indexOf("async function ladeDmNachrichten("), kom.indexOf("for (const ev of alt)"));
  assert.match(f, /await ordneDmZu\(dm, ich, geraeteBuch, istKontakt, me\.pk\)/);
  assert.match(f, /pubkey: z\.autor/);
});

test("2.2b-e1/e2: In 1:1-Gruppen sind alle Admin – jede Seite darf eigene Geräte aufnehmen und entzogene entfernen", () => {
  assert.match(konto, /gruendeGruppe\(\{ \.\.\.a, name: "", keyPackages: kps, relays, admins: andere \}\)/);
  assert.match(konto, /aendereGruppe\(\{ \.\.\.a, gruppe, einladen: kps, admins: fehlen \}\)/);
});
