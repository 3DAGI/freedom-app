/**
 * Vibecoden auf dem eigenen Knoten (A-31, VKa): Code-Aufträge nur versiegelt
 * mit Besitzer-Nachweis; Aktionen, Schritte und Antworten nur in ihrer festen
 * Form – was nicht passt, liest niemand.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODE_GRENZEN, KIND_DVM_KNOTEN_CODE, KIND_GIFT_WRAP, LocalSigner, baueCodeAuftrag, buildJobRequest, codeAntwortText,
  codeSchrittText, generateKeypair, getTag, istBesitzer, istProjektName, leseCodeAntwort, leseCodeAuftrag, leseCodeSchritt,
  neueKopplung, openPrivateKundenEvent, resultKindFor, type CodeAktion, type CodeAntwort, type CodeSchritt,
} from "../src/index.js";

const LAUF = "ab".repeat(32);
const SCHLUESSEL = { alg: "aes-gcm", key: "11".repeat(32), nonce: "22".repeat(12), ox: "33".repeat(32) } as const;

/** Kern mit genau diesen Parametern – so prüft der Knoten fremd Gebautes. */
const kern = (params: string[][], kind = KIND_DVM_KNOTEN_CODE) =>
  buildJobRequest({ kind, customerPubkey: "cd".repeat(32), input: "code", bidMsat: 0, params }, 1_790_000_000);

test("A-31: baueCodeAuftrag – versiegelt an den Knoten, Kern 5080 ohne Gebot, mit Nachweis; Antwort 6080", async () => {
  const knoten = generateKeypair();
  const k = neueKopplung(knoten.pk);
  const sitzung = new LocalSigner(generateKeypair().sk);
  const aktion: CodeAktion = { aktion: "auftrag", projekt: "meine-app", text: "Baue eine Einkaufsliste mit Häkchen.", modus: "fragen" };
  const { wrap, requestId } = await baueCodeAuftrag({ sitzung, kopplung: k, aktion });
  assert.equal(wrap.kind, KIND_GIFT_WRAP);
  // Offen nur der Empfänger – Kind, Projekt und Wunsch stehen nur im versiegelten Kern
  assert.deepEqual(wrap.tags, [["p", knoten.pk]]);
  for (const geheim of [k.geheimnis, sitzung.publicKey(), "Einkaufsliste", "meine-app"]) assert.ok(!JSON.stringify(wrap).includes(geheim));
  const r = await openPrivateKundenEvent(wrap, new LocalSigner(knoten.sk));
  assert.ok(r.ok);
  assert.equal(r.request.id, requestId);
  assert.equal(r.request.kind, KIND_DVM_KNOTEN_CODE);
  assert.equal(getTag(r.request, "bid"), "0");
  assert.ok(istBesitzer(r.request, [k.geheimnis], r.request.created_at));
  assert.ok(!istBesitzer(r.request, [neueKopplung(knoten.pk).geheimnis], r.request.created_at), "ein anderes Geheimnis ist nicht der Besitzer");
  assert.deepEqual(leseCodeAuftrag(r.request), aktion);
  assert.equal(resultKindFor(KIND_DVM_KNOTEN_CODE), 6080);
});

test("A-31: jede Aktion übersteht Bauen und Lesen unverändert", async () => {
  const knoten = generateKeypair();
  const k = neueKopplung(knoten.pk);
  const aktionen: CodeAktion[] = [
    { aktion: "liste" },
    { aktion: "neu", projekt: "a" },
    { aktion: "auftrag", projekt: "x-1", text: "a".repeat(CODE_GRENZEN.text), modus: "frei" },
    { aktion: "freigabe", lauf: LAUF, schritt: 1, ja: true },
    { aktion: "freigabe", lauf: LAUF, schritt: CODE_GRENZEN.schritte, ja: false },
    { aktion: "stopp", lauf: LAUF },
    { aktion: "bundle", projekt: "meine-app" },
  ];
  for (const aktion of aktionen) {
    const { wrap } = await baueCodeAuftrag({ sitzung: new LocalSigner(generateKeypair().sk), kopplung: k, aktion });
    const r = await openPrivateKundenEvent(wrap, new LocalSigner(knoten.sk));
    assert.ok(r.ok);
    assert.deepEqual(leseCodeAuftrag(r.request), aktion, aktion.aktion);
  }
});

