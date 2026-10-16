/**
 * RM2c2: Cashu-Pfand im echten Pfad. Ohne Kanal und nicht beim eigenen Knoten trägt die Anfrage – wenn das Angebot die
 * Mint des Topfs nennt – gesperrte Token im versiegelten Kern statt einer Sitzung; gedeckt ist der Anteil des Providers
 * (wie der Knoten rechnet). Gemerkt vor dem Senden, gebucht nach der Antwort, Lightning zahlt ihn dann nie. Nie im
 * Max-Modus, nie in Prüfrunden, kein Rückfall auf einen zweiten Provider; der Abruftakt holt nach der Frist zurück.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lies = (pfad: string) => readFileSync(new URL(`../src/${pfad}`, import.meta.url), "utf8");

test("Anfrage: Pfand nur ohne Kanal, eigenen Knoten, Max-Modus und Prüfrunde – im Kern, vor dem Versiegeln, gemerkt vor dem Senden", () => {
  const agent = lies("shell/tabs/agent.ts");
  const bau = agent.slice(agent.indexOf("async function buildJobEvent("), agent.indexOf("/** Abbruch-Signal"));
  assert.match(bau, /const pfand = eigen \|\| kanal \|\| o\.ohnePfand \|\| zusatzTags\.some\(\(t\) => t\[0\] === "race"\) \? undefined\s*: await pfandFuerAnfrage\(targetPubkey, sitzung\.publicKey\(\), empfaenger, hoechst\);/);
  // Tags im Kern: vor buildJobRequest/buildEvent, also vor dem Versiegeln
  assert.ok(bau.indexOf("pfand?.tags") < bau.indexOf("buildJobRequest({"), "Tags vor dem Bau der Anfrage");
  assert.match(bau, /const useSession = !eigen && !kanal && !pfand && sc\.activeFor/, "mit Pfand keine Sitzung");
  assert.match(bau, /if \(pfand\) await pfand\.merke\(auftrag\.requestId\);[\s\S]*return auftrag;/, "gemerkt, bevor der Aufrufer sendet");
  assert.match(lies("shell/pruefrunde-lauf.ts"), /buildJobEvent\(p\.prompt, p\.bid, p\.tier, pk, p\.sc, \[\], undefined, \{ ohnePfand: true \}\)/);
  assert.match(lies("shell/tabs/agent-wege.ts"), /const stumm = !letztes && !perKanal\(requestId\) && !perPfand\(requestId\);/, "kein zweiter Provider mit eigenem Pfand");
});

test("Antwort: per Pfand nur buchen – vor der Sitzung, Lightning zahlt den Anteil des Providers nie; übrige Anteile wie bisher", () => {
  const agent = lies("shell/tabs/agent.ts");
  const antwort = agent.slice(agent.indexOf("async function handleAnswer("), agent.indexOf("/** Send-Button nach Job-Ende"));
  const pfand = antwort.indexOf("if (perPfand(r.requestId)) {");
  assert.ok(pfand > 0 && pfand < antwort.indexOf("providerZahlung(r.providerPubkey)") && pfand < antwort.indexOf("chargeForResult("));
  const block = antwort.slice(pfand, antwort.indexOf("const sc = ensureSessionClient();"));
  assert.match(block, /await pfandAntwort\(r\.requestId, abrechnung\.providerMsat\);/);
  assert.match(block, /void zahleAnteile\(\)/);
  assert.match(block, /return;\s*\}\s*$/);
});

test("Baustein: Bedarf wie der Knoten, nur die Mint des Topfs, ohne Pfand wie bisher; Topf nur über geheim und offenen Tresor; im Abruftakt", () => {
  const kp = lies("shell/ki-pfand.ts");
  assert.match(kp, /export const cashuTopf = new CashuTopf\(geheim, \{ tresorOffen \}\);/);
  assert.match(kp, /if \(!cashu \|\| !cashu\.mints\.includes\(mint\)\) return undefined;/);
  assert.match(kp, /const bedarfMsat = providerAnteilMsat\(hoechstMsat, zahlbareAnteile\(empfaenger, "lightning"\)\);/, "dieselbe Rechnung wie die Deklaration und der Knoten");
  assert.match(kp, /pfandTags\(p\.pfand\)/);
  assert.match(kp, /\} catch \{[^}]*return undefined;/, "zu wenig, keine Mint, Netz: ohne Pfand wie bisher – nie ein Fehler nur deshalb");
  assert.match(kp, /if \(cashuTopf\.laufend\(\)\) await cashuTopf\.nachholen\(\);\s*await cashuTopf\.holePfandZurueck\(\);/);
  assert.match(lies("shell/app.ts"), /abrufTakt\.melde\("pfand", \(\) => import\("\.\/ki-pfand\.js"\)\.then\(\(p\) => p\.pfandTakt\(\)\), 20\);/);
  assert.match(lies("shell/tresor.ts"), /export function tresorOffen\(\): boolean \{\s*return tresorEingerichtet\(\) && !!tresor && !tresor\.locked;/);
});
