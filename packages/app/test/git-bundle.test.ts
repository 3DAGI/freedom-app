/**
 * Schritt C.3c1 (E4): Git-Bundle-Leser – echte Bundles von git (v2 und v3,
 * mit Deltas, `test/fixtures/probe-v*.bundle`) und von Hand gebaute Packs
 * gegen feindliche Eingaben: Prüfsumme, Grenzen, Deltas, Tiefe, Unfug.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import {
  BUNDLE_GRENZEN, BundleFehler, type BundleFehlerArt, type GelesenesBundle, type GitObjekt, alsText, commitsAb, kopfCommit, leseBaum, leseBundle, leseCommit, objektSha,
  unterPfad, wendeDeltaAn, zweigeUndTags,
} from "../src/git-bundle.js";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
const text = (d: Uint8Array) => new TextDecoder().decode(d);
const HEAD = "590c7cf524d41ca3f9e65874a6a9e7197ab826a7";

async function art(p: Promise<unknown>): Promise<BundleFehlerArt | "keiner"> {
  try {
    await p;
    return "keiner";
  } catch (e) {
    assert.ok(e instanceof BundleFehler, String(e));
    return e.art;
  }
}

test("C.3c1: echtes Bundle (v2 und v3, mit Deltas) – Refs, Objekte, Kennungen wie bei git", async () => {
  for (const name of ["probe-v2.bundle", "probe-v3.bundle"]) {
    const b = await leseBundle(fixture(name));
    assert.equal(b.version, name.includes("v3") ? 3 : 2);
    assert.deepEqual(b.refs.map((r) => r.name).sort(), ["HEAD", "refs/heads/main"]);
    assert.equal(b.objekte.size, 10, "alle zehn Objekte, auch die zwei Deltas");
    assert.equal(kopfCommit(b), HEAD);
    const commits = commitsAb(b, HEAD);
    assert.deepEqual(commits.map((c) => [c.sha.slice(0, 7), c.betreff]), [["590c7cf", "Liste ergänzt"], ["19998a4", "Erster Stand"]]);
    assert.equal(commits[0]!.autor, "Probe");
    assert.equal(commits[0]!.zeit, Date.parse("2026-09-02T11:00:00+02:00") / 1000);
    assert.equal(commits[0]!.nachricht, "Liste ergänzt\n\nMit einer zweiten Zeile in der Nachricht.");
    const wurzel = leseBaum(b.objekte.get(commits[0]!.baum)!.daten);
    assert.deepEqual(wurzel.map((e) => [e.name, e.art]), [["src", "ordner"], ["bild.bin", "datei"], ["README.md", "datei"]]);
    const liesmich = b.objekte.get(wurzel.find((e) => e.name === "README.md")!.sha)!;
    assert.match(text(liesmich.daten), /^# Werkzeug\n/);
    // Die Liste im zweiten Commit ist im Pack ein Delta – aufgelöst stimmt ihr Inhalt
    const src = leseBaum(b.objekte.get(wurzel[0]!.sha)!.daten);
    const liste = text(b.objekte.get(src[0]!.sha)!.daten);
    assert.match(liste, /^Zeile 60 \(neu\): Hammer/m);
    assert.equal(liste.split("\n").length, 121);
  }
});

// ---- Von Hand gebaute Packs ------------------------------------------------

const typNr = { commit: 1, tree: 2, blob: 3, tag: 4, ofs: 6, ref: 7 } as const;
function kopf(typ: number, groesse: number): number[] {
  const aus = [(typ << 4) | (groesse & 15)];
  groesse = Math.floor(groesse / 16);
  while (groesse > 0) {
    aus[aus.length - 1]! |= 0x80;
    aus.push(groesse & 0x7f);
    groesse = Math.floor(groesse / 128);
  }
  return aus;
}
type Teil = { typ: number; daten: Uint8Array; vor?: number[] };
function pack(teile: Teil[], anzahl = teile.length, falscheSumme = false): Uint8Array {
  const kopfBytes = [...Buffer.from("PACK"), 0, 0, 0, 2, (anzahl >>> 24) & 255, (anzahl >>> 16) & 255, (anzahl >>> 8) & 255, anzahl & 255];
  const inhalt = Buffer.concat([Buffer.from(kopfBytes), ...teile.map((t) => Buffer.concat([Buffer.from(kopf(t.typ, t.daten.length)), Buffer.from(t.vor ?? []), deflateSync(t.daten)]))]);
  const summe = createHash("sha1").update(inhalt).digest();
  if (falscheSumme) summe[0]! ^= 1;
  return new Uint8Array(Buffer.concat([inhalt, summe]));
}
const bundle = (p: Uint8Array, refs = `${"a".repeat(40)} refs/heads/main\n`) => new Uint8Array(Buffer.concat([Buffer.from(`# v2 git bundle\n${refs}\n`), Buffer.from(p)]));
const blob = (s: string) => new Uint8Array(Buffer.from(s));
/** Delta: Länge der Basis, Länge des Ziels, dann Befehle. */
const delta = (...b: number[]) => new Uint8Array(b);

