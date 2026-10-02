/**
 * Alles über meinen Knoten in der App (B-9c2, L5 A): Mit Haken gehen KI und
 * Halten nur über das Relay des eigenen Knotens; nur dort meldet sich ein
 * Sitzungsschlüssel an. Ohne bekanntes Relay geht nichts an ihn.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRelayList, generateKeypair, signEvent } from "@freedomstack/protocol";
import { LS_NUR_KNOTEN, knotenRelayAus, nurUeberKnoten, satzMitKnotenRelay, ursprungAlsKnotenRelay } from "../src/knoten-weg.js";
import { MAX_EIGENE } from "../src/relay-satz.js";
import { agent } from "../src/texte/agent.js";
import { settings } from "../src/texte/settings.js";

const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const liste = (kp: ReturnType<typeof generateKeypair>, relays: { url: string; read?: boolean; write?: boolean }[], zeit: number) =>
  signEvent(buildRelayList(kp.pk, relays, zeit), kp.sk);

test("B-9c2: Haken – Standard aus, nur „1“ heißt an", () => {
  const ls = (w: string | null) => ({ getItem: (k: string) => (k === LS_NUR_KNOTEN ? w : null) });
  assert.equal(LS_NUR_KNOTEN, "freedom.knoten.nurUeber");
  assert.equal(nurUeberKnoten(ls(null)), false, "ohne Wahl wie bisher über den Pool");
  assert.equal(nurUeberKnoten(ls("0")), false);
  assert.equal(nurUeberKnoten(ls("1")), true);
});

test("B-9c2: Relay meines Knotens – nur aus seiner eigenen, neuesten Liste, nur öffentlich, nie ein reines Lese-Relay", () => {
  const knoten = generateKeypair(), fremd = generateKeypair();
  assert.equal(knotenRelayAus([], knoten.pk), null);
  const alt = liste(knoten, [{ url: "wss://alt.example" }], 1000);
  const neu = liste(knoten, [{ url: "wss://nur-lesen.example", write: false }, { url: "ws://192.168.1.5:7777" }, { url: "wss://knoten.example" }], 2000);
  assert.equal(knotenRelayAus([alt, neu], knoten.pk), "wss://knoten.example", "die neueste Liste; Lese-Relays und private Adressen nicht");
  assert.equal(knotenRelayAus([alt], knoten.pk), "wss://alt.example");
  const untergeschoben = liste(fremd, [{ url: "wss://falle.example" }], 3000);
  assert.equal(knotenRelayAus([untergeschoben], knoten.pk), null, "nur vom Knoten signiert");
});

test("B-9c2: der eigene Ursprung (App vom Knoten, B-10) – nur mit dem Schlüssel des Knotens in NIP-11", () => {
  const knoten = generateKeypair().pk;
  assert.equal(ursprungAlsKnotenRelay({ protocol: "http:", host: "192.168.1.5:7777" }, { pubkey: knoten }, knoten), "ws://192.168.1.5:7777", "Heimnetz über http");
  assert.equal(ursprungAlsKnotenRelay({ protocol: "https:", host: "knoten.example" }, { pubkey: knoten }, knoten), "wss://knoten.example");
  assert.equal(ursprungAlsKnotenRelay({ protocol: "https:", host: "3dagi.github.io" }, null, knoten), null, "Pages ist kein Relay");
  assert.equal(ursprungAlsKnotenRelay({ protocol: "http:", host: "x:7777" }, { pubkey: generateKeypair().pk }, knoten), null, "ein anderer Relay");
  assert.equal(ursprungAlsKnotenRelay({ protocol: "file:", host: "" }, { pubkey: knoten }, knoten), null);
  assert.equal(ursprungAlsKnotenRelay({ protocol: "http:", host: "x" }, "kein Objekt", knoten), null);
});

test("B-9c2: Weg – mit Haken nur das Relay des Knotens, ohne Relay nichts; nur dort meldet sich ein Sitzungsschlüssel an", () => {
  const ui = lies("shell/knoten-weg-ui.ts");
  const weg = ui.slice(ui.indexOf("export async function wegZumKnoten("), ui.indexOf("export function wireKnotenWeg("));
  assert.match(weg, /const url = await knotenRelay\(knoten\);\s*if \(!url\) return null;\s*const v = knotenVerbindung\(url, sitzung\);/, "ohne Relay kein Weg – nie still über den Pool");
  assert.match(ui, /anmelden: async \(u, challenge\) => sitzung\.signEvent\(baueRelayAuth\(sitzung\.publicKey\(\), u, challenge\)\)/);
  // In der ganzen App meldet sich nur hier ein anderer Schlüssel als die Identität an
  const src = fileURLToPath(new URL("../src/", import.meta.url));
  const dateien: string[] = [];
  const lauf = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) lauf(p); else if (p.endsWith(".ts")) dateien.push(p); } };
  lauf(src);
  const mitAuth = dateien.filter((p) => /baueRelayAuth\(/.test(readFileSync(p, "utf8"))).map((p) => p.slice(src.length)).sort();
  assert.deepEqual(mitAuth, ["shell/knoten-weg-ui.ts", "shell/state.ts"], "Anmeldung nur in state.ts (Identität) und hier (Sitzung am eigenen Knoten)");
  assert.match(lies("shell/state.ts"), /anmelden: async \(u, challenge\) => \(state\.keypair && darfAnmelden\(u\) \? signiere\(baueRelayAuth\(state\.keypair\.pk, u, challenge\)\) : null\)/, "der Pool weiter nur mit der Identität");
  // Beide Aufträge an den Knoten nehmen den Weg; ohne ihn geht nichts hinaus
  const agentTs = ["agent", "modellwahl", "agent-verlauf", "agent-wege", "agent-anzeige", "agent-eingabe"].map((d) => lies(`shell/tabs/${d}.ts`)).join("\n");
  const frage = agentTs.slice(agentTs.indexOf("async function frageMeinenKnoten("), agentTs.indexOf("/** So lange wartet die App"));
  const pruefung = frage.indexOf("if (!weg) {");
  assert.ok(pruefung > 0 && pruefung < frage.indexOf("await buildJobEvent(") && pruefung < frage.indexOf("await weg.publish(wrap);"));
  assert.match(frage, /weg = await wegZumKnoten\(k\.knoten, kiSitzungen\.fuer\(k\.knoten\)\);/, "der Sitzungsschlüssel der Anfrage");
  assert.match(frage, /\} finally \{\s*weg\?\.schliesse\(\);/);
  assert.doesNotMatch(frage, /ensurePool\(\)\)\.publish/, "nicht mehr am Weg vorbei");
  // Das Relay des Knotens liefert nur, wenn jeder Schlüssel im Filter angemeldet ist – also nur nach dem des Auftrags fragen
  assert.match(agentTs, /const pks = quelle \? \[quelle\.sitzungPk\] : kiSitzungen\.pubkeys\(\);/);
  assert.equal((weg.match(/sitzungPk: sitzung\.publicKey\(\)/g) ?? []).length, 2, "mit und ohne Haken");
  const halten = lies("shell/knoten-halten-ui.ts");
  assert.match(halten, /const weg = await wegZumKnoten\(k\.knoten, sitzung\);\s*if \(!weg\) return toast\(t\("set\.knotenOhneRelay"\), true\);/);
  assert.match(halten, /\} finally \{\s*weg\.schliesse\(\);/);
  assert.doesNotMatch(halten, /ensurePool/);
  // Haken: nur gekoppelt sichtbar, Texte in beiden Sprachen
  assert.match(lies("shell/mein-knoten.ts"), /document\.getElementById\("knoten-nur-zeile"\)\?\.toggleAttribute\("hidden", !k\);/);
  assert.match(lies("shell/index.html"), /<label id="knoten-nur-zeile"[^>]* hidden><input type="checkbox" id="knoten-nur" \/> <span data-i18n="set\.knotenNur">/);
  for (const [texte, k] of [[settings, "set.knotenNur"], [settings, "set.knotenOhneRelay"], [agent, "agent.knotenOhneRelay"]] as const) assert.ok(texte[k]?.de && texte[k]?.en, k);
});

test("B-9c3: Relay meines Knotens in den eigenen Satz – angehängt, die übrigen bleiben, geprüft wie eine Eingabe", () => {
  const eigene = ["wss://eins.example", "wss://zwei.example"];
  assert.deepEqual(satzMitKnotenRelay(eigene, "wss://knoten.example"), { relays: ["wss://eins.example", "wss://zwei.example", "wss://knoten.example"] });
  assert.deepEqual(eigene, ["wss://eins.example", "wss://zwei.example"], "der alte Satz wird nicht verändert");
  assert.deepEqual(satzMitKnotenRelay(eigene, "wss://abc.onion"), { relays: [...eigene, "wss://abc.onion"] });
  assert.deepEqual(satzMitKnotenRelay(eigene, "ws://abc.onion"), { relays: [...eigene, "ws://abc.onion"] }, "über Tor verschlüsselt Tor");
  // Negativfälle
  assert.deepEqual(satzMitKnotenRelay([], "wss://knoten.example"), { fall: "kein-satz" }, "sonst wäre der Knoten der einzige Posteingang");
  assert.deepEqual(satzMitKnotenRelay(eigene, "wss://ZWEI.example/"), { fall: "schon" }, "gleich nach Normalform");
  assert.deepEqual(satzMitKnotenRelay(eigene, "ws://192.168.1.5:7777"), { fall: "untauglich" }, "Heimnetz – dort erreicht ihn kein Kontakt");
  assert.deepEqual(satzMitKnotenRelay(eigene, "ws://knoten.example"), { fall: "untauglich" }, "unverschlüsselt nur .onion");
  assert.deepEqual(satzMitKnotenRelay(eigene, "kein relay"), { fall: "untauglich" });
  const voll = Array.from({ length: MAX_EIGENE }, (_, i) => `wss://r${i}.example`);
  const r = satzMitKnotenRelay(voll, "wss://knoten.example");
  assert.ok("fehler" in r && r.fehler.includes(String(MAX_EIGENE)), "höchstens MAX_EIGENE – nichts still verdrängt");
});

test("B-9c3: Knopf „übernehmen“ – nur gekoppelt, nur nach Rückfrage, nur über setzeEigeneRelays(), als Gerät nicht", () => {
  const ui = lies("shell/knoten-weg-ui.ts");
  const f = ui.slice(ui.indexOf("export async function uebernimmKnotenRelay("), ui.indexOf("/** Haken und Knopf"));
  const geraet = f.indexOf("if (alsGeraet()) return zeige(t(\"set.geraetSatz\"));");
  const frage = f.indexOf("await bestaetige(");
  const setzen = f.indexOf("await setzeEigeneRelays({ relays, pk, signiere, weit: veroeffentlicheWeit, speicher: localStorage })");
  const pool = f.indexOf("await nimmInPool(relays);");
  assert.ok(geraet > 0 && geraet < frage && frage < setzen && setzen < pool, "Gerät gesperrt, dann Rückfrage, dann veröffentlichen, erst danach in den Pool");
  assert.match(f, /if \(!url \|\| !r\) return zeige\(t\("set\.knotenRelayKeins"\)\);/, "ohne Relay nichts");
  assert.doesNotMatch(f, /localStorage\.setItem|\.publish\(/, "gemerkt und veröffentlicht nur über setzeEigeneRelays()");
  assert.match(f, /satzMitKnotenRelay\(eigene, url\)/);
  assert.match(lies("shell/mein-knoten.ts"), /document\.getElementById\("knoten-relay-uebernehmen"\)\?\.toggleAttribute\("hidden", !k\);/);
  assert.match(lies("shell/index.html"), /<button id="knoten-relay-uebernehmen"[^>]* hidden data-i18n="set\.knotenRelayUebernehmen">/);
  assert.match(ui, /getElementById\("knoten-relay-uebernehmen"\)\?\.addEventListener\("click", \(\) => void uebernimmKnotenRelay\(\)\)/);
  for (const k of ["set.knotenRelayUebernehmen", "set.knotenRelayFrage", "set.knotenRelayKeins", "set.knotenRelaySchon", "set.knotenRelayUntauglich", "set.knotenRelayDrin", "set.keinSatz"] as const) {
    assert.ok(settings[k]?.de && settings[k]?.en, k);
  }
  assert.match(settings["set.knotenRelayFrage"].de, /vermuten, dass der Knoten dir gehört/, "ehrlich: die Liste ist öffentlich");
});
