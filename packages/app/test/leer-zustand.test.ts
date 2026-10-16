/**
 * Schritt C-45 (Oberflächen-Review 15.10.2026): Leere Zustände mit Symbol, einem Satz in Klartext und
 * dem nächsten Schritt. Im Browser prüfen es die Smoke-Teile „einrichtung_wahl“ (Chat-Liste) und
 * „repos“ (leere Suche).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang, t } from "../src/i18n.js";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");

test("ein Baustein: Symbol, ein Satz als Text, höchstens ein Knopf – nie HTML", () => {
  const ui = quelle("../src/shell/ui.ts");
  const fn = ui.slice(ui.indexOf("export function leererZustand("), ui.indexOf("\n}\n", ui.indexOf("export function leererZustand(")));
  assert.match(fn, /zeichen\.append\(iconEl\(symbol, 22\)\);/);
  assert.match(fn, /box\.append\(zeichen, el\("p", satz, "leer-satz"\)\);/);
  assert.match(fn, /const knopf = el\("button", aktion\.text, "primaer"\);/);
  assert.doesNotMatch(fn, /innerHTML|insertAdjacentHTML/);
});

test("verdrahtet: Chat-Liste, Repos (drei Fälle), Tauschen – jeweils mit dem Weg weiter", () => {
  // Seit C-52b in chat-liste.ts – je Filter ein eigener leerer Zustand
  const komm = quelle("../src/shell/tabs/chat-liste.ts");
  assert.match(komm, /leererZustand\("chat", t\("komm\.keineUnterhaltungen"\), \{\s*text: t\("komm\.neueUnterhaltung"\), beiKlick: \(\) => document\.getElementById\("chat-new-dm"\)\?\.click\(\),/);
  const repos = quelle("../src/shell/tabs/repos.ts");
  assert.match(repos, /leererZustand\("git", t\("repo\.nichtsNeues"\), \{ text: t\("repo\.alleZeigen"\)/);
  assert.match(repos, /leererZustand\("search", t\("repo\.nichtsGefunden"\), \{\s*text: t\("repo\.sucheLeeren"\)/);
  assert.match(repos, /leererZustand\("git", t\("repo\.keineRepos"\), \{ text: t\("agent\.repoAnkuendigen"\), beiKlick: \(\) => document\.getElementById\("nip34-ankuendigen"\)\?\.click\(\) \}\)/);
  const wallet = quelle("../src/shell/tabs/waehrung.ts");
  assert.match(wallet, /leererZustand\("coins", t\("waehr\.keineAngebote"\), \{ text: t\("waehr\.nochmalSuchen"\), beiKlick: \(\) => void loadWallet\(\) \}\)/);
  // Kein Satz ohne Weg weiter mehr an diesen Stellen
  assert.doesNotMatch(komm, /el\("div", t\("komm\.keineUnterhaltungen"\)/);
  assert.doesNotMatch(wallet, /leer\.textContent = t\("waehr\.keineAngebote"\)/);
});

test("Klartext statt Fachwort – in beiden Sprachen", () => {
  for (const sprache of ["de", "en"] as const) {
    setLang(sprache);
    assert.doesNotMatch(t("repo.keineRepos"), /NIP-34/, sprache);
    assert.doesNotMatch(t("waehr.keineAngebote"), /\bLP\b/, sprache);
    assert.doesNotMatch(t("komm.keineUnterhaltungen"), /\+/, `${sprache}: der Knopf steht daneben, nicht „mit +“`);
  }
  setLang("de");
  assert.equal(t("komm.neueUnterhaltung"), "Neue Unterhaltung");
});