test("C.3c1: Deltas – OFS und REF, Kopieren und Einfügen, Kennung des Ergebnisses", async () => {
  const basis = blob("Hallo Welt");
  // 0x90: kopieren, Versatz 0, Größe 6 („Hallo “); 6: sechs Bytes einfügen („Leute!“)
  const gut = delta(10, 12, 0x90, 6, 6, ...Buffer.from("Leute!"));
  assert.equal(text(wendeDeltaAn(basis, gut)), "Hallo Leute!");
  assert.throws(() => wendeDeltaAn(basis, delta(10, 13, 0x90, 6, 6, ...Buffer.from("Leute!"))), BundleFehler, "Zielgröße stimmt nicht");
  assert.throws(() => wendeDeltaAn(basis, delta(9, 12, 0x90, 6, 6, ...Buffer.from("Leute!"))), BundleFehler, "Basisgröße stimmt nicht");
  const basisSha = await objektSha("blob", basis);
  const ofsVersatz = 12; // die Basis steht direkt nach dem Pack-Kopf
  const erstes = pack([{ typ: typNr.blob, daten: basis }]);
  const zweitesAb = erstes.length - 20; // Anfang des zweiten Eintrags in einem Pack mit beiden
  const mitOfs = pack([{ typ: typNr.blob, daten: basis }, { typ: typNr.ofs, daten: gut, vor: [zweitesAb - ofsVersatz] }]);
  const mitRef = pack([{ typ: typNr.ref, daten: gut, vor: [...Buffer.from(basisSha, "hex")] }, { typ: typNr.blob, daten: basis }]);
  for (const p of [mitOfs, mitRef]) {
    const b = await leseBundle(bundle(p));
    const ziel = [...b.objekte.values()].find((o) => text(o.daten) === "Hallo Leute!");
    assert.ok(ziel, "Delta aufgelöst");
    assert.ok(b.objekte.has(await objektSha("blob", blob("Hallo Leute!"))));
  }
});

