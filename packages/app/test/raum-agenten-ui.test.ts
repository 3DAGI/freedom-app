/**
 * Schritt 11.3e1: „Agent hinzufügen“ im Raum – neu oder vorhanden, mit Budget je
 * Monat und Tag in sats oder SOL (Entwurf `docs/AGENTEN-RAUM-ENTWURF.md` P2, P5, F3 B).
 * Erst der Tresor, ehrlich vorher (Gerät muss offen sein, ich zahle auch für andere),
 * nur als Hauptidentität – privat als Moderator, offen mit „rollen_vergeben“.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leseBudgetEingabe } from "../src/raum-agent-budget.js";

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

test("Ablauf: Tresor zuerst, vorhandene ohne diesen Raum, neu mit Grenzen, Budget leer vorbelegt, dann einladen", () => {
  const ui = lies("shell/raum-agenten-ui.ts");
  const ablauf = ui.slice(ui.indexOf("export async function agentHinzufuegen("));
  const i = (s: string) => { const n = ablauf.indexOf(s); assert.ok(n >= 0, s); return n; };
  assert.ok(i('if (!(await verlangeTresor(t("agentRaum.wofuer")))) return false;') < i("agentenBuch.alle()"), "das Buch liegt im Tresor");
  assert.match(ablauf, /agentenBuch\.alle\(\)\.filter\(\(a\) => !a\.raeume\.some\(\(r\) => r\.raum === raum\)\)/, "wer schon im Raum ist, steht nicht zur Wahl");
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
