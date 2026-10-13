/**
 * Schritt 11.3e1: „Agent hinzufügen“ im Raum – neu oder vorhanden, mit Budget je
 * Monat und Tag in sats oder SOL (Entwurf `docs/AGENTEN-RAUM-ENTWURF.md` P2, P5, F3 B).
 * Erst der Tresor, ehrlich vorher (Gerät muss offen sein, ich zahle auch für andere),
 * nur als Hauptidentität – privat als Moderator, offen mit „rollen_vergeben“.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { budgetText, leseBudgetEingabe, verbraucht } from "../src/raum-agent-budget.js";

const lies = (pfad: string) => readFileSync(new URL(`../src/${pfad}`, import.meta.url), "utf8");

test("Budget in sats: ganze Zahlen ab 1, gespeichert in msat", () => {
  assert.deepEqual(leseBudgetEingabe({ einheit: "msat", monat: "2000", tag: " 200 " }), { ok: true, budget: { einheit: "msat", monat: 2_000_000, tag: 200_000 } });
  assert.deepEqual(leseBudgetEingabe({ einheit: "msat", monat: "50", tag: "50" }), { ok: true, budget: { einheit: "msat", monat: 50_000, tag: 50_000 } }, "Tag gleich Monat geht");
  for (const unfug of ["", "0", "-5", "1.5", "1e3", "abc", "1 000", "9999999999999"]) {
    assert.deepEqual(leseBudgetEingabe({ einheit: "msat", monat: unfug, tag: "1" }), { ok: false, fehler: "monat" }, `Monat ${unfug}`);
    assert.deepEqual(leseBudgetEingabe({ einheit: "msat", monat: "100", tag: unfug }), { ok: false, fehler: "tag" }, `Tag ${unfug}`);
  }
  assert.deepEqual(leseBudgetEingabe({ einheit: "msat", monat: "100", tag: "101" }), { ok: false, fehler: "tag-groesser" });
});

test("Budget in SOL: ohne Gleitkomma in Lamports, ohne Kurs – nie als sats gelesen", () => {
  assert.deepEqual(leseBudgetEingabe({ einheit: "lamports", monat: "0.01", tag: "0.001" }), { ok: true, budget: { einheit: "lamports", monat: 10_000_000, tag: 1_000_000 } });
  assert.deepEqual(leseBudgetEingabe({ einheit: "lamports", monat: "2000", tag: "200" }), { ok: true, budget: { einheit: "lamports", monat: 2_000_000_000_000, tag: 200_000_000_000 } }, "eingetippte Zahl ist SOL – darum ist das Feld leer vorbelegt");
  for (const unfug of ["", "0", "0.0000000001", "1,5", "-0.1", "abc"]) {
    assert.deepEqual(leseBudgetEingabe({ einheit: "lamports", monat: unfug, tag: "0.001" }), { ok: false, fehler: "monat" }, `Monat ${unfug}`);
  }
  assert.deepEqual(leseBudgetEingabe({ einheit: "lamports", monat: "0.001", tag: "0.002" }), { ok: false, fehler: "tag-groesser" });
});

test("Ablauf: Tresor vor dem Gerät, vorhandene ohne diesen Raum, neu mit Grenzen, Budget leer vorbelegt, dann einladen", () => {
  const ui = lies("shell/raum-agenten-ui.ts");
  const ablauf = ui.slice(ui.indexOf("export async function agentHinzufuegen("));
  const i = (s: string) => { const n = ablauf.indexOf(s); assert.ok(n >= 0, s); return n; };
  assert.match(ablauf, /const vorhanden = tresorEingerichtet\(\) \? agentenBuch\.alle\(\)\.filter\(\(a\) => !a\.raeume\.some\(\(r\) => r\.raum === raum\)\) : \[\];/, "das Buch liegt im Tresor; wer schon im Raum ist, steht nicht zur Wahl");
  // Ein Agent auf einem Knoten (11.3e4) braucht keinen Tresor – einer auf dem Gerät schon, vor dem Anlegen
  assert.ok(i("if (wahl === KNOTEN) return knotenAgentAufnehmen(ziel);") < i('if (!(await verlangeTresor(t("agentRaum.wofuer")))) return false;'));
  assert.ok(i('if (!(await verlangeTresor(t("agentRaum.wofuer")))) return false;') < i("await legeGeraeteAgentAn(daten)"));
  assert.ok(i("await legeGeraeteAgentAn(daten)") < i("await ladeAgentInOffenenRaum(pk, ziel.adresse, b);"));
  assert.match(ablauf, /const r = await ladeAgentInPrivatenRaum\(pk, ziel\.privat, b\);\s*if \(r !== "eingeladen"\) throw new Error\(einladungsText\(r\)\);/);
  // Budget: Einheit nach der Schiene für KI, Beträge ohne Vorgabe – nie sats-Zahlen als SOL
  const budget = ui.slice(ui.indexOf("async function budget("), ui.indexOf("export async function agentHinzufuegen("));
  assert.match(budget, /wert: kiSchiene\(\) === "solana" \? "lamports" : "msat"/);
  assert.match(budget, /\{ art: "text", name: "monat", label: t\("agentUi\.monat"\), pflicht: true, mono: true \}/);
  assert.match(budget, /\{ art: "text", name: "tag", label: t\("agentUi\.tag"\), pflicht: true, mono: true \}/);
  assert.match(budget, /offen \? `\\n\\n\$\{t\("agentUi\.budgetOffen"\)\}` : ""/, "offener Raum: jeder kann fragen, auf meine Kosten");
  // Neue Agenten in den Grenzen des Buchs
  assert.match(ui, /laenge\(wert\(w, "persona"\)\) > AGENTEN_BUCH_GRENZEN\.persona/);
  assert.match(ui, /laenge\(wert\(w, "name"\)\) > AGENT_GRENZEN\.name/);
});

test("Verdrahtet: Menüpunkt nur, wer darf – Hauptidentität, privat Moderator, offen „rollen_vergeben“", () => {
  const raeume = lies("shell/tabs/raeume.ts");
  const ziel = raeume.slice(raeume.indexOf("function agentZiel("), raeume.indexOf("/** Darf ich in diesem offenen Raum Kanäle anlegen"));
  assert.match(ziel, /if \(!state\.keypair \|\| alsGeraet\(\)\) return null;/);
  assert.match(ziel, /if \(raum\) return raum\.admins\.includes\(raum\.ich\) \? \{ privat: raum \} : null;/);
  assert.match(ziel, /darf\(state\.keypair\.pk, "rollen_vergeben", st\) \? \{ adresse: ziel\.adresse \} : null/);
  assert.match(raeume, /document\.getElementById\("space-agent-neu"\)\?\.classList\.toggle\("hidden", !agenten\);/);
  assert.match(raeume, /if \(ziel\) void import\("\.\.\/raum-agenten-ui\.js"\)\.then\(async \(m\) => \{ if \(\(await m\.agentHinzufuegen\(ziel\)\) && spacesUi\.spaceId\) await oeffneRaum\(spacesUi\.spaceId\); \}\);/);
  assert.match(lies("shell/index.html"), /<button id="space-agent-neu" class="menue-punkt hidden" role="menuitem" type="button" data-i18n="agentUi\.menue">Agent hinzufügen<\/button>/);
});

test("11.3e2: Budget als Text in seiner Einheit, Verbrauch nur im laufenden Monat und Tag", () => {
  assert.equal(budgetText(2_000_000, "msat"), "2000");
  assert.equal(budgetText(1_500, "msat"), "1", "angefangene sats abgerundet");
  assert.equal(budgetText(10_000_000, "lamports"), "0.01");
  for (const [text, einheit] of [["2000", "msat"], ["0.000123456", "lamports"]] as const) {
    const r = leseBudgetEingabe({ einheit, monat: text, tag: text });
    assert.ok(r.ok);
    assert.equal(budgetText(r.budget.monat, einheit), text, "hin und zurück gleich");
  }
  const jetzt = Date.UTC(2026, 9, 13, 12) / 1000;
  assert.deepEqual(verbraucht({ imMonat: { zeit: "2026-10", wert: 700 }, amTag: { zeit: "2026-10-13", wert: 70 } }, jetzt), { monat: 700, tag: 70 });
  assert.deepEqual(verbraucht({ imMonat: { zeit: "2026-09", wert: 700 }, amTag: { zeit: "2026-10-12", wert: 70 } }, jetzt), { monat: 0, tag: 0 }, "Vergangenes zählt nicht");
});

test("11.3e2 verdrahtet: Kennzeichen und Name aus der Karte, eigene Agenten mit Budget und herausnehmen, fremde ohne Direktnachricht", () => {
  const raeume = lies("shell/tabs/raeume.ts");
  const liste = raeume.slice(raeume.indexOf("async function zeigeMitglieder("), raeume.indexOf("/** Menü eines Mitglieds"));
  assert.match(liste, /const karten = new Map\(\(privat \? raumAgentKarten\(privat\.ereignisse\) : spacesUi\.agentKarten\)\.map/);
  assert.match(liste, /rollen\.filter\(\(r\) => !\(r === "agent" && karten\.has\(pk\)\)\)/, "die Rolle nicht doppelt");
  assert.match(liste, /const anzeige = karte\?\.name \?\? nameVon\(m\.pk\);/);
  assert.match(liste, /\.\.\.\(karte \? \[agentKennzeichen\(karte\)\] : \[\]\)/);
  assert.match(liste, /\? \(ort && eigeneAgentAktionen\(m\.pk, ort, /);
  assert.match(liste, /\|\| \(state\.keypair && m\.pk !== state\.keypair\.pk \? rechteAktionen\(m\.pk, !!m\.gruender, can\) : \[\]\)\s*: mitgliedAktionen\(m\.pk, !!m\.gruender, can\);/);
  const ui = lies("shell/raum-agenten-ui.ts");
  const eigene = ui.slice(ui.indexOf("export function eigeneAgentAktionen("));
  assert.match(eigene, /if \(!agent \|\| !agentenBuch\.budget\(pk, raumVon\(ziel\)\)\) return null;/, "nur Agenten dieses Geräts mit Budget hier");
  // Budget ändern bleibt in seiner Einheit – eine andere begänne den Verbrauch neu
  assert.match(eigene, /\{ art: "nurlesen", name: "einheit", label: t\("agentUi\.einheit"\), wert: einheit \}/);
  assert.match(eigene, /leseBudgetEingabe\(\{ einheit: b\.einheit, monat: wert\(w, "monat"\), tag: wert\(w, "tag"\) \}\)/);
  assert.match(eigene, /await entferneAgentAusOffenemRaum\(pk, ziel\.adresse\);/);
  assert.match(eigene, /if \(!\(await entferneAgentAusPrivatemRaum\(pk, ziel\.privat\)\)\) throw/);
});

test("11.3e4: Agent auf einem Knoten – Karte muss „knoten“ sagen, Warnung vorher, offen die Rolle, privat einladen", () => {
  const ui = lies("shell/raum-agenten-ui.ts");
  const knoten = ui.slice(ui.indexOf("async function knotenAgentAufnehmen("), ui.indexOf("// ------------------------------------------------------------ In der Mitgliederliste"));
  const i = (s: string) => { const n = knoten.indexOf(s); assert.ok(n >= 0, s); return n; };
  assert.match(knoten, /schluesselAusEingabe\(w\.schluessel, decodeNpub\)/, "npub oder Hex");
  assert.ok(i("const karte = await knotenAgentKarte(pk);") < i("if (!karte) {"), "nur mit Karte vom Agenten, Betrieb Knoten");
  assert.ok(i('await bestaetige({ titel: t("agentKnoten.einladenTitel"') < i("await nimmKnotenAgentAuf(pk, karte.name, ziel.adresse);"), "Warnung vorher");
  assert.ok(i("const r = await ladeInPrivatenRaum(ziel.privat, pk);") < i("await meldeKnotenAgentImRaum(ziel.privat, karte.name);"));
  const agenten = lies("shell/agenten.ts");
  const auf = agenten.slice(agenten.indexOf("export async function nimmKnotenAgentAuf("), agenten.indexOf("/**\n * Einen Agenten dieses Geräts in einen offenen Raum holen"));
  const j = (s: string) => { const n = auf.indexOf(s); assert.ok(n >= 0, s); return n; };
  assert.ok(j('if (!can(ichSelbst, "rollen_vergeben", stand)) throw') < j("await sichereAgentRolle(kennung, stand, ichSelbst, veroeffentliche);"));
  assert.ok(j("buildRoleGrant(kennung, ichSelbst, agentPk, [AGENT_ROLLE])") < j('content: t("agentKnoten.hinweisRaum", { name }),'), "Pflicht-Hinweis nach der Zuweisung");
  assert.doesNotMatch(auf, /setzeBudget|baueAgentKarte|aktualisiereListe/, "Budget, Karte und Liste gehören dem Knoten");
});