test("A-31: ungültige Aktionen baut die App nicht", async () => {
  const k = neueKopplung(generateKeypair().pk);
  const sitzung = new LocalSigner(generateKeypair().sk);
  for (const aktion of [
    { aktion: "neu", projekt: "Mit Großbuchstaben" },
    { aktion: "neu", projekt: "../etc" },
    { aktion: "neu", projekt: "-vorne" },
    { aktion: "neu", projekt: "a".repeat(41) },
    { aktion: "auftrag", projekt: "app", text: "   ", modus: "frei" },
    { aktion: "auftrag", projekt: "app", text: "a".repeat(CODE_GRENZEN.text + 1), modus: "frei" },
    { aktion: "auftrag", projekt: "app", text: "x", modus: "immer" },
    { aktion: "freigabe", lauf: "ab", schritt: 1, ja: true },
    { aktion: "freigabe", lauf: LAUF, schritt: 0, ja: true },
    { aktion: "freigabe", lauf: LAUF, schritt: CODE_GRENZEN.schritte + 1, ja: true },
    { aktion: "stopp", lauf: LAUF.toUpperCase() },
    { aktion: "loeschen" },
  ]) await assert.rejects(baueCodeAuftrag({ sitzung, kopplung: k, aktion: aktion as CodeAktion }), /ungültig/, JSON.stringify(aktion));
});

test("A-31: leseCodeAuftrag – nur bekannte Aktionen, je Parameter genau ein Wert, keine fremden", () => {
  assert.deepEqual(leseCodeAuftrag(kern([["aktion", "stopp"], ["lauf", LAUF]])), { aktion: "stopp", lauf: LAUF });
  for (const params of [
    [],
    [["aktion", "loeschen"]],
    [["aktion", "liste"], ["aktion", "liste"]],
    [["aktion", "liste"], ["projekt", "a"]],
    [["aktion", "neu"]],
    [["aktion", "neu"], ["projekt", "a"], ["projekt", "b"]],
    [["aktion", "neu"], ["projekt", "a", "zusatz"]],
    [["aktion", "auftrag"], ["projekt", "a"], ["text", "x"]],
    [["aktion", "freigabe"], ["lauf", LAUF], ["schritt", "01"], ["antwort", "ja"]],
    [["aktion", "freigabe"], ["lauf", LAUF], ["schritt", "1.5"], ["antwort", "ja"]],
    [["aktion", "freigabe"], ["lauf", LAUF], ["schritt", "1"], ["antwort", "vielleicht"]],
    [["aktion", "stopp"], ["lauf", LAUF], ["befehl", "rm -rf /"]],
  ]) assert.equal(leseCodeAuftrag(kern(params)), null, JSON.stringify(params));
  assert.equal(leseCodeAuftrag(kern([["aktion", "liste"]], 5079)), null, "anderes Kind");
});

test("A-31: Schritte – Befehl mit Gedanke, Ausgabe mit Rückgabewert; anderes liest die App nicht", () => {
  const befehl: CodeSchritt = { nr: 1, art: "befehl", gedanke: "Erst schauen, was da ist.", befehl: "ls -la", wartet: true };
  const ausgabe: CodeSchritt = { nr: 1, art: "ausgabe", ausgabe: "index.html\n", code: 0, gekuerzt: false };
  const zeit: CodeSchritt = { nr: 2, art: "ausgabe", ausgabe: "", code: -1, gekuerzt: false };
  for (const s of [befehl, ausgabe, zeit]) assert.deepEqual(leseCodeSchritt(codeSchrittText(s)), s);
  const mit = (s: CodeSchritt, a: Record<string, unknown>) => JSON.stringify({ ...s, ...a });
  for (const kaputt of [
    "", "{", "null", "[]", "1",
    mit(befehl, { nr: 0 }), mit(befehl, { nr: CODE_GRENZEN.schritte + 1 }), mit(befehl, { art: "denken" }),
    mit(befehl, { befehl: " " }), mit(befehl, { befehl: "x".repeat(CODE_GRENZEN.befehl + 1) }),
    mit(befehl, { gedanke: "x".repeat(CODE_GRENZEN.gedanke + 1) }), mit(befehl, { wartet: "ja" }), mit(befehl, { zusatz: 1 }),
    mit(ausgabe, { ausgabe: "x".repeat(CODE_GRENZEN.ausgabe + 1) }), mit(ausgabe, { code: 256 }), mit(ausgabe, { code: -2 }),
    mit(ausgabe, { code: 1.5 }), mit(ausgabe, { gekuerzt: 1 }), mit(ausgabe, { befehl: "ls" }),
  ]) assert.equal(leseCodeSchritt(kaputt), null, kaputt.slice(0, 120));
  assert.throws(() => codeSchrittText({ ...befehl, nr: 0 }), /ungültig/);
});

