/**
 * Schritt C-20g1: Reviews an Patches – Kommentare an Zeilen des Diffs und
 * Bewertungen („genehmigt“, „Änderungen erbeten“) als NIP-22-Kommentare mit
 * einem Tag mehr. Streng gelesen; je Person zählt die neueste Bewertung, die
 * eigene des Patch-Autors nicht. In privaten Räumen nur als innere Events.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, type NostrEvent } from "../src/event.js";
import { ProtokollFehler } from "../src/fehler.js";
import { KIND_PATCH, baueRepoAnkuendigung, leseRepoAnkuendigung } from "../src/nip34.js";
import { KIND_KOMMENTAR, baueKommentar, kommentareZu, leseKommentar } from "../src/kommentar.js";
import {
  REVIEW_GRENZEN, baueBewertung, baueZeilenKommentar, bewertungenZu, istReviewTeil, leseBewertung, leseZeilenbezug, zeilenKommentareZu,
} from "../src/review.js";
import { RAUM_REPO_ARTEN, raumRepoBewertung, raumRepoZeilenKommentar, raumReposPrivat } from "../src/raum-repo.js";
import { gruppenRaum } from "../src/raum-gruppe.js";
import { regelRaumRepoPrivat } from "../src/leak-rules.js";

const eigentuemer = generateKeypair();
const maintainer = generateKeypair();
const autorin = generateKeypair();
const fremd = generateKeypair();
const s = (ev: Parameters<typeof signEvent>[0], k: { sk: Uint8Array }, zeit?: number) =>
  signEvent(zeit === undefined ? ev : { ...ev, created_at: zeit }, k.sk);
const repo = leseRepoAnkuendigung(s(baueRepoAnkuendigung({ id: "app", name: "App", klon: [], maintainer: [maintainer.pk] }, eigentuemer.pk), eigentuemer));
const patch = { id: "a".repeat(64), autor: autorin.pk, kind: KIND_PATCH };
const kennung = (f: () => unknown) => {
  try { f(); } catch (e) { return e instanceof ProtokollFehler ? e.kennung : "anderer Fehler"; }
  return "kein Fehler";
};

test("C-20g1: Kommentar an einer Zeile – NIP-22 am Patch plus Zeilenbezug, streng gelesen", () => {
  const ev = s(baueZeilenKommentar({ patch, zeile: { pfad: "src/a.ts", seite: "neu", zeile: 12 }, text: " Hier fehlt eine Prüfung. " }, maintainer.pk), maintainer, 20);
  assert.equal(ev.kind, KIND_KOMMENTAR);
  assert.deepEqual(ev.tags, [
    ["E", patch.id, "", autorin.pk], ["K", "1617"], ["P", autorin.pk], ["e", patch.id, "", autorin.pk], ["k", "1617"], ["p", autorin.pk],
    ["zeile", "src/a.ts", "neu", "12"],
  ]);
  // Andere Clients lesen es als gewöhnlichen Kommentar am Patch
  assert.equal(leseKommentar(ev).text, "Hier fehlt eine Prüfung.");
  assert.ok(istReviewTeil(ev));
  const [k] = zeilenKommentareZu(patch.id, [ev]);
  assert.deepEqual([k!.zeile, k!.text, k!.autor], [{ pfad: "src/a.ts", seite: "neu", zeile: 12 }, "Hier fehlt eine Prüfung.", maintainer.pk]);
  // Antwort auf einen Zeilenkommentar trägt denselben Bezug
  const antwort = s(baueZeilenKommentar({ patch, eltern: { id: ev.id, autor: maintainer.pk, kind: KIND_KOMMENTAR }, zeile: { pfad: "src/a.ts", seite: "neu", zeile: 12 }, text: "Erledigt." }, autorin.pk), autorin, 30);
  assert.deepEqual(zeilenKommentareZu(patch.id, [antwort, ev]).map((x) => x.text), ["Hier fehlt eine Prüfung.", "Erledigt."], "ältester zuerst");
});

test("C-20g1: Zeilenkommentar bauen – nur an Patches, nur gültige Bezüge; Fremdes fällt beim Lesen heraus", () => {
  const z = { pfad: "src/a.ts", seite: "neu" as const, zeile: 3 };
  assert.equal(kennung(() => baueZeilenKommentar({ patch: { ...patch, kind: 1621 }, zeile: z, text: "x" }, fremd.pk)), "review-patch");
  for (const falsch of [{ ...z, pfad: "" }, { ...z, pfad: "a\nb" }, { ...z, pfad: "x".repeat(REVIEW_GRENZEN.pfad + 1) }, { ...z, zeile: 0 }, { ...z, zeile: 1.5 },
    { ...z, zeile: REVIEW_GRENZEN.zeile + 1 }, { ...z, seite: "mitte" as "neu" }]) {
    assert.equal(kennung(() => baueZeilenKommentar({ patch, zeile: falsch, text: "x" }, fremd.pk)), "review-zeile", JSON.stringify(falsch).slice(0, 60));
  }
  assert.equal(kennung(() => baueZeilenKommentar({ patch, zeile: z, text: " " }, fremd.pk)), "kommentar-leer");
  // Lesen: kaputter Zeilenbezug → kein Zeilenkommentar (als gewöhnlicher Kommentar bleibt er lesbar)
  const gut = s(baueZeilenKommentar({ patch, zeile: z, text: "x" }, fremd.pk), fremd, 5);
  const mit = (zeile: string[]) => s({ ...gut, tags: [...gut.tags.filter((t) => t[0] !== "zeile"), zeile] }, fremd, 5);
  for (const t of [["zeile", "a", "neu", "0"], ["zeile", "a", "neu", "1e3"], ["zeile", "a", "neu", "01"], ["zeile", "", "neu", "1"], ["zeile", "a", "x", "1"], ["zeile", "a", "neu"], ["zeile", "a\u0000b", "alt", "2"]]) {
    assert.equal(leseZeilenbezug(mit(t)), undefined, JSON.stringify(t));
    assert.deepEqual(zeilenKommentareZu(patch.id, [mit(t)]), []);
  }
  assert.deepEqual(leseZeilenbezug(mit(["zeile", "b.ts", "alt", "99"])), { pfad: "b.ts", seite: "alt", zeile: 99 });
  // Nur Kommentare an genau diesem Patch; an Issues gibt es keine Zeilen
  const issueKommentar = baueKommentar({ wurzel: { ...patch, kind: 1621 }, text: "x" }, fremd.pk);
  const anIssue = s({ ...issueKommentar, tags: [...issueKommentar.tags, ["zeile", "a", "neu", "1"]] }, fremd);
  const andererPatch = s(baueZeilenKommentar({ patch: { ...patch, id: "b".repeat(64) }, zeile: z, text: "x" }, fremd.pk), fremd);
  assert.deepEqual(zeilenKommentareZu(patch.id, [anIssue, andererPatch]), []);
});

test("C-20g1: Bewertung – genehmigt oder Änderungen erbeten, Begründung darf fehlen; je Person die neueste, der Autor zählt nicht", () => {
  const ev = s(baueBewertung({ patch, bewertung: "genehmigt" }, maintainer.pk), maintainer, 10);
  assert.deepEqual(ev.tags.slice(-1), [["bewertung", "genehmigt"]]);
  assert.equal(ev.content, "");
  assert.ok(istReviewTeil(ev));
  assert.deepEqual(kommentareZu(patch.id, [ev]), [], "ohne Text kein gewöhnlicher Kommentar");
  const g = leseBewertung(ev);
  assert.deepEqual([g.autor, g.bewertung, g.text, g.patchId], [maintainer.pk, "genehmigt", "", patch.id]);
  assert.equal(kennung(() => baueBewertung({ patch, bewertung: "vielleicht" as "genehmigt" }, fremd.pk)), "review-bewertung");
  assert.equal(kennung(() => baueBewertung({ patch: { ...patch, kind: 1621 }, bewertung: "genehmigt" }, fremd.pk)), "review-patch");
  assert.equal(kennung(() => baueBewertung({ patch: { ...patch, id: "kurz" }, bewertung: "genehmigt" }, fremd.pk)), "kommentar-bezug");
  assert.equal(kennung(() => baueBewertung({ patch, bewertung: "genehmigt", text: "x".repeat(20_001) }, fremd.pk)), "kommentar-gross");

  const bew = (von: typeof fremd, b: "genehmigt" | "aenderungen", zeit: number, text = "") => s(baueBewertung({ patch, bewertung: b, text }, von.pk), von, zeit);
  const stand = bewertungenZu(patch, repo, [
    bew(fremd, "aenderungen", 10, "Bitte Tests."), bew(fremd, "genehmigt", 20),      // Meinung geändert – die neueste gilt
    bew(maintainer, "aenderungen", 15),
    bew(autorin, "genehmigt", 30),                                                     // eigener Patch zählt nicht
    s(baueBewertung({ patch: { ...patch, id: "c".repeat(64) }, bewertung: "genehmigt" }, eigentuemer.pk), eigentuemer, 40), // anderer Patch
  ]);
  assert.deepEqual(stand.map((b) => [b.autor, b.bewertung, b.maintainer]), [[maintainer.pk, "aenderungen", true], [fremd.pk, "genehmigt", false]]);
  // Gleiche Sekunde: die größere Id entscheidet, gleich in welcher Reihenfolge sie kommen
  const a = bew(eigentuemer, "genehmigt", 50), b = bew(eigentuemer, "aenderungen", 50);
  const sieger = a.id > b.id ? "genehmigt" : "aenderungen";
  assert.equal(bewertungenZu(patch, repo, [a, b])[0]!.bewertung, sieger);
  assert.equal(bewertungenZu(patch, repo, [b, a])[0]!.bewertung, sieger);
});

test("C-20g1: Bewertung streng lesen – nur direkt am Patch, nur bekannte Werte", () => {
  const gut = s(baueBewertung({ patch, bewertung: "aenderungen", text: "Bitte kleiner." }, fremd.pk), fremd, 5);
  const mit = (tags: string[][]) => s({ ...gut, tags }, fremd, 5);
  const ersetze = (name: string, wert: string[]) => gut.tags.map((t) => (t[0] === name ? wert : t));
  assert.throws(() => leseBewertung(mit(ersetze("bewertung", ["bewertung", "super"]))), /unbekannt/);
  assert.throws(() => leseBewertung(mit(gut.tags.filter((t) => t[0] !== "bewertung"))), /unbekannt/);
  assert.throws(() => leseBewertung(mit(ersetze("K", ["K", "1621"]))), /nicht direkt an einem Patch/);
  assert.throws(() => leseBewertung(mit(ersetze("e", ["e", "d".repeat(64), "", fremd.pk]))), /nicht direkt an einem Patch/, "als Antwort ist es keine Bewertung");
  assert.throws(() => leseBewertung({ ...gut, kind: 1 }), /Keine Bewertung/);
  assert.equal(leseBewertung(gut).text, "Bitte kleiner.");
  assert.deepEqual(bewertungenZu(patch, repo, [mit(ersetze("bewertung", ["bewertung", "super"]))]), []);
});

test("C-20g1: im privaten Raum nur innere Events – Zeilenkommentar und Bewertung kommen mit den Kommentaren", () => {
  const admin = eigentuemer.pk;
  let n = 0;
  const innen = (von: string, x: { art: number; tags: string[][]; text: string }) =>
    ({ id: (++n).toString(16).padStart(64, "0"), von, art: x.art, tags: x.tags, text: x.text, zeit: 1_790_000_000 + n });
  const ank = innen(admin, { art: 30617, tags: [["space", "g"], ["d", "app"], ["name", "App"]], text: "" });
  const pat = innen(autorin.pk, { art: KIND_PATCH, tags: [["space", "g"], ["a", `30617:${admin}:app`]], text: "From x" });
  const bezug = { id: pat.id, autor: autorin.pk, kind: KIND_PATCH };
  const zk = innen(fremd.pk, raumRepoZeilenKommentar("g", { patch: bezug, zeile: { pfad: "a.ts", seite: "alt", zeile: 7 }, text: "Warum weg?" }));
  const bw = innen(admin, raumRepoBewertung("g", { patch: bezug, bewertung: "genehmigt", text: "Gut so." }));
  for (const x of [zk, bw]) assert.ok(RAUM_REPO_ARTEN.includes(x.art) && x.tags[0][0] === "space" && x.tags[0][1] === "g");
  const zustand = gruppenRaum("g", [ank, pat, zk, bw], { admins: [admin], mitglieder: [admin, autorin.pk, fremd.pk] }).zustand;
  const r = raumReposPrivat("g", [ank, pat, zk, bw], zustand);
  assert.deepEqual(zeilenKommentareZu(pat.id, r.kommentare).map((k) => [k.zeile.seite, k.zeile.zeile, k.text]), [["alt", 7, "Warum weg?"]]);
  assert.deepEqual(bewertungenZu(bezug, leseRepoAnkuendigung(r.ankuendigungen[0]), r.kommentare).map((b) => [b.bewertung, b.maintainer]), [["genehmigt", true]]);
});

test("raum-repo-privat (C-20g1): eine offene Bewertung oder ein offener Zeilenkommentar zu einem inneren Patch ist ein Leck", () => {
  const INNERES = "9".repeat(64);
  const innererPatch = { id: INNERES, autor: autorin.pk, kind: KIND_PATCH };
  const offen: NostrEvent[] = [
    s(baueBewertung({ patch: innererPatch, bewertung: "genehmigt" }, fremd.pk), fremd),
    s(baueZeilenKommentar({ patch: innererPatch, zeile: { pfad: "a", seite: "neu", zeile: 1 }, text: "x" }, fremd.pk), fremd),
  ];
  const funde = regelRaumRepoPrivat(offen, { repoIds: [], schluessel: [], innere: [INNERES] });
  assert.deepEqual(funde.map((f) => f.detail), ["Repo eines privaten Raums offen (Kind 1111)", "Repo eines privaten Raums offen (Kind 1111)"]);
});