test("C.3c1: feindlich – Kopf, Prüfsumme, Anzahl, Grenzen, kaputte Deltas; immer BundleFehler mit Kennung", async () => {
  const eins = pack([{ typ: typNr.blob, daten: blob("x") }]);
  assert.equal(await art(leseBundle(bundle(eins))), "keiner");
  assert.equal(await art(leseBundle(new Uint8Array())), "format");
  assert.equal(await art(leseBundle(blob("# v9 git bundle\n\nPACK"))), "format");
  assert.equal(await art(leseBundle(bundle(eins, "kein-sha refs/heads/main\n"))), "format");
  assert.equal(await art(leseBundle(bundle(eins, `${"a".repeat(40)} refs/\u0007böse\n`))), "format");
  assert.equal(await art(leseBundle(blob(`# v3 git bundle\n@object-format=sha256\n${"a".repeat(40)} HEAD\n\n`))), "format");
  assert.equal(await art(leseBundle(bundle(pack([{ typ: typNr.blob, daten: blob("x") }], 1, true)))), "pruefsumme");
  assert.equal(await art(leseBundle(bundle(pack([{ typ: typNr.blob, daten: blob("x") }], 2)))), "kaputt", "Anzahl zu groß");
  assert.equal(await art(leseBundle(bundle(pack([{ typ: typNr.blob, daten: blob("x") }], 50_000)))), "objekte");
  assert.equal(await art(leseBundle(bundle(pack([{ typ: 5, daten: blob("x") }])))), "kaputt", "Typ 5 gibt es nicht");
  assert.equal(await art(leseBundle(new Uint8Array(BUNDLE_GRENZEN.bytes + 1))), "gross");
  // Behauptete Größe passt nicht zum Inhalt
  const luege = new Uint8Array(eins);
  luege[12] = (typNr.blob << 4) | 2;
  const neu = new Uint8Array(Buffer.concat([Buffer.from(luege.subarray(0, luege.length - 20)), createHash("sha1").update(luege.subarray(0, luege.length - 20)).digest()]));
  assert.equal(await art(leseBundle(bundle(neu))), "entpacken");
  // Delta auf eine Basis, die es nicht gibt; Delta, das über die Basis hinaus kopiert
  assert.equal(await art(leseBundle(bundle(pack([{ typ: typNr.ref, daten: delta(1, 1, 0x90, 1), vor: Array(20).fill(7) }])))), "delta");
  assert.throws(() => wendeDeltaAn(blob("ab"), delta(2, 5, 0x91, 0, 5)), BundleFehler);
  assert.throws(() => wendeDeltaAn(blob("ab"), delta(2, 1, 0)), BundleFehler, "Befehl 0 ist reserviert");
  assert.throws(() => wendeDeltaAn(blob("ab"), delta(2, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01)), BundleFehler, "Ziel zu groß");
  // Grenzen über die Einstellungen: Tiefe und Gesamtgröße
  const kette: Teil[] = [{ typ: typNr.blob, daten: blob("a") }];
  let vorher = 12; // Anfang des vorigen Eintrags
  for (let n = 0; n < 3; n++) {
    const anfang = pack(kette).length - 20;
    kette.push({ typ: typNr.ofs, daten: delta(1, 1, 1, 0x61 + n + 1), vor: [anfang - vorher] });
    vorher = anfang;
  }
  assert.equal(await art(leseBundle(bundle(pack(kette)))), "keiner");
  assert.equal(await art(leseBundle(bundle(pack(kette)), { ...BUNDLE_GRENZEN, tiefe: 2 })), "tiefe");
  assert.equal(await art(leseBundle(bundle(pack(kette)), { ...BUNDLE_GRENZEN, entpackt: 3 })), "gross");
});

test("C.3c1: Commit und Baum streng gelesen – Unfug wirft, Pfade ohne „/“ und „..“", () => {
  const c = leseCommit(blob(`tree ${"b".repeat(40)}\nparent ${"c".repeat(40)}\nparent kaputt\nauthor Ada <a@x> 1800000000 +0200\ncommitter Ada <a@x> 1800000000 +0200\n\nBetreff\n\nText`));
  assert.deepEqual([c.baum, c.eltern, c.autor, c.zeit, c.betreff], ["b".repeat(40), ["c".repeat(40)], "Ada", 1800000000, "Betreff"]);
  assert.throws(() => leseCommit(blob("kein commit")), BundleFehler);
  const eintrag = (modus: string, name: string) => Buffer.concat([Buffer.from(`${modus} ${name}\0`), Buffer.alloc(20, 1)]);
  assert.deepEqual(leseBaum(new Uint8Array(Buffer.concat([eintrag("100644", "b.txt"), eintrag("40000", "z"), eintrag("120000", "l"), eintrag("160000", "m")]))).map((e) => [e.name, e.art]),
    [["z", "ordner"], ["b.txt", "datei"], ["l", "link"], ["m", "modul"]]);
  for (const boese of [eintrag("100644", "../x"), eintrag("100644", "a/b"), eintrag("100644", ".."), eintrag("abc", "x"), Buffer.from("100644 x\0kurz")]) {
    assert.throws(() => leseBaum(new Uint8Array(boese)), BundleFehler, String(boese));
  }
});