test("A-31: Antworten – je Aktion feste Form, gelesen nur zur erwarteten Aktion", () => {
  const antworten: CodeAntwort[] = [
    { aktion: "liste", projekte: [{ name: "meine-app", schritte: 12, geaendert: 1_790_000_000 }, { name: "spiel", schritte: 0, geaendert: 0 }] },
    { aktion: "liste", projekte: [] },
    { aktion: "neu", projekt: "meine-app" },
    { aktion: "auftrag", ende: "fertig", schritte: 7, abschluss: "Liste mit Häkchen gebaut." },
    { aktion: "auftrag", ende: "grenze", schritte: CODE_GRENZEN.schritte, abschluss: "" },
    { aktion: "freigabe", ok: true },
    { aktion: "stopp", ok: false },
    { aktion: "bundle", blob: "ab".repeat(32), manifest: "cd".repeat(32), schluessel: SCHLUESSEL, bytes: 1234 },
  ];
  for (const a of antworten) assert.deepEqual(leseCodeAntwort(codeAntwortText(a), a.aktion), a, a.aktion);
  assert.equal(leseCodeAntwort(codeAntwortText({ aktion: "freigabe", ok: true }), "stopp"), null, "Antwort zu einer anderen Aktion");
  const projekt = { name: "a", schritte: 1, geaendert: 1 };
  for (const [kaputt, erwartet] of [
    ["", "liste"], ["{", "liste"], ["[]", "liste"],
    [JSON.stringify({ aktion: "liste", projekte: [projekt, projekt] }), "liste"],
    [JSON.stringify({ aktion: "liste", projekte: Array.from({ length: CODE_GRENZEN.projekte + 1 }, (_, i) => ({ ...projekt, name: `p${i}` })) }), "liste"],
    [JSON.stringify({ aktion: "liste", projekte: [{ ...projekt, name: "../x" }] }), "liste"],
    [JSON.stringify({ aktion: "liste", projekte: [{ ...projekt, pfad: "/home" }] }), "liste"],
    [JSON.stringify({ aktion: "liste", projekte: [], zusatz: 1 }), "liste"],
    [JSON.stringify({ aktion: "neu", projekt: "A" }), "neu"],
    [JSON.stringify({ aktion: "auftrag", ende: "explodiert", schritte: 1, abschluss: "" }), "auftrag"],
    [JSON.stringify({ aktion: "auftrag", ende: "fertig", schritte: -1, abschluss: "" }), "auftrag"],
    [JSON.stringify({ aktion: "auftrag", ende: "fertig", schritte: 1, abschluss: "x".repeat(CODE_GRENZEN.abschluss + 1) }), "auftrag"],
    [JSON.stringify({ aktion: "freigabe", ok: "ja" }), "freigabe"],
    // VKl: Bundle nur mit Blob, Manifest, gültigem Schlüssel und Größe in den Grenzen – nichts dazu
    [JSON.stringify({ aktion: "bundle", blob: "zz".repeat(32), manifest: "cd".repeat(32), schluessel: SCHLUESSEL, bytes: 1 }), "bundle"],
    [JSON.stringify({ aktion: "bundle", blob: "ab".repeat(32), manifest: "cd".repeat(32), schluessel: { ...SCHLUESSEL, key: "kurz" }, bytes: 1 }), "bundle"],
    [JSON.stringify({ aktion: "bundle", blob: "ab".repeat(32), manifest: "cd".repeat(32), schluessel: { ...SCHLUESSEL, mehr: 1 }, bytes: 1 }), "bundle"],
    [JSON.stringify({ aktion: "bundle", blob: "ab".repeat(32), manifest: "cd".repeat(32), schluessel: SCHLUESSEL, bytes: 0 }), "bundle"],
    [JSON.stringify({ aktion: "bundle", blob: "ab".repeat(32), manifest: "cd".repeat(32), schluessel: SCHLUESSEL, bytes: CODE_GRENZEN.bundle + 1 }), "bundle"],
    [JSON.stringify({ aktion: "bundle", blob: "ab".repeat(32), manifest: "cd".repeat(32), schluessel: SCHLUESSEL, bytes: 1, pfad: "/x" }), "bundle"],
  ] as const) assert.equal(leseCodeAntwort(kaputt, erwartet), null, kaputt.slice(0, 120));
  assert.throws(() => codeAntwortText({ aktion: "neu", projekt: "Groß" }), /ungültig/);
});

