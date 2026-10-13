/**
 * 11.3d1b2 (Entwurf AGENTEN-RAUM-ENTWURF.md P4, „wer fragt, zahlt“): Fragen an Agenten auf dem Knoten.
 *
 * Beweist:
 *  - gefragt wird nur bei Agenten auf einem Knoten mit „wer fragt, zahlt“ und Knoten in der Karte,
 *    nur wenn erwähnt, in der Reihenfolge der Erwähnungen, nie man selbst
 *  - der Verweis steht nur im versiegelten Kern – außen nur der Umschlag; die Eingabe ist fest,
 *    nie der Text der Nachricht
 *  - jede Kennung des Knotens hat einen Text in beiden Sprachen, Unbekanntes den allgemeinen Satz
 *  - verdrahtet: nach dem Senden im offenen Raum, erst Zahlweg und Preis, dann die Bestätigung, dann
 *    der Auftrag; frischer Sitzungsschlüssel je Frage; bezahlt wie jede KI-Anfrage
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_GIFT_WRAP, LocalSigner, auftragsVerweisTags, buildJobRequest, buildPrivateJobRequest, generateKeypair, leseAuftragsVerweis, openPrivateJobRequest,
} from "@freedomstack/protocol";
import { BEREICHE } from "../src/i18n.js";
import { type RaumAgentKarte, ablehnungsText, zuBezahlen } from "../src/knoten-agent-wahl.js";

const lies = (datei: string) => readFileSync(new URL(`../src/${datei}`, import.meta.url), "utf8");
const pk = (n: number) => n.toString(16).padStart(64, "0");
const ich = pk(1), knoten = pk(9);
const karte = (agent: string, o: Partial<RaumAgentKarte> = {}): RaumAgentKarte =>
  ({ agent, name: `A${agent.slice(-1)}`, betrieb: "knoten", bezahlung: "fragender", provider: knoten, ...o });

test("11.3d1b2: gefragt nur bei Knoten-Agenten mit „wer fragt, zahlt“, nur erwähnt, nie man selbst", () => {
  const karten = [
    karte(pk(2)),
    karte(pk(3), { betrieb: "geraet", bezahlung: "einlader" }), // auf einem Gerät: zahlt der Einlader
    karte(pk(4), { bezahlung: "einlader" }),
    karte(pk(5), { provider: undefined }), // ohne Knoten keine Adresse für den Auftrag
    karte(pk(6)),
    karte(ich), // ein eigener Agent – nie bei sich selbst bezahlen
  ];
  assert.deepEqual(zuBezahlen([pk(6), pk(2), pk(3), pk(4), pk(5), ich, pk(6)], karten, ich).map((k) => k.agent), [pk(6), pk(2)], "Reihenfolge der Erwähnungen, jeder einmal");
  assert.deepEqual(zuBezahlen([pk(7)], karten, ich), [], "ohne Karte niemand");
  assert.deepEqual(zuBezahlen([], karten, ich), []);
  assert.equal(zuBezahlen([pk(2)], karten, ich)[0]!.provider, knoten);
});

test("11.3d1b2: Verweis nur im versiegelten Kern, feste Eingabe", async () => {
  const quelle = lies("shell/knoten-agent-fragen.ts");
  const eingabe = /const EINGABE = "([^"]+)";/.exec(quelle)?.[1];
  assert.ok(eingabe, "feste Eingabe");
  const kp = generateKeypair(), sitzung = new LocalSigner(generateKeypair().sk);
  const raum = `34700:${pk(8)}:space:werkstatt`, erwaehnung = "ab".repeat(32);
  // Wie bezahlterAuftrag(): Verweis als extraTags in den Kern, dann versiegeln
  const request = buildJobRequest({
    customerPubkey: sitzung.publicKey(), input: eingabe, bidMsat: 100_000, providerPubkey: kp.pk,
    params: [["tier", "classic"]], extraTags: auftragsVerweisTags({ raum, erwaehnung }),
  });
  const auftrag = await buildPrivateJobRequest({ request, sessionSigner: sitzung, providerPk: kp.pk, powBits: 0 });
  assert.equal(auftrag.wrap.kind, KIND_GIFT_WRAP);
  assert.deepEqual(auftrag.wrap.tags.map((t) => t[0]), ["p"], "außen nur der Empfänger");
  assert.ok(!auftrag.wrap.content.includes(erwaehnung), "die Id nicht im Klartext");
  const offen = await openPrivateJobRequest(auftrag.wrap, new LocalSigner(kp.sk));
  assert.ok(offen.ok);
  assert.deepEqual(leseAuftragsVerweis(offen.request.tags), { raum, erwaehnung }, "der Knoten liest den Verweis");
  assert.equal(offen.kundePk, sitzung.publicKey(), "vom Sitzungsschlüssel, nie von der Identität");
});

test("11.3d1b2: jede Kennung des Knotens hat einen Text, Unbekanntes den allgemeinen Satz", () => {
  const texte = Object.assign({}, ...Object.values(BEREICHE)) as Record<string, { de: string; en: string }>;
  const knotenQuelle = readFileSync(new URL("../../node/src/knoten-agent.ts", import.meta.url), "utf8")
    + readFileSync(new URL("../../node/src/dvm-provider.ts", import.meta.url), "utf8");
  const faelle = [...knotenQuelle.matchAll(/new AgentAbgelehnt\("([a-z-]+)"\)/g)].map((m) => m[1]!);
  assert.ok(faelle.length >= 9, "Kennungen aus dem Quelltext des Knotens");
  for (const fall of [...faelle, "agent-kein-schreibrecht", "agent-agent-ohne-schreibrecht", "agent-bremse", "agent-kette-voll", "neu", undefined]) {
    const s = ablehnungsText(fall);
    assert.ok(texte[s]?.de && texte[s]?.en, `${fall} → ${s}`);
    assert.ok(texte[s]!.de.includes("{name}") && texte[s]!.en.includes("{name}"), s);
  }
  assert.equal(ablehnungsText("agent-schon-beantwortet"), "agentKnoten.schonBeantwortet");
  assert.equal(ablehnungsText("agent-keine-erwaehnung"), "agentKnoten.nichtGefunden");
  assert.equal(ablehnungsText("etwas-neues"), "agentKnoten.abgelehnt");
  assert.ok(texte["agentKnoten.abgelehnt"]!.de.includes("{fall}"), "Unbekanntes nennt die Kennung");
  for (const s of ["titel", "preis", "preisKanal", "fragen", "ohneAngebot", "beantwortet", "keineAntwort"]) {
    assert.ok(texte[`agentKnoten.${s}`]?.de && texte[`agentKnoten.${s}`]?.en, s);
  }
  for (const s of ["preis", "preisKanal"]) {
    for (const sprache of ["de", "en"] as const) {
      const x = texte[`agentKnoten.${s}`]![sprache];
      assert.ok(x.includes("{hoechst}") && x.includes("{rate}"), `${s} ${sprache}: Preis genannt`);
    }
  }
});

test("11.3d1b2: verdrahtet – nach dem Senden im offenen Raum, Preis vor dem Auftrag", () => {
  const raeume = lies("shell/tabs/raeume.ts");
  const senden = raeume.slice(raeume.indexOf("async function sendeRaumNachricht"), raeume.indexOf("const nurTresorFehlt"));
  const privat = senden.indexOf("if (spacesUi.privat) {"), publish = senden.indexOf("await (await ensurePool()).publish(ev);");
  const frage = senden.indexOf("m.frageKnotenAgenten({ raum: ort.adresse, erwaehnung: ev.id, erwaehnt: agenten, karten: spacesUi.agentKarten })");
  assert.ok(privat > 0 && publish > privat && frage > publish, "nur offen, erst nach dem Senden");
  assert.match(senden, /if \(agenten\.length && ort && "adresse" in ort\)/);
  assert.match(raeume, /betrieb: k\.betrieb, bezahlung: k\.bezahlung, provider: k\.provider/, "Karten mit Betrieb, Bezahlung, Knoten");

  const q = lies("shell/knoten-agent-fragen.ts");
  const stelle = (s: string): number => {
    const n = q.indexOf(s);
    assert.ok(n >= 0, s);
    return n;
  };
  assert.ok(stelle("privatFaehig(") < stelle("await bestaetige("), "nur Knoten, die versiegelt annehmen");
  assert.ok(stelle('if (weg === "kanal-noetig") return toast(') < stelle("await bestaetige("), "ohne Zahlweg keine Frage");
  assert.ok(stelle("const { grund } = await providerZahlung(k.provider);") < stelle("await bestaetige("), "ohne Wallet keine Frage");
  assert.ok(stelle("if (!ok) return;") < stelle("await bezahlterAuftrag("), "ohne Bestätigung geht nichts hinaus");
  assert.match(q, /sitzungen: new KiSitzungen\(\), input: EINGABE, hoechstMsat: hoechst, kanal: weg === "kanal",\n    extraTags: auftragsVerweisTags\(\{ raum, erwaehnung \}\),/, "frischer Schlüssel, feste Eingabe, Verweis");
  assert.match(q, /const hoechst = hoechstMsat\(AGENT_GEBOT_SATS, \[\]\);/, "dasselbe Gebot wie Agenten auf dem Gerät");
  assert.doesNotMatch(q, /state\.keypair\.pk|signiere\(|publish\(/, "keine Identität, nichts offen");

  const b = lies("shell/bezahlter-auftrag.ts");
  assert.match(b, /extraTags: \[\.\.\.\(kanal \? kanal\.tags : deklaration\(empfaenger\)\), \.\.\.\(p\.extraTags \?\? \[\]\)\],/, "Verweis in den Kern, A+ oder Gutschrift");
  assert.match(b, /buildPrivateJobRequest\(\{ request, sessionSigner: sitzung, providerPk: p\.provider,/);
  assert.equal(b.match(/publish\(/g)?.length, 1);
  assert.match(b, /await pool\.publish\(auftrag\.wrap\);/, "nur der Umschlag");
  assert.ok(b.indexOf("merkeAnfrage(auftrag.requestId") < b.indexOf("await pool.publish(auftrag.wrap);"), "Gebot gemerkt vor dem Senden");
  assert.ok(b.indexOf("p.sitzungen.merkeAuftrag(auftrag.requestId, sitzung);") < b.indexOf("await pool.publish(auftrag.wrap);"));
  assert.match(b, /if \(p\.kanal && !kanal\) return null;/, "ohne Kanal nichts");
  assert.match(b, /const abrechnung = await rechneAntwortAb\(auftrag\.requestId, ergebnis\.amountMsat\);/, "höchstens das Gebot (rechneAb)");
  assert.match(b, /await kanalAntwort\(auftrag\.requestId, ergebnis\.amountLamports\);/);
  assert.match(b, /return \{ art: "abgelehnt", \.\.\.\(fall \? \{ fall \} : \{\}\) \};/, "Ablehnung nur mit Kennung");
  assert.doesNotMatch(b, /\.content/, "nie Text vom Knoten");
});

test("11.3d2c: privat – nach dem Senden die Gruppe im Verweis; Einladen eines Knoten-Agenten nur nach Warnung, danach der Hinweis im Raum", () => {
  const raeume = lies("shell/tabs/raeume.ts");
  const senden = raeume.slice(raeume.indexOf("async function sendeRaumNachricht"), raeume.indexOf("const nurTresorFehlt"));
  const privat = senden.slice(senden.indexOf("if (spacesUi.privat) {"), senden.indexOf("const { buildChannelMessage }"));
  assert.match(privat, /const gesendet = await sendePrivat\(spacesUi\.privat\.gruppe, spacesUi\.channelId, text, bezug\)\.catch\(\(\) => null\);\n\s+if \(gesendet\) \{/);
  assert.match(privat, /m\.frageKnotenAgenten\(\{ raum: gruppe, erwaehnung: gesendet, erwaehnt: agenten, karten \}\)/, "Gruppe und die Id des inneren Events");
  assert.ok(privat.indexOf("frageKnotenAgenten") > privat.indexOf("if (gesendet) {") && privat.indexOf("frageKnotenAgenten") < privat.indexOf("} else {"), "nur, wenn gesendet");
  assert.match(senden, /const karten = spacesUi\.privat \? raumAgentKarten\(spacesUi\.privat\.ereignisse\) : spacesUi\.agentKarten;/, "Karten der Gruppe");

  const ein = raeume.slice(raeume.indexOf("async function ladeEin"), raeume.indexOf("/**\n * Moderieren"));
  const stelle = (s: string): number => {
    const n = ein.indexOf(s);
    assert.ok(n >= 0, s);
    return n;
  };
  assert.ok(stelle("const agent = await knotenAgentKarte(pk);") < stelle("await bestaetige({ titel: t(\"agentKnoten.einladenTitel\""));
  assert.ok(stelle("t(\"agentKnoten.einladenText\", { name: agent.name })") < stelle("await ladeInPrivatenRaum(raum, pk)"), "erst die Warnung, dann einladen");
  assert.match(ein, /if \(agent && !\(await bestaetige\([^\n]*\)\)\) return;/, "abgelehnt → nicht eingeladen");
  assert.match(ein, /if \(r === "eingeladen" && agent\) await meldeKnotenAgentImRaum\(raum, agent\.name\);/, "Hinweis nur nach der Einladung");

  const q = lies("shell/knoten-agent-fragen.ts");
  assert.match(q, /return aktuelleAgentKarten\(evs\)\.find\(\(k\) => k\.agent === pk && k\.betrieb === "knoten"\) \?\? null;/, "nur Agenten auf einem Knoten, signiert vom Agenten");
  assert.match(q, /await sendePrivat\(raum\.gruppe, kanal, t\("agentKnoten\.hinweisRaum", \{ name \}\)\)/, "Hinweis nur als inneres Event");
  const texte = Object.assign({}, ...Object.values(BEREICHE)) as Record<string, { de: string; en: string }>;
  for (const s of ["einladenTitel", "einladenText", "hinweisRaum"]) {
    for (const sprache of ["de", "en"] as const) assert.ok(texte[`agentKnoten.${s}`]?.[sprache].includes("{name}"), `${s} ${sprache}`);
  }
  assert.match(texte["agentKnoten.einladenText"]!.de, /liest der Knoten alles in diesem Raum mit/);
  assert.match(lies("shell/raum-mls.ts"), /return mlsSendeEventId\(gruppe, raumNachricht\(\{ kanal, text, \.\.\.bezug \}\)\);/);
});