test("C.3c1: verdrahtet – Reiter „Code“ lädt erst auf Knopfdruck, liest im Speicher, zeigt nur Text", () => {
  const code = readFileSync(new URL("../src/shell/tabs/code-reiter.ts", import.meta.url), "utf8");
  const seite = readFileSync(new URL("../src/shell/tabs/repo-seite.ts", import.meta.url), "utf8");
  assert.doesNotMatch(code, /innerHTML/);
  assert.match(seite, /reiter === "code" \? codeReiter\(k\.bundle, k\.name, \(\) => zeigeRepoSeite\(box, k, h, "code"\)\)/);
  // Laden nur im Klick-Handler von „Code laden“ (seit C.3c2 geteilt mit „Commits“), dann lesen, Fehler als Kennung → Text
  const klick = code.slice(code.indexOf('laden.addEventListener("click"'), code.indexOf("return [hinweis, laden, fehler];"));
  assert.match(klick, /const bytes = await holeBundle\(bundle\);/);
  assert.match(klick, /await leseBundle\(bytes\)/);
  assert.match(klick, /e instanceof BundleFehler \? t\(FEHLER\[e\.art\]\) : fehlerText\(e\)/);
  // README und Dateien nur als Text und nur, wenn sie Text sind (alsText: kein Nullbyte, gültiges UTF-8)
  assert.match(code, /el\("pre", inhalt\.slice\(0, TEXT_MAX\), "code-readme"\)/);
  assert.match(code, /el\("pre", text\.slice\(0, TEXT_MAX\), "code-datei"\)/);
});

test("C.3c2: Pfade im Baum – Ordner, Datei, durch Dateien hindurch und „..“ gibt es nicht", async () => {
  const b = await leseBundle(fixture("probe-v2.bundle"));
  const baum = commitsAb(b, HEAD, 1)[0]!.baum;
  const wurzel = unterPfad(b, baum, []);
  assert.equal(wurzel?.art, "ordner");
  assert.deepEqual(wurzel?.art === "ordner" && wurzel.eintraege.map((e) => e.name), ["src", "bild.bin", "README.md"]);
  const src = unterPfad(b, baum, ["src"]);
  assert.deepEqual(src?.art === "ordner" && src.eintraege.map((e) => e.name), ["liste.txt"]);
  const liste = unterPfad(b, baum, ["src", "liste.txt"]);
  assert.equal(liste?.art, "datei");
  assert.match(liste?.art === "datei" ? alsText(liste.daten)! : "", /^Zeile 0: Hammer/);
  for (const falsch of [["gibt-es-nicht"], ["README.md", "x"], [".."], ["src", ""], ["src", "..", "README.md"], ["SRC"]]) {
    assert.equal(unterPfad(b, baum, falsch), null, falsch.join("/"));
  }
  assert.equal(unterPfad(b, "0".repeat(40), []), null, "Baum fehlt im Bundle");
});

test("C.3c2: Text nur, wenn es Text ist – Nullbyte und kaputtes UTF-8 gelten als binär", async () => {
  assert.equal(alsText(blob("Grüße\n")), "Grüße\n");
  assert.equal(alsText(new Uint8Array([0x61, 0x00, 0x62])), null);
  assert.equal(alsText(new Uint8Array([0x61, 0xff, 0x62])), null);
  const b = await leseBundle(fixture("probe-v2.bundle"));
  const bild = unterPfad(b, commitsAb(b, HEAD, 1)[0]!.baum, ["bild.bin"]);
  assert.equal(bild?.art === "datei" ? alsText(bild.daten) : "?", null);
});

test("C.3c2: verdrahtet – Reiter „Commits“, Ort im Code nur im Speicher, Einträge als Knöpfe", () => {
  const code = readFileSync(new URL("../src/shell/tabs/code-reiter.ts", import.meta.url), "utf8");
  const seite = readFileSync(new URL("../src/shell/tabs/repo-seite.ts", import.meta.url), "utf8");
  assert.match(seite, /reiterKnopf\("commits", t\("repo\.commits"\)\)/);
  assert.match(seite, /reiter === "commits" \? commitsReiter\(k\.bundle, angenommen, \(\) => zeigeRepoSeite\(box, k, h, "commits"\)\)/);
  // Ohne Bundle: nur angenommene Patches mit ihren Commits aus dem geltenden Status
  assert.match(seite, /const angenommen = k\.zeilen\.filter\(\(z\) => z\.status === "angenommen"\)\.map\(\(z\) => \(\{ betreff: z\.patch\.betreff, commits: z\.commits \?\? \[\] \}\)\);/);
  assert.match(code, /const commits = commitsAb\(b, kopf, COMMITS_MAX \+ 1\);/);
  assert.match(code, /const ort = new Map<string, string\[\]>\(\);/);
  for (const [name, text] of [["code-reiter.ts", code], ["repo-seite.ts", seite]]) assert.doesNotMatch(text, /location\.hash|history\.(push|replace)State/, name);
  // Ordner und Dateien sind Knöpfe (Tastatur), Submodule nur Text
  assert.match(code, /knopf\(e\.art === "ordner" \? `\$\{e\.name\}\/` : e\.name, "code-eintrag", \(\) => geh\(\[\.\.\.pfad, e\.name\]\)\)/);
});

