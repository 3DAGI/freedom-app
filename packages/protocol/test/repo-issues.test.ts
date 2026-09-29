/**
 * Schritt C-17a: Issues (NIP-34, Kind 1621) und Kommentare (NIP-22, 1111) für
 * Repos – streng gelesen, Status nach den Regeln von GitHub (Autor,
 * Eigentümer, Maintainer), in privaten Räumen nur als innere Events.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, type NostrEvent } from "../src/event.js";
import { ProtokollFehler } from "../src/fehler.js";
import { KIND_ISSUE, baueIssue, baueIssueStatus, issueStatus, leseIssue, leseRepoAnkuendigung, baueRepoAnkuendigung } from "../src/nip34.js";
import { KIND_KOMMENTAR, baueKommentar, kommentareZu, leseKommentar } from "../src/kommentar.js";
import { RAUM_REPO_ARTEN, raumRepoIssue, raumRepoIssueStatus, raumRepoKommentar, raumReposPrivat } from "../src/raum-repo.js";
import { gruppenRaum } from "../src/raum-gruppe.js";
import { regelRaumRepoPrivat } from "../src/leak-rules.js";

const eigentuemer = generateKeypair();
const maintainer = generateKeypair();
const autorin = generateKeypair();
const fremd = generateKeypair();
const s = (ev: Parameters<typeof signEvent>[0], k: { sk: Uint8Array }, zeit?: number) =>
  signEvent(zeit === undefined ? ev : { ...ev, created_at: zeit }, k.sk);
const repo = leseRepoAnkuendigung(s(baueRepoAnkuendigung({ id: "app", name: "App", klon: [], maintainer: [maintainer.pk] }, eigentuemer.pk), eigentuemer));
const kennung = (f: () => unknown) => {
  try { f(); } catch (e) { return e instanceof ProtokollFehler ? e.kennung : "anderer Fehler"; }
  return "kein Fehler";
};

test("C-17a: Issue bauen und streng lesen – Betreff, Text, Labels, an das Repo adressiert", () => {
  const ev = s(baueIssue({ repo, betreff: "  Absturz beim Start  ", text: "Schritte: …", labels: ["bug", "bug", "ui"] }, autorin.pk), autorin);
  assert.equal(ev.kind, KIND_ISSUE);
  assert.deepEqual(ev.tags.slice(0, 3), [["a", `30617:${eigentuemer.pk}:app`], ["p", eigentuemer.pk], ["subject", "Absturz beim Start"]]);
  const i = leseIssue(ev);
  assert.deepEqual([i.autor, i.repoAdresse, i.betreff, i.text, i.labels], [autorin.pk, repo.adresse, "Absturz beim Start", "Schritte: …", ["bug", "ui"]]);
  // Bauen: Fehler mit Kennung, nie still
  assert.equal(kennung(() => baueIssue({ repo, betreff: " ", text: "x" }, autorin.pk)), "issue-betreff");
  assert.equal(kennung(() => baueIssue({ repo, betreff: "B", text: "x".repeat(30_001) }, autorin.pk)), "issue-gross");
  assert.equal(kennung(() => baueIssue({ repo, betreff: "B", text: "x", labels: ["zwei wörter"] }, autorin.pk)), "issue-label");
  // Lesen fremder Events: ohne Repo oder Betreff kein Issue; ungültige Labels fallen heraus
  const roh = (tags: string[][]) => s({ kind: KIND_ISSUE, pubkey: autorin.pk, created_at: 1_790_000_000, tags, content: "t" }, autorin);
  assert.throws(() => leseIssue(roh([["subject", "B"]])), /ohne Repo/);
  assert.throws(() => leseIssue(roh([["a", "1:x:y"], ["subject", "B"]])), /ohne Repo/);
  assert.throws(() => leseIssue(roh([["a", repo.adresse]])), /ohne Betreff/);
  assert.deepEqual(leseIssue(roh([["a", repo.adresse], ["subject", "B"], ["t", "ok"], ["t", "mit leer"], ["t", ""]])).labels, ["ok"]);
});

test("C-17a: Status eines Issues – Autor, Eigentümer und Maintainer; Fremde zählen nicht, der neueste gilt", () => {
  const issue = leseIssue(s(baueIssue({ repo, betreff: "B", text: "" }, autorin.pk), autorin));
  const status = (von: typeof autorin, st: "offen" | "erledigt" | "geschlossen", zeit: number) =>
    s(baueIssueStatus({ issue, status: st, eigentuemer: eigentuemer.pk, notiz: "n" }, von.pk), von, zeit);
  assert.deepEqual(issueStatus(issue, repo, []), { status: "offen" });
  assert.equal(issueStatus(issue, repo, [status(fremd, "geschlossen", 10)]).status, "offen", "ein Fremder schließt nicht");
  assert.equal(issueStatus(issue, repo, [status(autorin, "geschlossen", 10)]).status, "geschlossen", "die Autorin darf schließen");
  assert.equal(issueStatus(issue, repo, [status(autorin, "geschlossen", 10), status(maintainer, "erledigt", 20)]).status, "erledigt");
  assert.equal(issueStatus(issue, repo, [status(eigentuemer, "erledigt", 20), status(autorin, "offen", 30)]).status, "offen", "wieder geöffnet");
  const entwurf = s({ kind: 1633, pubkey: eigentuemer.pk, created_at: 40, tags: [["e", issue.id]], content: "" }, eigentuemer);
  assert.equal(issueStatus(issue, repo, [status(eigentuemer, "erledigt", 20), entwurf]).status, "erledigt", "1633 gibt es für Issues nicht");
  const anderes = s({ kind: 1632, pubkey: eigentuemer.pk, created_at: 50, tags: [["e", "f".repeat(64)]], content: "" }, eigentuemer);
  assert.equal(issueStatus(issue, repo, [anderes]).status, "offen", "Status eines anderen Issues");
  // Die Tags nennen Issue, Autorin, Repo und den Eigentümer
  assert.deepEqual(status(maintainer, "erledigt", 1).tags, [["e", issue.id, "", "root"], ["p", autorin.pk], ["a", repo.adresse], ["p", eigentuemer.pk]]);
});

test("C-17a: Kommentare nach NIP-22 – direkt am Issue oder als Antwort, streng gelesen", () => {
  const issueEv = s(baueIssue({ repo, betreff: "B", text: "" }, autorin.pk), autorin);
  const wurzel = { id: issueEv.id, autor: autorin.pk, kind: KIND_ISSUE };
  const k1 = s(baueKommentar({ wurzel, text: " Kann ich nachstellen. " }, maintainer.pk), maintainer, 20);
  assert.equal(k1.kind, KIND_KOMMENTAR);
  assert.deepEqual(k1.tags, [["E", issueEv.id, "", autorin.pk], ["K", "1621"], ["P", autorin.pk], ["e", issueEv.id, "", autorin.pk], ["k", "1621"], ["p", autorin.pk]]);
  const k2 = s(baueKommentar({ wurzel, eltern: { id: k1.id, autor: maintainer.pk, kind: KIND_KOMMENTAR }, text: "Danke!" }, autorin.pk), autorin, 10);
  const g2 = leseKommentar(k2);
  assert.deepEqual([g2.wurzel.id, g2.eltern.id, g2.eltern.kind, g2.text], [issueEv.id, k1.id, KIND_KOMMENTAR, "Danke!"]);
  assert.equal(leseKommentar(k1).text, "Kann ich nachstellen.");
  // Bauen: nur an Issues und Patches, mit Text und gültigem Bezug
  assert.equal(kennung(() => baueKommentar({ wurzel: { ...wurzel, kind: 1 }, text: "x" }, fremd.pk)), "kommentar-wurzel");
  assert.equal(kennung(() => baueKommentar({ wurzel, eltern: { ...wurzel, id: "a".repeat(64) }, text: "x" }, fremd.pk)), "kommentar-wurzel");
  assert.equal(kennung(() => baueKommentar({ wurzel, text: "  " }, fremd.pk)), "kommentar-leer");
  assert.equal(kennung(() => baueKommentar({ wurzel, text: "x".repeat(20_001) }, fremd.pk)), "kommentar-gross");
  assert.equal(kennung(() => baueKommentar({ wurzel: { ...wurzel, id: "zu-kurz" }, text: "x" }, fremd.pk)), "kommentar-bezug");
  // Lesen fremder Events
  const roh = (tags: string[][], text = "t") => s({ kind: KIND_KOMMENTAR, pubkey: fremd.pk, created_at: 30, tags, content: text }, fremd);
  const gut = k1.tags;
  assert.throws(() => leseKommentar(roh(gut.filter((t) => t[0] !== "E"))), /Bezug/);
  assert.throws(() => leseKommentar(roh(gut.map((t) => (t[0] === "K" ? ["K", "1"] : t)))), /nicht an einem Issue/);
  assert.throws(() => leseKommentar(roh(gut.map((t) => (t[0] === "e" ? ["e", "b".repeat(64), "", autorin.pk] : t)))), /ungültigem Bezug/, "gleiche Art wie die Wurzel, aber ein anderes Event");
  assert.throws(() => leseKommentar(roh(gut, "  ")), /leer/);
  // Unter einer Wurzel, ältester zuerst; Unfug und Kommentare anderer Wurzeln fallen heraus
  const woanders = s(baueKommentar({ wurzel: { ...wurzel, id: "c".repeat(64) }, text: "x" }, fremd.pk), fremd, 5);
  assert.deepEqual(kommentareZu(issueEv.id, [k1, woanders, roh([]), k2]).map((k) => k.id), [k2.id, k1.id]);
});

test("C-17a: im privaten Raum nur innere Events – Issues und Kommentare von Mitgliedern, Status nach den Pflegern", () => {
  const admin = eigentuemer.pk;
  let n = 0;
  const innen = (von: string, x: { art: number; tags: string[][]; text: string }) =>
    ({ id: (++n).toString(16).padStart(64, "0"), von, art: x.art, tags: x.tags, text: x.text, zeit: 1_790_000_000 + n });
  const ank = innen(admin, { art: 30617, tags: [["space", "g"], ["d", "app"], ["name", "App"]], text: "" });
  const iss = innen(autorin.pk, raumRepoIssue("g", { repo: { eigentuemer: admin, id: "app" }, betreff: "Geheim", text: "nur Mitglieder" }));
  const kom = innen(fremd.pk, raumRepoKommentar("g", { wurzel: { id: iss.id, autor: autorin.pk, kind: KIND_ISSUE }, text: "ich auch" }));
  const zu = innen(admin, raumRepoIssueStatus("g", { issue: { id: iss.id, autor: autorin.pk, repoAdresse: `30617:${admin}:app` }, status: "erledigt", eigentuemer: admin }));
  const anderswo = innen(autorin.pk, raumRepoIssue("h", { repo: { eigentuemer: admin, id: "app" }, betreff: "X", text: "" }));
  for (const x of [iss, kom, zu]) assert.ok(RAUM_REPO_ARTEN.includes(x.art) && x.tags[0][0] === "space" && x.tags[0][1] === "g");
  const zustand = gruppenRaum("g", [ank, iss, kom, zu, anderswo], { admins: [admin], mitglieder: [admin, autorin.pk, fremd.pk] }).zustand;
  const r = raumReposPrivat("g", [ank, iss, kom, zu, anderswo], zustand);
  assert.deepEqual(r.issues.map((e) => leseIssue(e).betreff), ["Geheim"], "nur aus diesem Raum");
  assert.deepEqual(kommentareZu(iss.id, r.kommentare).map((k) => k.text), ["ich auch"]);
  const gelesen = leseRepoAnkuendigung(r.ankuendigungen[0]);
  assert.equal(issueStatus(leseIssue(r.issues[0]), gelesen, r.status).status, "erledigt", "der Admin pflegt");
});

test("raum-repo-privat (C-17a): offene Issues zum Repo und offene Kommentare zu inneren Events sind Lecks", () => {
  const ev = (kind: number, tags: string[][]): NostrEvent => s({ kind, pubkey: fremd.pk, created_at: 1, tags, content: "x" }, fremd);
  const INNERES = "9".repeat(64);
  const regel = (evs: NostrEvent[]) => regelRaumRepoPrivat(evs, { repoIds: ["werkstatt"], schluessel: [], innere: [INNERES] }).map((f) => f.detail);
  assert.deepEqual(regel([ev(1621, [["a", `30617:${eigentuemer.pk}:werkstatt`], ["subject", "S"]])]), ["Repo eines privaten Raums offen (Kind 1621)"]);
  assert.deepEqual(regel([ev(1111, [["E", INNERES, "", autorin.pk], ["K", "1621"]])]), ["Repo eines privaten Raums offen (Kind 1111)"]);
  assert.deepEqual(regel([ev(1111, [["E", "8".repeat(64), "", autorin.pk], ["e", INNERES]])]), ["Repo eines privaten Raums offen (Kind 1111)"], "auch als Antwort");
  assert.deepEqual(regel([ev(1621, [["a", `30617:${eigentuemer.pk}:anderes`], ["subject", "S"]]), ev(1111, [["E", "8".repeat(64)]])]), [], "fremdes Repo, fremdes Issue");
  assert.deepEqual(regelRaumRepoPrivat([ev(1111, [["E", INNERES]])], { repoIds: [], schluessel: [] }), [], "ohne innere Ids wie bisher");
});
