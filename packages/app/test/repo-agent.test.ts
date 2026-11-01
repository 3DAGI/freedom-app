/**
 * 11.5d1 (Entwurf REPO-AGENTEN-ENTWURF.md V1, W2 A, W5 A): einen Agenten am Repo beauftragen.
 *
 * Beweist:
 *  - beauftragt wird nur ein Agent auf einem Knoten mit „wer fragt, zahlt“ aus dem Raum, nie man selbst
 *  - Obergrenze und Aufgabe nur in den Grenzen; der Kanal ist der erste, in dem beide schreiben dürfen
 *  - die Nachricht zeigt mit genau einem Repo-Tag auf das Repo – der Knoten liest es (`leseRepoAuftrag()`)
 *  - verdrahtet: Knopf auf der Repo-Seite nur mit Raum, erst der Preis, dann die Nachricht, dann der Auftrag;
 *    privat nur als inneres Event; die App wartet so lange wie der Lauf beim Knoten
 *  - 11.5d2a: jede Absage eines Repo-Auftrags hat ihren eigenen Satz; Patches von Agenten tragen ein Kennzeichen
 *  - 11.5d2b: die Antwort eines Agenten im Raum zeigt einen eigenen Satz je Kennung und führt zum Patch
 *  - 11.5d3: „Agent beauftragen“ auch im Raum-Menü – ein Repo gleich, mehrere zur Wahl
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AGENT_ROLLE, JEDER_RECHTE, JEDER_ROLLE, baueRepoAnkuendigung, bauePatch, buildRoleGrant, buildRoles, buildSpace, generateKeypair,
  leseRepoAnkuendigung, leseRepoAuftrag, raumAdresse, raumZustandFuer, signEvent, type Channel,
} from "@freedomstack/protocol";
import { BEREICHE } from "../src/i18n.js";
import { type RaumAgentKarte, ablehnungsText } from "../src/knoten-agent-wahl.js";
import { patchZeilen } from "../src/repo-ansicht.js";
import {
  REPO_AUFGABE_MAX, REPO_FALL_TEXT, REPO_GEBOT_SATS, REPO_WARTEN_MS, auftragsKanal, leseAufgabe, leseObergrenze, repoAgenten, repoAuftragNachricht,
  repoFallSchluessel,
} from "../src/repo-agent.js";

const lies = (datei: string) => readFileSync(new URL(`../src/${datei}`, import.meta.url), "utf8");
const pk = (n: number) => n.toString(16).padStart(64, "0");
const T = 1_800_000_000;
const GRUENDER = generateKeypair(), ICH = generateKeypair(), AGENT = generateKeypair();
const KENNUNG = "werkstatt-ab12cd";
const ADRESSE = raumAdresse(GRUENDER.pk, KENNUNG);
const s = (ev: Parameters<typeof signEvent>[0], k: { sk: Uint8Array }) => signEvent(ev, k.sk);

test("11.5d1: beauftragt wird nur ein Agent auf einem Knoten, bei dem zahlt, wer fragt – nie man selbst", () => {
  const karte = (agent: string, o: Partial<RaumAgentKarte> = {}): RaumAgentKarte =>
    ({ agent, name: `A${agent.slice(-1)}`, betrieb: "knoten", bezahlung: "fragender", provider: pk(9), ...o });
  const karten = [
    karte(pk(2)), karte(pk(3), { betrieb: "geraet", bezahlung: "einlader" }), karte(pk(4), { bezahlung: "einlader" }),
    karte(pk(5), { provider: undefined }), karte(pk(6)), karte(pk(1)),
  ];
  assert.deepEqual(repoAgenten(karten, pk(1)).map((k) => k.agent), [pk(2), pk(6)]);
  assert.deepEqual(repoAgenten([], pk(1)), []);
});

test("11.5d1: Obergrenze ganze sats in den Grenzen, Aufgabe nicht leer und begrenzt", () => {
  assert.equal(leseObergrenze("1000"), 1000);
  assert.equal(leseObergrenze(" 5 "), 5);
  assert.equal(leseObergrenze(String(REPO_GEBOT_SATS.hoechstens)), REPO_GEBOT_SATS.hoechstens);
  for (const falsch of ["0", "", "-5", "1e3", "12.5", "abc", String(REPO_GEBOT_SATS.hoechstens + 1), undefined, 1000]) {
    assert.equal(leseObergrenze(falsch), null, String(falsch));
  }
  assert.ok(REPO_GEBOT_SATS.vorgabe > 0 && REPO_GEBOT_SATS.vorgabe <= REPO_GEBOT_SATS.hoechstens);
  assert.equal(leseAufgabe("  Repariere den Test  "), "Repariere den Test");
  assert.equal(leseAufgabe("x".repeat(REPO_AUFGABE_MAX)), "x".repeat(REPO_AUFGABE_MAX));
  for (const falsch of ["", "   ", "x".repeat(REPO_AUFGABE_MAX + 1), undefined, ["a"]]) assert.equal(leseAufgabe(falsch), null);
  // Zeichen, nicht UTF-16-Einheiten: 2000 Emoji passen
  assert.equal(leseAufgabe("🦀".repeat(REPO_AUFGABE_MAX))?.length, REPO_AUFGABE_MAX * 2);
});

test("11.5d1: Kanal – der erste, in dem ich UND der Agent schreiben dürfen", () => {
  const kanaele: Channel[] = [
    { id: "allgemein", name: "allgemein", privacy: "offen", writeRoles: [], position: 1 },
    { id: "ankuendigungen", name: "ankündigungen", privacy: "offen", writeRoles: ["mod"], position: 0 },
    { id: "werkstatt", name: "werkstatt", privacy: "offen", writeRoles: [], position: 2 },
  ];
  const raum = s(buildSpace({ spaceId: KENNUNG, name: "Werkstatt", ownerPubkey: GRUENDER.pk, channels: kanaele }, T), GRUENDER);
  const mod = { id: "mod", name: "Moderator", rank: 50, permissions: ["lesen", "schreiben", "threads"] as const };
  const agentRolle = { id: AGENT_ROLLE, name: "Agent", rank: 1, permissions: ["lesen", "schreiben", "threads"] as const };
  const jeder = { id: JEDER_ROLLE, name: "Jeder", rank: 0, permissions: [...JEDER_RECHTE] };
  const zustand = (rollen: unknown[], grants: [string, string[]][]) => raumZustandFuer(ADRESSE, [
    raum, s(buildRoles(KENNUNG, GRUENDER.pk, rollen as never, T + 1), GRUENDER),
    ...grants.map(([wer, r], i) => s(buildRoleGrant(KENNUNG, GRUENDER.pk, wer, r, T + 2 + i), GRUENDER)),
  ], T + 100)!;
  // Ich bin Moderator (darf in #ankündigungen), der Agent nur Agent – also nicht #ankündigungen, sondern #allgemein
  const st = zustand([mod, agentRolle], [[ICH.pk, ["mod"]], [AGENT.pk, [AGENT_ROLLE]]]);
  assert.equal(st.space!.channels[0]!.id, "ankuendigungen", "nach Position zuerst");
  assert.equal(auftragsKanal(st, ICH.pk, AGENT.pk), "allgemein");
  // Darf der Agent nirgends schreiben, gibt es keinen Kanal – er schwiege sonst
  assert.equal(auftragsKanal(zustand([mod], [[ICH.pk, ["mod"]]]), ICH.pk, AGENT.pk), undefined);
  // Darf ich nirgends schreiben, ebenso
  assert.equal(auftragsKanal(zustand([agentRolle], [[AGENT.pk, [AGENT_ROLLE]]]), ICH.pk, AGENT.pk), undefined);
  // Mit der Rolle für alle (B-22) schreiben beide in #allgemein
  assert.equal(auftragsKanal(zustand([jeder], []), ICH.pk, AGENT.pk), "allgemein");
  assert.equal(auftragsKanal({ roles: new Map(), grants: new Map() } as never, ICH.pk, AGENT.pk), undefined, "ohne Raum keiner");
});

test("11.5d1: die Nachricht erwähnt den Agenten mit Namen und zeigt mit genau einem Tag auf das Repo", () => {
  const repo = `30617:${GRUENDER.pk}:app`;
  const n = repoAuftragNachricht({ name: "Kai", aufgabe: "Mach den Test grün", repo });
  assert.equal(n.text, "@Kai Mach den Test grün");
  assert.deepEqual(n.tags, [["a", repo, "", "repo"]]);
  assert.deepEqual(leseRepoAuftrag(n.tags), { repo }, "so liest es der Knoten");
  const issue = "ab".repeat(32);
  assert.deepEqual(leseRepoAuftrag(repoAuftragNachricht({ name: "Kai", aufgabe: "x", repo, issue }).tags), { repo, issue });
  assert.throws(() => repoAuftragNachricht({ name: "Kai", aufgabe: "x", repo: "keine-adresse" }), /Repo-Adresse/);
});

test("11.5d1: Texte – jeder Schlüssel in beiden Sprachen, der Preis nennt Obergrenze, Rate und Repo", () => {
  const texte = Object.assign({}, ...Object.values(BEREICHE)) as Record<string, { de: string; en: string }>;
  const schluessel = [...new Set([...(lies("shell/repo-agent-ui.ts") + lies("shell/knoten-agent-fragen.ts") + lies("shell/tabs/repo-seite.ts"))
    .matchAll(/"(agentRepo\.[a-zA-Z]+)"/g)].map((m) => m[1]!))];
  assert.ok(schluessel.length >= 15, `${schluessel.length} Schlüssel`);
  for (const k of schluessel) assert.ok(texte[k]?.de && texte[k]?.en, k);
  for (const k of ["agentRepo.preis", "agentRepo.preisKanal"]) {
    for (const sprache of ["de", "en"] as const) {
      for (const platz of ["{name}", "{hoechst}", "{rate}", "{repo}"]) assert.ok(texte[k]![sprache].includes(platz), `${k} ${sprache} ${platz}`);
    }
  }
  // Ehrlich: an der Obergrenze ohne Patch, aber bezahlt; im offenen Raum öffentlich
  assert.match(texte["agentRepo.preis"]!.de, /dann ohne Patch, bezahlt ist, was er gerechnet hat/);
  assert.match(texte["agentRepo.preis"]!.de, /im offenen Raum öffentlich/);
});

test("11.5d1: verdrahtet – Knopf nur mit Raum, Preis vor der Nachricht, privat nur in der Gruppe, Warten wie der Lauf", () => {
  const seite = lies("shell/tabs/repo-seite.ts");
  const raumZeile = seite.slice(seite.indexOf("function raumZeile("), seite.indexOf("function lokalZeile("));
  const unbestaetigt = raumZeile.indexOf("if (!k.privatRaum && !k.raumBestaetigt) {"), knopf = raumZeile.indexOf("m.beauftrageAgentAmRepo(k)");
  assert.ok(unbestaetigt > 0 && knopf > unbestaetigt, "nur, wenn das Repo bestätigt zum Raum gehört oder privat ist");
  assert.match(raumZeile, /if \(k\.repo && state\.keypair\) \{/);

  const ui = lies("shell/repo-agent-ui.ts");
  assert.match(ui, /const ort = k\.privatRaum \? await privaterRaum\(k\.privatRaum\) : k\.raumBestaetigt && repo\.raum \? await offenerRaum\(repo\.raum, ich\) : null;/);
  assert.match(ui, /return mlsSendeEventId\(gruppe, \{ \.\.\.s, tags: \[\.\.\.s\.tags, \.\.\.n\.tags\] \}\);/, "privat nur als inneres Event");
  assert.equal(ui.match(/publish\(/g)?.length, 1, "offen genau eine Stelle");
  assert.ok(ui.indexOf("await pool.publish(signiert);") < ui.indexOf("async function privaterRaum("), "und die nur im offenen Raum");
  assert.match(ui, /const kanal = auftragsKanal\(ort\.zustand, ort\.ich, agent\.agent\);/);
  assert.match(ui, /await beauftrageAmRepo\(ort\.raum, agent, \{ gebotSats, repo: k\.name, sende: \(\) => ort\.sende\(kanal, agent\.agent, n\)\.catch\(\(\) => null\) \}\);/);

  const q = lies("shell/knoten-agent-fragen.ts");
  const frage = q.slice(q.indexOf("async function frageEinen("), q.indexOf("// ------------------------------------------------------------ Einladen"));
  const stelle = (x: string): number => {
    const n = frage.indexOf(x);
    assert.ok(n >= 0, x);
    return n;
  };
  assert.ok(stelle("if (!ok) return;") < stelle("const erwaehnung = gesendet ?? (await repo?.sende());"), "die Nachricht erst nach der Bestätigung");
  assert.ok(stelle("if (!erwaehnung) return toast(") < stelle("await bezahlterAuftrag("), "ohne Nachricht kein Auftrag");
  assert.match(frage, /const hoechst = hoechstMsat\(repo\?\.gebotSats \?\? AGENT_GEBOT_SATS, \[\]\);/, "die Obergrenze des Fragenden");
  assert.match(frage, /extraTags: auftragsVerweisTags\(\{ raum, erwaehnung \}\), \.\.\.\(repo \? \{ wartenMs: REPO_WARTEN_MS \} : \{\}\),/);

  const b = lies("shell/bezahlter-auftrag.ts");
  assert.match(b, /const warten = p\.wartenMs \?\? WARTEN_MS;\n\s+const ende = Date\.now\(\) \+ warten;/);
  assert.match(b, /const takt = warten > WARTEN_MS \? 15_000 : 3000;/, "lange Aufträge seltener fragen");
  // Der Knoten lässt einen Repo-Lauf höchstens 30 min rechnen – die App wartet länger
  const lauf = readFileSync(new URL("../../node/src/repo-lauf.ts", import.meta.url), "utf8");
  const zeit = /zeitMs: (\d+) \* 60_000,/.exec(lauf.slice(lauf.indexOf("export const REPO_LAUF_GRENZEN")));
  assert.ok(zeit && REPO_WARTEN_MS > Number(zeit[1]) * 60_000, "länger als der Lauf beim Knoten");
});

test("11.5d2a: jede Absage eines Repo-Auftrags hat ihren eigenen Satz – nie der allgemeine mit Kennung", () => {
  const texte = Object.assign({}, ...Object.values(BEREICHE)) as Record<string, { de: string; en: string }>;
  const quelle = ["../../node/src/knoten-agent.ts", "../../node/src/dvm-provider.ts", "../../node/src/repo-bundle.ts", "../../protocol/src/repo-auftrag.ts"]
    .map((d) => readFileSync(new URL(d, import.meta.url), "utf8")).join("\n");
  const faelle = [...new Set([...quelle.matchAll(/"(agent-repo-[a-z-]+)"/g)].map((m) => m[1]!))];
  assert.equal(faelle.length, 8, faelle.join(", "));
  const saetze = faelle.map((f) => ablehnungsText(f));
  assert.equal(new Set(saetze).size, faelle.length, "je Kennung ein anderer Satz");
  for (const [i, s] of saetze.entries()) {
    assert.match(s, /^agentRepo\./, `${faelle[i]} → ${s}`);
    for (const sprache of ["de", "en"] as const) assert.ok(texte[s]?.[sprache].includes("{name}"), `${s} ${sprache}`);
  }
  // Was der Knoten nicht kennt, bleibt beim allgemeinen Satz – auch, was nur so aussieht
  for (const f of ["agent-repo-neu", "agent-repo", "constructor", "agentRepo.aus"]) assert.equal(ablehnungsText(f), "agentKnoten.abgelehnt", f);
});

test("11.5d2a: Patches von Agenten tragen ein Kennzeichen – nur, wenn der Raum den Autor als Agenten kennt", () => {
  const eigen = generateKeypair(), mensch = generateKeypair();
  const repo = leseRepoAnkuendigung(signEvent(baueRepoAnkuendigung({ id: "demo", name: "Demo", klon: [] }, eigen.pk), eigen.sk));
  const text = `From ${"a".repeat(40)} Mon Sep 17 00:00:00 2001\nSubject: [PATCH] X\n\n---\ndiff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n`;
  const vom = (k: { pk: string; sk: Uint8Array }, zeit: number) => signEvent({ ...bauePatch({ repo, text }, k.pk), created_at: zeit }, k.sk);
  const patches = [vom(AGENT, 20), vom(mensch, 10)];
  const zeilen = patchZeilen(repo, patches, [], eigen.pk, (pk) => pk === AGENT.pk);
  assert.deepEqual(zeilen.map((z) => [z.patch.autor, z.vonAgent]), [[AGENT.pk, true], [mensch.pk, undefined]]);
  assert.ok(patchZeilen(repo, patches, [], eigen.pk).every((z) => !("vonAgent" in z)), "ohne Agenten des Raums kein Kennzeichen");
  assert.deepEqual(zeilen[0]!.aktionen, ["annehmen", "entwurf", "schliessen"], "annehmen bleibt beim Eigentümer – das Kennzeichen ändert nichts daran");
  // Verdrahtet: in der Liste und auf der Seite des Patches, als Text mit Erklärung
  const seite = lies("shell/tabs/repo-seite.ts"), patch = lies("shell/tabs/patch-seite.ts");
  assert.match(seite, /if \(z\.vonAgent\) meta\.prepend\(agentMarke\(\), " "\);/);
  assert.match(seite, /\.\.\.\(offen\.vonAgent \? \{ vonAgent: true \} : \{\}\),/);
  assert.match(patch, /if \(p\.vonAgent\) meta\.append\(agentMarke\(\)\);/);
  assert.match(patch, /el\("span", t\("agentRepo\.vonAgent"\), "msg-role rolle-agent"\);\n {2}m\.title = t\("agentRepo\.vonAgentTitel"\);/);
  const texte = Object.assign({}, ...Object.values(BEREICHE)) as Record<string, { de: string; en: string }>;
  assert.match(texte["agentRepo.vonAgentTitel"]!.de, /bevor du ihn annimmst/);
});

test("11.5d2b: jede Kennung, mit der ein Repo-Auftrag endet, hat einen eigenen Satz – Unbekanntes behält den Text", () => {
  const texte = Object.assign({}, ...Object.values(BEREICHE)) as Record<string, { de: string; en: string }>;
  const knoten = readFileSync(new URL("../../node/src/knoten-agent.ts", import.meta.url), "utf8");
  const block = knoten.slice(knoten.indexOf("export const REPO_TEXT = {"), knoten.indexOf("} as const;", knoten.indexOf("export const REPO_TEXT = {")));
  const faelle = [...block.matchAll(/"(repo\.[a-z-]+)":/g)].map((m) => m[1]!);
  assert.equal(faelle.length, 10, faelle.join(", "));
  assert.deepEqual(Object.keys(REPO_FALL_TEXT).sort(), [...faelle].sort(), "genau die Kennungen des Knotens");
  const saetze = faelle.map((f) => repoFallSchluessel(f));
  assert.equal(new Set(saetze).size, faelle.length, "je Kennung ein anderer Satz");
  for (const s of [...saetze, "agentRepo.ohnePakete", "agentRepo.patchAnsehen", "agentRepo.patchFehlt"]) assert.ok(texte[s!]?.de && texte[s!]?.en, String(s));
  for (const f of ["repo.neu", "constructor", "__proto__", "toString", ""]) assert.equal(repoFallSchluessel(f), null, f);
  // Ehrlich: ein Patch ist ein Vorschlag, und ohne Patch steht es da
  assert.match(texte["agentRepo.ergebnisPatch"]!.de, /Vorschlag – annehmen können Eigentümer und Maintainer/);
  for (const f of ["repo.keine-aenderung", "repo.schritte", "repo.zeit", "repo.tokens", "repo.formfehler", "repo.ordner"]) {
    assert.match(texte[repoFallSchluessel(f)!]!.de, /kein Patch/, f);
  }
});

test("11.5d2b: verdrahtet – nur Antworten von Agenten des Raums, der Satz statt des Textes, der Patch nur aus den Repos des Raums", () => {
  const raeume = lies("shell/tabs/raeume.ts"), repos = lies("shell/tabs/repos.ts"), seite = lies("shell/tabs/repo-seite.ts");
  // Wer: die Karten des Raums – offen aus der Rolle, privat aus der Gruppe; gelesen nur über leseRepoAntwort()
  assert.match(raeume, /const agenten = new Set\(\(spacesUi\.privat \? raumAgentKarten\(spacesUi\.privat\.ereignisse\) : spacesUi\.agentKarten\)\.map\(\(k\) => k\.agent\)\);/);
  assert.match(raeume, /const a = agenten\.has\(e\.pubkey\) \? leseRepoAntwort\(e\.tags\) : null;/);
  assert.match(raeume, /repoAntworten \};/, "im Kontext des Verlaufs – auch im Thread");
  // Was: der eigene Satz, sonst der Text; der Knopf nur mit Patch
  assert.match(raeume, /z\.append\(el\("div", satz \?\? m\.content, "msg-text"\)\);/);
  assert.match(raeume, /if \(antwort\?\.patch\) z\.append\(knopf\(t\("agentRepo\.patchAnsehen"\), "patch-ansehen", \(\) => void oeffnePatchAusRaum\(antwort\.patch!\)\)\);/);
  assert.match(raeume, /const s = repoFallSchluessel\(a\.fall\);\n {2}return s \? `\$\{t\(s\)\}\$\{a\.pakete \? ` \$\{t\("agentRepo\.ohnePakete"\)\}` : ""\}` : null;/);
  // Wohin: nur ein Patch unter den Repos dieses Raums, sonst ein Hinweis – nie eine Adresse aus der Nachricht
  const weg = raeume.slice(raeume.indexOf("async function oeffnePatchAusRaum("), raeume.indexOf("/** Nachrichten nach Absender und Tag gruppiert"));
  assert.match(weg, /\(ziel \? reposVonRaum\(ziel\) : \[\]\)\.find\(\(k\) => k\.zeilen\.some\(\(z\) => z\.patch\.id === patch\)\)/);
  assert.match(weg, /if \(!k\) return toast\(t\("agentRepo\.patchFehlt"\), true\);\n {2}oeffneRepo\(k\.schluessel, patch\);/);
  assert.match(repos, /export function oeffneRepo\(schluessel: string, patch\?: string\): void \{[^}]*vergissReiter\(\);\n {2}if \(patch\) oeffnePatchBeimZeigen\(patch\);/);
  assert.match(seite, /export const oeffnePatchBeimZeigen = \(id: string\): void => \{ offenerPatch = id; \};/);
});

test("11.5d3: „Agent beauftragen“ auch im Raum – sobald er ein Repo hat; ein Repo gleich, mehrere zur Wahl", () => {
  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  assert.match(html, /<button id="space-repo-agent" class="menue-punkt hidden" role="menuitem" type="button" data-i18n="agentRepo\.knopf">/);
  const raeume = lies("shell/tabs/raeume.ts"), ui = lies("shell/repo-agent-ui.ts");
  // Sichtbar nur mit Identität und einem Repo des Raums (dieselbe Liste wie unter den Kanälen), versteckt sonst
  assert.match(raeume, /const agentAmRepo = !!state\.keypair && repos\.some\(\(k\) => k\.repo\);\n {2}document\.getElementById\("space-repo-agent"\)\?\.classList\.toggle\("hidden", !agentAmRepo\);/);
  assert.match(raeume, /if \(ziel\) void import\("\.\.\/repo-agent-ui\.js"\)\.then\(\(m\) => m\.beauftrageAgentImRaum\(reposVonRaum\(ziel\)\)\);/);
  // Danach derselbe Weg wie auf der Repo-Seite – nie ein zweiter
  const im = ui.slice(ui.indexOf("export async function beauftrageAgentImRaum("));
  assert.match(im, /if \(mit\.length <= 1\) return mit\[0\] \? beauftrageAgentAmRepo\(mit\[0\]\) : undefined;/);
  assert.match(im, /const k = w \? mit\.find\(\(x\) => x\.schluessel === w\.repo\) : undefined;\n {2}if \(k\) await beauftrageAgentAmRepo\(k\);/);
  assert.ok(!/publish\(|mlsSendeEvent/.test(im), "sendet selbst nichts");
  const texte = Object.assign({}, ...Object.values(BEREICHE)) as Record<string, { de: string; en: string }>;
  for (const s of ["agentRepo.welchesRepo", "agentRepo.repo", "agentRepo.knopf"]) assert.ok(texte[s]?.de && texte[s]?.en, s);
});