test("C-20c: Zweige und Tags – annotierte Tags aufgelöst, nur Commits im Bundle, Zweige zuerst", async () => {
  // test/fixtures/probe-md.bundle: main (e580805), entwurf (ein Commit weiter), v1.0 annotiert auf main
  const b = await leseBundle(fixture("probe-md.bundle"));
  assert.deepEqual(zweigeUndTags(b).map((r) => [r.art, r.name, r.commit.slice(0, 7)]), [["zweig", "entwurf", "bc6721b"], ["zweig", "main", "e580805"], ["tag", "v1.0", "e580805"]]);
  assert.equal(kopfCommit(b)?.slice(0, 7), "e580805");
  assert.deepEqual(commitsAb(b, zweigeUndTags(b)[0]!.commit, 5).map((c) => c.betreff), ["Entwurf: neuer Titel", "Werkzeugkiste mit Anleitung"]);
  // Von Hand: Tag ins Leere, Tag auf Blob, Tag auf Tag (aufgelöst), Ref ohne Objekt, doppelt, fremde Namen, zu lang
  const sha = (n: number) => n.toString(16).padStart(40, "0");
  const tag = (ziel: string): GitObjekt => ({ art: "tag", daten: new TextEncoder().encode(`object ${ziel}\ntype commit\ntag x\n\nText`) });
  const hand: GelesenesBundle = {
    version: 2, voraussetzungen: [],
    objekte: new Map<string, GitObjekt>([
      [sha(1), { art: "commit", daten: new Uint8Array() }], [sha(2), { art: "blob", daten: new Uint8Array() }],
      [sha(3), tag(sha(9))], [sha(4), tag(sha(2))], [sha(5), tag(sha(1))], [sha(6), tag(sha(5))],
    ]),
    refs: [
      { name: "HEAD", sha: sha(1) }, { name: "refs/heads/b", sha: sha(1) }, { name: "refs/heads/b", sha: sha(2) }, { name: "refs/heads/a", sha: sha(8) },
      { name: "refs/tags/leer", sha: sha(3) }, { name: "refs/tags/blob", sha: sha(4) }, { name: "refs/tags/doppelt", sha: sha(6) },
      { name: "refs/remotes/origin/x", sha: sha(1) }, { name: `refs/heads/${"l".repeat(201)}`, sha: sha(1) },
    ],
  };
  assert.deepEqual(zweigeUndTags(hand).map((r) => [r.art, r.name, r.commit]), [["zweig", "b", sha(1)], ["tag", "doppelt", sha(1)]]);
});

test("Verdrahtung (C-20c): Code und Commits zeigen den gewählten Stand – Wahl nur im Speicher, nie in der Adresse", () => {
  const code = readFileSync(new URL("../src/shell/tabs/code-reiter.ts", import.meta.url), "utf8");
  assert.match(code, /const refWahl = new Map<string, string>\(\);/);
  assert.match(code, /const kopf = stand\(b, id\)\.commit;/, "Reiter „Code“");
  assert.match(code, /const kopf = stand\(b, bundle\.id\)\.commit;\s*if \(!kopf\)[^\n]*\n\s*const commits = commitsAb\(b, kopf, COMMITS_MAX \+ 1\);/, "Reiter „Commits“");
  assert.match(code, /refWahl\.delete\(alt\);/, "vergessen, wenn das Bundle aus dem Speicher fällt");
  assert.doesNotMatch(code, /location\.hash|history\.(push|replace)State|localStorage/);
});