test("A-31: Projektnamen taugen als Ordnername – klein, ohne Punkt, Schrägstrich und Steuerzeichen", () => {
  for (const gut of ["a", "meine-app", "x1", "0", "a".repeat(40)]) assert.ok(istProjektName(gut), gut);
  for (const schlecht of ["", ".", "..", "a/b", "a.b", "A", "a b", "-a", "a\n", "ä", "a".repeat(41), 7, null]) assert.ok(!istProjektName(schlecht), String(schlecht));
});

const C1 = "1a".repeat(20), C2 = "2b".repeat(32);

test("VKe2: Verlauf, Diff, zurück – Aktionen mit Commit-Kennung (SHA-1 oder SHA-256), sonst baut und liest sie niemand", async () => {
  const knoten = generateKeypair();
  const k = neueKopplung(knoten.pk);
  for (const aktion of [{ aktion: "verlauf", projekt: "app" }, { aktion: "diff", projekt: "app", commit: C1 }, { aktion: "zurueck", projekt: "app", commit: C2 }] as CodeAktion[]) {
    const { wrap } = await baueCodeAuftrag({ sitzung: new LocalSigner(generateKeypair().sk), kopplung: k, aktion });
    const r = await openPrivateKundenEvent(wrap, new LocalSigner(knoten.sk));
    assert.ok(r.ok);
    assert.deepEqual(leseCodeAuftrag(r.request), aktion);
  }
  for (const commit of ["", "1A".repeat(20), "1a".repeat(19), "1a".repeat(21), "HEAD", "main", "1a".repeat(20) + "\n"]) {
    await assert.rejects(baueCodeAuftrag({ sitzung: new LocalSigner(generateKeypair().sk), kopplung: k, aktion: { aktion: "diff", projekt: "app", commit } }), commit);
    assert.equal(leseCodeAuftrag(kern([["param", "aktion", "zurueck"], ["param", "projekt", "app"], ["param", "commit", commit]])), null, commit);
  }
  assert.equal(leseCodeAuftrag(kern([["param", "aktion", "verlauf"], ["param", "projekt", "app"], ["param", "commit", C1]])), null, "fremder Parameter");
  assert.equal(leseCodeAuftrag(kern([["param", "aktion", "diff"], ["param", "projekt", "app"]])), null, "Commit fehlt");
});

test("VKe2: Antworten – Verlauf begrenzt, Diff nach JSON-Länge begrenzt (passt in einen Umschlag), zurück mit leerem Commit", () => {
  const commit = { id: C1, nachricht: "Schritt 3", zeit: 1_790_000_000, dateien: 2 };
  const verlauf: CodeAntwort = { aktion: "verlauf", commits: [commit] };
  assert.deepEqual(leseCodeAntwort(codeAntwortText(verlauf), "verlauf"), verlauf);
  assert.throws(() => codeAntwortText({ aktion: "verlauf", commits: Array.from({ length: CODE_GRENZEN.commits + 1 }, () => commit) }));
  assert.throws(() => codeAntwortText({ aktion: "verlauf", commits: [{ ...commit, nachricht: "x".repeat(CODE_GRENZEN.nachricht + 1) }] }));
  assert.throws(() => codeAntwortText({ aktion: "verlauf", commits: [{ ...commit, id: "HEAD" }] }));
  assert.equal(leseCodeAntwort(JSON.stringify({ aktion: "verlauf", commits: [{ ...commit, autor: "x" }] }), "verlauf"), null);
  const diff: CodeAntwort = { aktion: "diff", commit: C2, text: "diff --git a/x b/x\n+\"hallo\"\n", gekuerzt: false };
  assert.deepEqual(leseCodeAntwort(codeAntwortText(diff), "diff"), diff);
  // Zeilenumbrüche zählen im JSON doppelt – die Grenze gilt dort, nicht in Zeichen
  const knapp = "\n".repeat(Math.floor((CODE_GRENZEN.diff - 2) / 2));
  assert.ok(leseCodeAntwort(codeAntwortText({ ...diff, text: knapp }), "diff"));
  assert.throws(() => codeAntwortText({ ...diff, text: knapp + "\n" }));
  for (const z of [{ aktion: "zurueck", commit: "" }, { aktion: "zurueck", commit: C1 }] as CodeAntwort[]) assert.deepEqual(leseCodeAntwort(codeAntwortText(z), "zurueck"), z);
  assert.equal(leseCodeAntwort(JSON.stringify({ aktion: "zurueck", commit: "HEAD" }), "zurueck"), null);
  assert.equal(leseCodeAntwort(codeAntwortText(diff), "verlauf"), null, "nur zur erwarteten Aktion");
});
