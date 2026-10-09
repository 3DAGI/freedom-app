/**
 * 11.3c2b (Entwurf AGENTEN-RAUM-ENTWURF.md P3–P5, F3 B): Agenten auf dem Gerät antworten – verdrahtet.
 *
 * Beweist (am Quelltext – der Ablauf braucht Relays, Provider und Wallet):
 *  - gestartet mit der App, im Abruftakt nur geprüft; neu aufgesetzt nach Einladen und Entfernen
 *  - Abo nur ab jetzt, nur Nachrichten (42) an Agenten dieses Geräts; nie als Gerät
 *  - erst `entscheide()`, dann das Budget (`reicht()` mit dem Gebot in der Einheit des Budgets),
 *    dann der Auftrag; msat nur über Lightning, Lamports nur über einen Zahlkanal
 *  - Auftrag versiegelt vom Sitzungsschlüssel je Agent und Raum, Platzhalter je Auftrag,
 *    ohne Verweis auf den Raum; gemerkt vor dem Senden; Antworten nur an diesen Schlüssel
 *  - nach der Antwort: bezahlt über ki-zahlung.ts, verbucht höchstens das Gebot, Antwort vom Agenten
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lies = (datei: string) => readFileSync(new URL(`../src/${datei}`, import.meta.url), "utf8");
const quelle = lies("shell/agenten-lauschen.ts");
const stelle = (s: string): number => {
  const n = quelle.indexOf(s);
  assert.ok(n >= 0, s);
  return n;
};

test("11.3c2b: gestartet mit der App, im Takt geprüft, nach Einladen und Entfernen neu", () => {
  const app = lies("shell/app.ts");
  assert.match(app, /wireAnrufe\(\);\n[\s\S]{0,300}void starteGeraeteAgenten\(\);\n  abrufTakt\.melde\("agenten", agentenImTakt, 2\);/);
  const agenten = lies("shell/agenten.ts");
  assert.equal(agenten.match(/void \(await import\("\.\/agenten-lauschen\.js"\)\)\.starteGeraeteAgenten\(\);/g)?.length, 2);
  assert.match(quelle, /if \(aktiv\?\.agenten === agenten\.join\(","\)\) return;/, "unverändert: nichts neu");
});

test("11.3c2b: Abo nur ab jetzt, nur an Agenten dieses Geräts, nie als Gerät", () => {
  assert.match(quelle, /const agenten = state\.keypair && !alsGeraet\(\)/);
  assert.match(quelle, /pool\.subscribe\(\{ kinds: \[KIND_CHANNEL_MESSAGE\], "#p": agenten, since: jetztSek\(\) \}/);
  assert.equal(quelle.match(/pool\.subscribe\(/g)?.length, 1);
  assert.match(quelle, /const raum = a\.raeume\.map\(\(r\) => r\.raum\)\.find\(\(r\) => leseRaumAdresse\(r\)\?\.spaceId === kennung\);/, "nur Räume des Agenten");
});

test("11.3c2b: erst entscheiden, dann Budget, dann Auftrag – in der Einheit des Budgets", () => {
  assert.ok(stelle("const e = entscheide(") < stelle("const passt = agentenBuch.reicht(agentPk, raum, imBudget);"));
  assert.ok(stelle("const passt = agentenBuch.reicht(") < stelle("buildJobRequest("));
  assert.match(quelle, /einheit === "lamports" \? kanalDa\(pk\) : kiZahlweg\(standardSchiene\(\), kanalDa\(pk\)\) === "lightning"/);
  assert.match(quelle, /const imBudget = kurs \? Number\(bedarfLamports\(hoechst, kurs\.satsProSol\)\) : hoechst;/);
  assert.match(quelle, /if \(budget\.einheit === "lamports" && !kanal\) return null;/, "ohne Kanal nichts");
  assert.match(quelle, /agentenBuch\.meldeEinmal\(agentPk, raum, passt\.grund\)/, "erreicht: einmal sagen");
});

test("11.3c2b: Auftrag versiegelt, je Agent und Raum, ohne Raum, gemerkt vor dem Senden", () => {
  assert.match(quelle, /const ks = sitzungen\.fuer\(agentPk, raum\);\n  const sitzung = ks\.fuer\(provider\);/);
  assert.match(quelle, /customerPubkey: sitzung\.publicKey\(\), input: maske\.text,/);
  assert.match(quelle, /buildPrivateJobRequest\(\{ request, sessionSigner: sitzung, providerPk: provider,/);
  assert.ok(stelle("const maske = maskiereEinzeln(agentPrompt(") < stelle("buildJobRequest("), "Platzhalter vor dem Auftrag");
  assert.doesNotMatch(quelle, /auftragsVerweisTags|"agent-raum"|state\.keypair\.pk|signiere\(/, "kein Raum, keine Identität im Auftrag");
  assert.ok(stelle("merkeAnfrage(auftrag.requestId") < stelle("await pool.publish(auftrag.wrap);"));
  assert.ok(stelle("ks.merkeAuftrag(auftrag.requestId, sitzung);") < stelle("await pool.publish(auftrag.wrap);"));
  assert.match(quelle, /pool\.query\(\{ kinds: \[KIND_GIFT_WRAP\], "#p": \[sitzung\.publicKey\(\)\], since: seit \}\)/, "nur dieser Schlüssel");
  const modul = lies("shell/ki-platzhalter.ts");
  assert.match(modul, /export function maskiereEinzeln\(text: string\)[\s\S]{0,120}const z = new Zuordnung\(\);/, "eigene Zuordnung je Auftrag");
});

test("11.3c2b: bezahlt über ki-zahlung.ts, höchstens das Gebot, Antwort vom Agenten", () => {
  assert.match(quelle, /await kanalAntwort\(auftrag\.requestId, ergebnis\.amountLamports\);\n    await agentenBuch\.buche\(agentPk, raum, Math\.min\(ergebnis\.amountLamports \?\? imBudget, imBudget\)\);/);
  assert.match(quelle, /const abrechnung = await rechneAntwortAb\(auftrag\.requestId, ergebnis\.amountMsat\);/);
  assert.match(quelle, /chargeForResult\(provider, abrechnung\.providerMsat, antwort\.id, zahlung, sitzung\);\n    await agentenBuch\.buche\(agentPk, raum, Math\.min\(ergebnis\.amountMsat, hoechst\)\);/);
  assert.ok(stelle("await agentenBuch.buche(agentPk, raum, Math.min(ergebnis.amountMsat") < stelle('return { art: "antwort", text: maske.zurueck(ergebnis.output) };'), "erst bezahlt und verbucht, dann die Antwort");
  assert.match(quelle, /if \(r\?\.art === "antwort"\) await sende\(agentAntwortEvent\(/);
  assert.match(quelle, /const sende = async \(u: [^)]+\): Promise<void> => void \(await pool\.publish\(await signer\.signEvent\(u\)\)\);/, "signiert vom Agenten");
  assert.doesNotMatch(quelle, /zahle\(zahlschienen\(\)/, "Geld nur über ki-zahlung.ts");
});

test("11.3c3b: private Räume – eigenes Konto, erst nachholen, nur Neues beantworten, Antwort nur in der Gruppe", () => {
  assert.match(quelle, /export const agentenImTakt = \(\): Promise<void> => starteGeraeteAgenten\(\{ privat: true \}\);/, "Engine erst im Takt, nie beim Start");
  assert.match(lies("shell/app.ts"), /void starteGeraeteAgenten\(\);\n  abrufTakt\.melde\("agenten", agentenImTakt, 2\);/);
  const privat = quelle.slice(stelle("async function setzePrivatAuf"), stelle("async function beantworteOffen"));
  assert.ok(privat.indexOf("const seit = jetztSek();") < privat.indexOf("await agentAbgleichen(k, gruppe).catch(() => []);"), "nachholen ohne zu antworten");
  assert.match(privat, /if \(e\.zeit >= seit && \(e\.art \?\? ART_RAUM_CHAT\) === ART_RAUM_CHAT && erwaehnt && e\.inneres\)/, "nur Neues, nur Nachrichten, nur Erwähnungen");
  assert.match(privat, /abonniereAn\(\{ \.\.\.abo\.filter, limit: 1 \}, abo\.relays, \(\) => nach\.anstossen\(\)\)/, "nur an die Relays der Gruppe");
  assert.match(privat, /if \(state\.keypair && !alsGeraet\(\) && !mlsGesperrt\(\)\)/);
  const antwort = quelle.slice(stelle("async function beantwortePrivat"), stelle("async function frageUndZahle"));
  assert.match(antwort, /const istAgent = \(pk: string\): boolean => raum\.agenten\.has\(pk\);/, "Agenten an ihrer Karte");
  assert.match(antwort, /definition: raum\.definition/, "Schalter aus der Definition eines Admins");
  assert.match(antwort, /await agentSendet\(k, gruppe, raumAgentAntwort\(e\.nachricht, r\.text\)\)/);
  assert.match(antwort, /await agentSendet\(k, gruppe, raumNachricht\(\{ kanal: e\.nachricht\.kanal, text: r\.text \}\)\)/, "Hinweis ohne Erwähnung");
  assert.doesNotMatch(antwort, /publish\(|signiere\(/, "nie offen");
});

