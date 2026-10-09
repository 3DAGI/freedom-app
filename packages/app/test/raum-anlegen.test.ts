/**
 * Schritt B-26 (Nutzertest 08.10., Befunde R-6, R-5): Einen Raum anlegen geht
 * ohne Umweg. „+“ in der Leiste fragt erst privat oder öffentlich – vorher legte
 * es nur private an, und „öffentlich“ stand nur im Menü eines offenen Raums.
 * Privat ohne Tresor sagt die App das vor dem Namen und bietet den Tresor an,
 * statt nach dem Namen zu scheitern. Den Ablauf im Browser prüft der Smoke-Test
 * („raum_anlegen“).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const raeume = quelle("../src/shell/tabs/raeume.ts");
const komm = quelle("../src/shell/tabs/kommunikation.ts");
const block = (von: string): string => raeume.slice(raeume.indexOf(von), raeume.indexOf("\n}\n", raeume.indexOf(von)));

test("B-26: „+“ wählt die Art – an genau einer Stelle verdrahtet, danach der Name wie aus dem Menü", () => {
  assert.match(raeume, /document\.getElementById\("rail-create"\)\?\.addEventListener\("click", \(\) => void waehleRaumArt\(\)\);/);
  assert.doesNotMatch(komm, /rail-create/, "nicht mehr über #space-create (nur privat)");
  const wahl = block("async function waehleRaumArt(");
  assert.match(wahl, /\{ art: "wahl", name: "art", label: t\("raum\.art"\), pflicht: true, wert: gesperrt \? "offen" : "privat"/);
  // Der Hinweis verspricht den Tresor nur, wo er hilft – sonst nennt er den Grund
  assert.match(wahl, /hinweis: !gesperrt \? t\("komm\.privatTitel"\) : nurTresorFehlt\(\) \? t\("raum\.privatOhneTresor"\) : gesperrt/);
  assert.match(wahl, /if \(!w\) return;\s*await legeRaumAn\(w\.art === "offen"\);/);
  assert.doesNotMatch(wahl, /name: "name"/, "den Namen fragt legeRaumAn() – nie zweimal");
});

test("B-26: privat ohne Tresor – erst sagen und anbieten, dann nach dem Namen fragen", () => {
  const moeglich = block("async function privatMoeglich(");
  assert.match(moeglich, /const gesperrt = mlsGesperrt\(\);\s*if \(!gesperrt\) return true;/);
  // Nur der fehlende Tresor ist hier zu beheben – mit Bunker oder ohne Identität nur der Grund
  assert.match(moeglich, /if \(!nurTresorFehlt\(\)\) \{\s*await hinweis\(t\("komm\.anlegenPrivat"\), gesperrt\);\s*return false;/);
  assert.match(raeume, /const nurTresorFehlt = \(\): boolean => !!mlsGesperrt\(\) && !tresorEingerichtet\(\) && !!state\.signer && !mitBunker\(\);/);
  assert.match(moeglich, /return \(await richteTresorEin\(\)\) && !mlsGesperrt\(\);/);
  const anlegen = block("async function legeRaumAn(");
  const pruefen = anlegen.indexOf("if (!oeffentlich && !(await privatMoeglich())) return;");
  assert.ok(pruefen > 0 && pruefen < anlegen.indexOf("await dialog("), "vor dem Dialog mit dem Namen");
});
