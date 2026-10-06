/**
 * Schritt 7.4c2: KI über ein Funk-Gateway in der App – Gateway aus dem
 * Angebot merken, Weiterleitung und Auftrag bauen, Antwort aus dem Funk
 * öffnen. Gegenstelle ist ein Gateway und Provider aus Protokoll-Bausteinen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_DVM_TEXT_GENERATION, LocalSigner, MeshKind, buildEvent, buildJobFeedback, buildPrivateJobResponse, generateKeypair,
  leseKurzWunsch, oeffneWeiterleitung, openPrivateJobRequest, pruefeMeshInhalt, type NostrEvent, type ProviderCapabilities,
} from "@freedomstack/protocol";
import { FunkAuftraege, baueFunkAuftrag, funkGatewayAus, leseFunkGateway, type FunkGateway } from "../src/ki-funk.js";
import { KiSitzungen } from "../src/ki-sitzung.js";

const JETZT = 1_800_000_000;
const bytes = (ev: NostrEvent) => new TextEncoder().encode(JSON.stringify(ev));

function angebot(pk: string, mehr: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return {
    pubkey: pk, tier: "classic", models: ["m"], textRatePerKTokenMsat: 1000, tools: [], currentlyFree: false,
    powBits: 8, kurs: { satsProSol: 150_000, quelle: "markt" }, funkGateway: true, updatedAt: JETZT, ...mehr,
  };
}

test("7.4c2: Gateway nur aus einem Angebot mit Funk-Rolle – gemerkt, gelesen, Unbrauchbares verworfen", () => {
  const pk = generateKeypair().pk;
  const g = funkGatewayAus(angebot(pk))!;
  assert.deepEqual(g, { pubkey: pk, powBits: 8, kurs: { satsProSol: 150_000, quelle: "markt" }, seit: JETZT });
  assert.equal(funkGatewayAus(angebot(pk, { funkGateway: undefined })), null, "ohne Funk-Rolle");
  assert.equal(funkGatewayAus(angebot(pk, { powBits: 20 })), null, "mehr Rechenarbeit, als die App leistet");
  assert.deepEqual(funkGatewayAus(angebot(pk, { powBits: undefined, kurs: undefined })), { pubkey: pk, powBits: 0, seit: JETZT });

  assert.deepEqual(leseFunkGateway(JSON.stringify(g)), g);
  for (const kaputt of [null, "", "{", "[]", JSON.stringify({ ...g, pubkey: "ab" }), JSON.stringify({ ...g, powBits: 17 }), JSON.stringify({ ...g, seit: "x" })]) {
    assert.equal(leseFunkGateway(kaputt), null, String(kaputt));
  }
  // Ein unbrauchbarer Kurs fällt weg – dann gibt es nur Gratis-Anfragen
  assert.deepEqual(leseFunkGateway(JSON.stringify({ ...g, kurs: { satsProSol: -1, quelle: "markt" } })), { pubkey: pk, powBits: 8, seit: JETZT });
});

test("7.4c2: Weiterleitung und Auftrag – das Gateway erfährt nur die Sitzung, der Provider den kurzen Auftrag mit Gutschrift im Kern", async () => {
  const knoten = new LocalSigner(generateKeypair().sk);
  const ich = generateKeypair();
  const sitzungen = new KiSitzungen();
  const g: FunkGateway = { pubkey: knoten.publicKey(), powBits: 8, seit: JETZT };
  const sitzung = sitzungen.fuer(g.pubkey);
  const gutschrift = [["kanal_gutschrift", "k", "1000", "sig"]];
  const a = await baueFunkAuftrag({ prompt: "Wie reinige ich Wasser?", bidMsat: 21_000, gateway: g, sitzung, zahlTags: gutschrift, nowSecs: JETZT });

  // Beides geht über Funk (nur Umschläge, nie mit der Identität)
  for (const w of [a.weiterleitung, a.auftrag]) {
    assert.deepEqual(pruefeMeshInhalt(bytes(w), MeshKind.NostrEvent, { eigeneSchluessel: [ich.pk] }), { ok: true, art: "umschlag" });
    assert.ok(!JSON.stringify(w).includes("Wasser"), "kein Klartext");
    assert.ok(!JSON.stringify(w).includes(sitzung.publicKey()), "auch der Sitzungsschlüssel steht nicht offen da");
  }
  const w = await oeffneWeiterleitung(a.weiterleitung, knoten, JETZT + 60);
  assert.equal(w?.sitzung, sitzung.publicKey());
  assert.equal(a.bis, JETZT + 3600, "eine Stunde");

  const job = await openPrivateJobRequest(a.auftrag, knoten);
  assert.ok(job.ok);
  assert.equal(job.request.id, a.requestId);
  assert.equal(job.request.pubkey, sitzung.publicKey(), "Autor ist die Sitzung, nie die Identität");
  assert.equal(leseKurzWunsch(job.request), 500);
  assert.deepEqual(job.request.tags.filter((t) => t[0] === "kanal_gutschrift"), gutschrift, "Gutschrift im versiegelten Kern");
  assert.ok(job.request.tags.some((t) => t[0] === "param" && t[1] === "tier" && t[2] === "classic"));
  // Gratis: ohne Gebot der Gratis-Tarif
  const frei = await baueFunkAuftrag({ prompt: "x", bidMsat: 0, gateway: g, sitzung, nowSecs: JETZT });
  const freiJob = await openPrivateJobRequest(frei.auftrag, knoten);
  assert.ok(freiJob.ok && freiJob.request.tags.some((t) => t[0] === "param" && t[1] === "tier" && t[2] === "free"));
});

test("7.4c2: Antwort aus dem Funk – Rückmeldung lässt offen, Ergebnis schließt; Fremdes, Abgelaufenes und Doppeltes nicht", async () => {
  const knoten = new LocalSigner(generateKeypair().sk);
  const sitzungen = new KiSitzungen();
  const g: FunkGateway = { pubkey: knoten.publicKey(), powBits: 0, seit: JETZT };
  const sitzung = sitzungen.fuer(g.pubkey);
  const a = await baueFunkAuftrag({ prompt: "Frage?", bidMsat: 0, gateway: g, sitzung, nowSecs: JETZT });
  const auftraege = new FunkAuftraege();
  auftraege.merke(a.requestId, "Frage?", a.bis);

  const versiegelt = async (kern: ReturnType<typeof buildEvent>) =>
    (await buildPrivateJobResponse({ response: kern, providerSigner: knoten, sessionPk: sitzung.publicKey(), nowSecs: JETZT + 60 })).wrap;
  const rueck = await versiegelt(buildJobFeedback(knoten.publicKey(), a.requestId, sitzung.publicKey(), "error", "Kontingent erschöpft", JETZT + 60));
  const ergebnis = await versiegelt(buildEvent(knoten.publicKey(), KIND_DVM_TEXT_GENERATION + 1000, [["e", a.requestId], ["p", sitzung.publicKey()], ["amount", "0"]], "Abkochen.", JETZT + 60));

  const r1 = await auftraege.oeffne(rueck, sitzungen, JETZT + 70);
  assert.equal(r1?.ergebnis, false);
  assert.equal(r1?.frage, "Frage?");
  assert.equal(auftraege.anzahl, 1, "bleibt offen");
  const r2 = await auftraege.oeffne(ergebnis, sitzungen, JETZT + 80);
  assert.equal(r2?.ergebnis, true);
  assert.equal(r2?.ev.content, "Abkochen.");
  assert.equal(auftraege.anzahl, 0);
  assert.equal(await auftraege.oeffne(ergebnis, sitzungen, JETZT + 90), null, "doppelt: schon beantwortet");

  // Fremde Sitzung, fremder Auftrag, abgelaufen
  const b = await baueFunkAuftrag({ prompt: "Zweite", bidMsat: 0, gateway: g, sitzung, nowSecs: JETZT });
  auftraege.merke(b.requestId, "Zweite", b.bis);
  const fremd = new LocalSigner(generateKeypair().sk);
  const anFremde = (await buildPrivateJobResponse({ response: buildEvent(knoten.publicKey(), 6050, [["e", b.requestId], ["p", fremd.publicKey()]], "x", JETZT), providerSigner: knoten, sessionPk: fremd.publicKey(), nowSecs: JETZT })).wrap;
  assert.equal(await auftraege.oeffne(anFremde, sitzungen, JETZT + 100), null);
  const andererAuftrag = await versiegelt(buildEvent(knoten.publicKey(), 6050, [["e", "f".repeat(64)], ["p", sitzung.publicKey()]], "x", JETZT));
  assert.equal(await auftraege.oeffne(andererAuftrag, sitzungen, JETZT + 100), null);
  assert.equal(await auftraege.oeffne({ ...anFremde, kind: 1 }, sitzungen, JETZT + 100), null);
  const spaet = await versiegelt(buildEvent(knoten.publicKey(), 6050, [["e", b.requestId], ["p", sitzung.publicKey()]], "zu spät", JETZT));
  assert.equal(await auftraege.oeffne(spaet, sitzungen, b.bis), null, "nach der Stunde wartet niemand mehr");
  assert.equal(auftraege.anzahl, 0);
});

test("7.4c2 verdrahtet: Antwort aus dem Funk vor dem Weiterverteilen, nur Zahlkanal oder gratis, Gateway im Tresor", () => {
  const lies = (pfad: string) => readFileSync(new URL(`../src/${pfad}`, import.meta.url), "utf8");
  const settings = ["settings", "sicherung", "mesh"].map((d) => lies(`shell/tabs/${d}.ts`)).join("\n");
  assert.match(settings, /const ev = meshToEvent\(payload\);[\s\S]{0,200}if \(await nimmFunkAntwort\(ev as [^\n]*?\)\) return;[\s\S]{0,300}await pool\.publish\(ev as never\)/, "zuerst die Funk-Antwort, dann erst ins Netz");
  assert.match(lies("shell/app.ts"), /setupEmptyState\(\);[\s\S]{0,80}setupFunkAntworten\(\);/);

  const agent = lies("shell/tabs/agent.ts");
  const zeige = agent.slice(agent.indexOf("async function zeigeFunkAntwort("), agent.indexOf("/** Simuliertes Streaming"));
  assert.match(zeige, /if \(perKanal\(r\.requestId\)\) await kanalAntwort\(r\.requestId, r\.amountLamports\);/);
  assert.doesNotMatch(zeige, /providerZahlung|rechneAntwortAb|zahle\(|chargeForResult/, "über Funk nie Lightning");

  const funk = lies("shell/ki-ueber-funk.ts");
  assert.doesNotMatch(funk, /providerZahlung|zahle\(|deklaration\(|rechnung/i, "nie still auf Lightning ausweichen");
  assert.match(funk, /if \(hoechst > 0 && !kanal\) throw/);
  assert.match(funk, /if \(kanal\) await kanal\.merke\(a\.requestId\);\s*merkeAnfrage\(a\.requestId, \{\}, hoechst, !!kanal\);[\s\S]*await senden\(a\.weiterleitung\)\) \|\| !\(await senden\(a\.auftrag\)\)/, "erst merken, dann senden – Weiterleitung zuerst");
  assert.match(funk, /geheim\.setItem\(LS_FUNK_GATEWAY/);
  assert.match(lies("shell/tresor.ts"), /const GEHEIM_FEST = \[[^\]]*"freedom\.funk\.gateway"/, "im Tresor");
  assert.match(lies("shell/ki-zahlung.ts"), /const kurs = gemerkterKurs \?\? \(await angebotVon\(providerPk\)/);
});

test("7.4c3 verdrahtet: Gateway wählen auf der Seite Netz, „über Funk“ im Agenten nur mit Gateway, nur die Frage reist", () => {
  const lies = (pfad: string) => readFileSync(new URL(`../src/${pfad}`, import.meta.url), "utf8");
  const html = lies("shell/index.html");
  assert.match(html, /<label id="ai-funk-wahl" class="mono-sm" style="display:none"[^>]*><input type="checkbox" id="ai-funk" \/>/, "versteckt, bis ein Gateway gemerkt ist");
  const netz = html.slice(html.indexOf('data-subpane="netz:mesh"'), html.indexOf("</section>", html.indexOf('data-subpane="netz:mesh"')));
  assert.match(netz, /id="funk-gateway-suchen"/);
  assert.match(netz, /id="funk-gateway-vergessen"/);
  assert.match(lies("shell/app.ts"), /void wireMeshTab\(\);\s*\/\/[^\n]*\n\s*wireFunkGateway\(\);/);

  const ui = lies("shell/funk-gateway-ui.ts");
  assert.doesNotMatch(ui, /innerHTML/, "Fremdes nur über textContent");
  assert.match(ui, /\(await alleAngebote\(\)\)\.filter\(\(c\) => c\.funkGateway\)/);
  assert.match(ui, /if \(wahl\) wahl\.style\.display = g \? "" : "none";/);

  const agent = lies("shell/tabs/agent.ts");
  const ask = agent.slice(agent.indexOf("export async function askAi("), agent.indexOf("/** Sendet den Job an den besten Provider"));
  // Seit D2 steht zwischen Prompt und Funk nur die Privat-Sperre (sie sendet nichts, sie kehrt höchstens zurück)
  assert.match(ask, /jobAbort\.abort\(\);\s*return;\s*\}\s*if \(!prompt\) return;\s*\/\/ Privat \(D2\)[^\n]*\n\s*const wahl = [^\n]*\n\s*const weg = kiWeg\([^\n]*\n\s*if \(!wegErlaubt\(privatGewaehlt\(\), weg\)\) \{\s*toast\(t\("agent\.privatNurGeraet"\), true\);\s*return;\s*\}\s*\/\/[^\n]*\n\s*if \(\(\$\("#ai-funk"\) as HTMLInputElement \| null\)\?\.checked\) \{\s*await frageUeberFunk\(prompt, bid\);\s*return;\s*\}\s*btn\.dataset\.running = "1";/);
  const frage = agent.slice(agent.indexOf("async function frageUeberFunk("), agent.indexOf("export function setupFunkAntworten("));
  assert.match(frage, /await sendeKiUeberFunk\(prompt, gebot, \(w\) => sendeUeberFunk\(eventToMesh\(w\), MeshKind\.NostrEvent, t\("agent\.funkLabel"\), MeshPriority\.Nachricht\)\);/);
  assert.doesNotMatch(frage, /pendingContextSummary|kontextPraefix/, "kein Verlauf als Kontext – jedes Byte kostet Sendezeit");
  assert.ok(frage.indexOf("if (!funkGeraetVerbunden())") < frage.indexOf("await sendeKiUeberFunk("), "erst das Gerät, dann Gutschrift und Auftrag");
  assert.match(["settings", "sicherung", "mesh"].map((d) => lies(`shell/tabs/${d}.ts`)).join("\n"), /meshNode\.enqueue\(payload, kind, vorrang \?\? MeshPriority\.Zahlung, label\);/);
});
