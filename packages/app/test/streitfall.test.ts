/**
 * Schritt 5.6b: Streitfall in der App – Pruefer nur aus dem eigenen Netz,
 * eigene Reklamationen mit Sitzungsschluessel nur im Tresor, und ein Urteil
 * nur vom genannten Pruefer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LocalSigner, SICHERUNG_EINTRAEGE, SICHERUNG_NIE, buildDispute, computeEventId, buildResolution, buildPrivateUrteil, generateKeypair, openPrivateUrteil,
  parseDispute, resolveDispute, signEvent, toHex,
} from "@freedomstack/protocol";
import { KiSitzungen } from "../src/ki-sitzung.js";
import {
  LS_PRUEFUNGEN_ERLEDIGT, LS_REKLAMATIONEN, REKLAMATION_AUFBEWAHREN_SECS, type EigeneReklamation, erstattungFuer, leseErledigt,
  leseReklamationen, mitReklamation, prueferAusNetz, pruefauftragAus, reklamationText,
} from "../src/streitfall.js";
import { setLang } from "../src/i18n.js";

// Meldungen hier auf Deutsch prüfen (seit 8.16e über Schlüssel in der Sprache der Oberfläche)
setLang("de");

const pk = (c: string) => c.repeat(64);

test("5.6b: Pruefer nur aus Kontakten und eigenen Providern – ohne Beteiligte, ohne Doppelte, hoechstens neun", () => {
  const kontakte = [
    { id: pk("a"), name: "Anna", type: "dm" },
    { id: pk("b"), name: "  ", type: "dm" },
    { id: "raum-1", name: "Raum", type: "community" },
    { id: "kein-hex", name: "X", type: "dm" },
    { id: pk("c"), name: "Provider selbst", type: "dm" },
  ];
  const p = prueferAusNetz(kontakte, [pk("d"), pk("a"), "quatsch"], [pk("c"), pk("e")]);
  assert.deepEqual(p.map((x) => [x.pk, x.name, x.art]), [
    [pk("a"), "Anna", "kontakt"],
    [pk("b"), `${pk("b").slice(0, 8)}…`, "kontakt"],
    [pk("d"), `${pk("d").slice(0, 8)}…`, "provider"],
  ]);
  const viele = Array.from({ length: 20 }, (_, i) => ({ id: i.toString(16).padStart(64, "0"), name: `K${i}`, type: "dm" }));
  assert.equal(prueferAusNetz(viele, [], []).length, 9);
  assert.deepEqual(prueferAusNetz([], [], []), [], "ohne Netz kein Pruefer – keine Rangliste als Ersatz");
});

const JETZT = 1_790_000_000;
const reklamation = (o: Partial<EigeneReklamation> = {}): EigeneReklamation => ({
  jobId: pk("1"), providerPk: pk("2"), pruefer: pk("3"), prueferName: "Anna", sitzungSk: pk("4"),
  grund: "unbrauchbar", betragMsat: 21_000, at: JETZT - 60, ...o,
});

test("5.6b: eigene Reklamationen – streng gelesen, 30 Tage, gleiche Aufgabe ersetzt", () => {
  assert.deepEqual(leseReklamationen(null, JETZT), []);
  assert.deepEqual(leseReklamationen("kaputt", JETZT), []);
  const gut = reklamation();
  const liste = [gut, { ...gut, jobId: "x" }, { ...gut, sitzungSk: "zu-kurz" }, { ...gut, grund: "egal" }, { ...gut, at: JETZT - REKLAMATION_AUFBEWAHREN_SECS - 1 },
    { ...gut, urteil: { ergebnis: "gewonnen", erstattungMsat: 1, notiz: "", at: JETZT } }, 7, null];
  assert.deepEqual(leseReklamationen(JSON.stringify(liste), JETZT), [gut]);
  const mitUrteil = { ...gut, urteil: { ergebnis: "erstattet" as const, erstattungMsat: 21_000, notiz: "passt nicht", at: JETZT } };
  assert.deepEqual(mitReklamation([gut, reklamation({ jobId: pk("5") })], mitUrteil).map((r) => [r.jobId, !!r.urteil]), [[pk("5"), false], [pk("1"), true]]);
  assert.equal(reklamationText(gut), "wartet auf das Urteil von Anna");
  assert.equal(reklamationText(mitUrteil), "Anna gibt dir recht – 21 sats zurück. Das gilt nur zwischen dir und dem Provider; erstatten muss er selbst.");
  assert.match(reklamationText({ ...gut, urteil: { ergebnis: "bestaetigt", erstattungMsat: 0, notiz: "", at: JETZT } }), /^Anna gibt dem Provider recht\. /);
});

test("5.6b: der Sitzungsschluessel der Reklamation oeffnet das Urteil auch nach einem Neustart", async () => {
  const provider = new LocalSigner(generateKeypair().sk);
  const pruefer = new LocalSigner(generateKeypair().sk);
  const sitzungen = new KiSitzungen();
  const sitzung = sitzungen.fuer(provider.publicKey());
  const sk = sitzungen.schluesselHex(provider.publicKey())!;
  assert.match(sk, /^[0-9a-f]{64}$/);
  assert.equal(sitzungen.schluesselHex(pk("9")), undefined);
  // Neustart: nur der gemerkte Schluessel ist noch da.
  const wieder = new LocalSigner(Uint8Array.from(Buffer.from(sk, "hex")));
  assert.equal(wieder.publicKey(), sitzung.publicKey());
  const urteil = buildResolution({ jobId: pk("1"), reviewerPubkey: pruefer.publicKey(), resolution: "geteilt", refundMsat: 10_500, note: "halb" });
  const { wraps } = await buildPrivateUrteil({ urteil, prueferSigner: pruefer, kundePk: wieder.publicKey(), providerPk: provider.publicKey() });
  const o = await openPrivateUrteil(wraps[0]!, wieder);
  assert.ok(o.ok);
  const d = parseDispute(signEvent(buildDispute({ jobId: pk("1"), customerPubkey: wieder.publicKey(), providerPubkey: provider.publicKey(), reason: "unbrauchbar", amountMsat: 21_000, note: "", pruefer: [pruefer.publicKey()] }), generateKeypair().sk));
  assert.deepEqual(resolveDispute(d, true, [{ ...o.urteil, sig: "" }]).refundMsat, 10_500);
  // Ein Urteil eines anderen zaehlt nicht.
  const fremd = new LocalSigner(generateKeypair().sk);
  const f = await buildPrivateUrteil({ urteil: buildResolution({ jobId: pk("1"), reviewerPubkey: fremd.publicKey(), resolution: "erstattet", refundMsat: 21_000, note: "" }), prueferSigner: fremd, kundePk: wieder.publicKey(), providerPk: provider.publicKey() });
  const of = await openPrivateUrteil(f.wraps[0]!, wieder);
  assert.ok(of.ok);
  assert.equal(resolveDispute(d, true, [{ ...of.urteil, sig: "" }]).resolution, "unentschieden");
  assert.equal(toHex(Uint8Array.from(Buffer.from(sk, "hex"))), sk);
});

test("5.6b verdrahtet: Pruefer aus dem Netz, Material nur mit Zustimmung, Schluessel nur im Tresor, Urteile nur an Sitzungsschluessel", () => {
  const agent = readFileSync(new URL("../src/shell/tabs/agent.ts", import.meta.url), "utf8");
  assert.doesNotMatch(agent, /prueferKandidaten|jobsCompleted} Aufträge/, "keine globale Rangliste mehr");
  const rekl = agent.slice(agent.indexOf("async function reklamiere("), agent.indexOf("function addUsageBubble("));
  // Seit C-1f im Dialog: Prüfer nur aus dem Netz, Material nur mit Haken
  assert.match(rekl, /const kandidaten = netzPruefer\(providerPk\);/);
  assert.match(rekl, /const material = pruefer && frageAntwort && zustimmung \? frageAntwort : undefined;/);
  assert.match(rekl, /await merkeReklamation\(\{[\s\S]*?sitzungSk: sk,/);
  assert.match(agent, /await handleAnswer\(answer\.ev, answer\.parsed!, prompt\);/);

  const ui = readFileSync(new URL("../src/shell/streitfall-ui.ts", import.meta.url), "utf8");
  assert.match(ui, /if \(pruefer\.art === "kontakt"\) await veroeffentlicheDm\(wrap, pruefer\.pk\);/, "Kontakten an ihren Posteingang");
  assert.match(ui, /await geheim\.setItem\(LS_REKLAMATIONEN, /);
  assert.doesNotMatch(ui, /localStorage\.setItem\(/);
  assert.match(ui, /query\(\{ kinds: \[KIND_GIFT_WRAP\], "#p": \[\.\.\.signer\.keys\(\)\], since: seit, limit: 200 \}\)/, "nur Umschlaege an die Sitzungsschluessel");
  assert.match(ui, /if \(!o\.ok \|\| o\.prueferPk !== ziel\.r\.pruefer\) continue;/, "nur der genannte Pruefer");
  assert.doesNotMatch(ui, /innerHTML/);

  const tresor = readFileSync(new URL("../src/shell/tresor.ts", import.meta.url), "utf8");
  assert.match(tresor, /const GEHEIM_FEST = \[[^\]]*"freedom\.reklamationen"/, "im Tresor");
  assert.ok(SICHERUNG_NIE.some((r) => r.test(LS_REKLAMATIONEN)), "nie in die Zustandssicherung – sie enthaelt Schluessel");
  assert.ok(!SICHERUNG_EINTRAEGE.includes(LS_REKLAMATIONEN));
  const app = readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8");
  assert.match(app, /starteStreitfall\(\);/);
  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  assert.match(html, /<div id="reklamationen" class="card hidden">/);
});

// ------------------------------------------------------------ als Pruefer (5.6c)

test("5.6c: ein Pruefauftrag ist nur eine Reklamation, die mich nennt", () => {
  const ich = generateKeypair().pk, anderer = generateKeypair().pk, sitzung = generateKeypair().pk, provider = generateKeypair().pk;
  // Die Zeit nur einmal aus der Uhr (Fallstrick „Fristen in Tests“): sonst unterscheiden sich die Ids, wenn dazwischen die Sekunde umspringt
  const jetzt = Math.floor(Date.now() / 1000);
  const kern = (pruefer: string[], jobId = pk("1")) => {
    const u = buildDispute({ jobId, customerPubkey: sitzung, providerPubkey: provider, reason: "falsches_modell", amountMsat: 21_000, note: "n", pruefer, material: { frage: "F", antwort: "A" } }, jetzt);
    return { ...u, id: computeEventId(u) };
  };
  const d = pruefauftragAus(kern([ich]), ich)!;
  assert.deepEqual([d.jobId, d.reason, d.amountMsat, d.material], [pk("1"), "falsches_modell", 21_000, { frage: "F", antwort: "A" }]);
  assert.equal(d.id, kern([ich]).id);
  assert.equal(pruefauftragAus(kern([anderer]), ich), null, "nennt mich nicht");
  assert.equal(pruefauftragAus(kern([]), ich), null);
  assert.equal(pruefauftragAus(kern([ich], "keine-hex-id"), ich), null);
  assert.equal(pruefauftragAus({ ...kern([ich]), kind: 1 }, ich), null);
});

test("5.6c: Erstattung wie resolveDispute – und beantwortete Auftraege nur als IDs", () => {
  assert.deepEqual((["erstattet", "bestaetigt", "geteilt", "unentschieden"] as const).map((e) => erstattungFuer(e, 21_001)), [21_001, 0, 10_500, 0]);
  assert.deepEqual(leseErledigt(JSON.stringify([pk("a"), "x", 3, pk("b")])), [pk("a"), pk("b")]);
  assert.deepEqual(leseErledigt("kaputt"), []);
  assert.equal(LS_PRUEFUNGEN_ERLEDIGT, "freedom.pruefungen.erledigt");
});

test("5.6c verdrahtet: Posteingang reicht Pruefauftraege weiter, Urteil versiegelt an Sitzung und Provider, Inhalt nur im Speicher", () => {
  const kom = ["kommunikation", "chat-anhaenge", "kontakte", "posteingang"].map((d) => readFileSync(new URL(`../src/shell/tabs/${d}.ts`, import.meta.url), "utf8")).join("\n");
  assert.match(kom, /\?\? \(await alsNachfolge\(w\)\) \?\? \(await alsPruefauftrag\(w\)\) \?\? \(await alsRaumMeldung\(w\)\) \?\? \(await alsRufZusammenfassung\(w\)\) \?\? \(await alsRechnungsAnfrage\(w\)\) \?\? \(await alsAnruf\(w\)\);/);
  const ui = readFileSync(new URL("../src/shell/pruefauftraege-ui.ts", import.meta.url), "utf8");
  assert.match(ui, /const d = pruefauftragAus\(r\.request, signer\.publicKey\(\)\);/);
  assert.match(ui, /if \(!signer \|\| alsGeraet\(\)\) return null;/, "als Geraet nicht – der Auftrag nennt die Person");
  assert.match(ui, /buildPrivateUrteil\(\{\s*urteil, prueferSigner: signer, kundePk: d\.customerPubkey, providerPk: d\.providerPubkey,/);
  assert.doesNotMatch(ui, /innerHTML/);
  assert.doesNotMatch(ui, /geheim\./, "Inhalt nur im Speicher");
  assert.deepEqual([...ui.matchAll(/localStorage\.setItem\(([^,]+),/g)].map((m) => m[1]), ["LS_PRUEFUNGEN_ERLEDIGT"], "gemerkt nur die IDs");
  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  assert.match(html, /<div id="pruefauftraege" class="card hidden">/);
});
