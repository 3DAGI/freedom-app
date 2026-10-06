/**
 * Leak-Szenario „Reklamation“ (Schritt 3.4, Abnahme): eine vollstaendige
 * Reklamation – Grund, Betrag, Notiz, an den Provider und einen Pruefer – so
 * gebaut wie `reklamiere()` in `tabs/agent.ts`, gesendet ueber den Pool.
 * Relays sehen nur Umschlaege; wer reklamiert, wogegen und worueber, bleibt
 * verborgen. Dazu: Der KI-Verlauf liegt nur im Tresor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LocalSigner, buildDispute, buildPrivateDispute, generateKeypair, openPrivateKundenEvent, parseDispute,
  regelKeinKlartext, regelKeineZahlungsdaten, regelKundeVerborgen, regelPTagsNur,
} from "@freedomstack/protocol";
import { KiSitzungen } from "../../src/ki-sitzung.js";
import { aufzeichnung } from "./aufzeichnung.js";

const NOTIZ = "Die Antwort zu meinem Kreditvertrag war frei erfunden";

async function reklamiere() {
  const { pool, relay } = aufzeichnung();
  const identitaet = generateKeypair().pk;
  const provider = new LocalSigner(generateKeypair().sk);
  const pruefer = new LocalSigner(generateKeypair().sk);
  const sitzungen = new KiSitzungen();
  const sitzung = sitzungen.fuer(provider.publicKey());
  const jobId = "a".repeat(64);
  // Wie reklamiere(): Reklamation vom Sitzungsschluessel, versiegelt an beide
  const dispute = buildDispute({
    jobId, customerPubkey: sitzung.publicKey(), providerPubkey: provider.publicKey(),
    reason: "falsches_modell", amountMsat: 21_000, note: NOTIZ,
  });
  const empfaenger = [provider.publicKey(), pruefer.publicKey()].map((pk) => ({ pk, powBits: 8 }));
  const { wraps } = await buildPrivateDispute({ dispute, sessionSigner: sitzung, empfaenger });
  for (const wrap of wraps) await pool.publish(wrap);
  return { gesendet: relay.gesendet, identitaet, sitzung: sitzung.publicKey(), provider, pruefer, jobId };
}

test("Reklamation: nur Umschlaege, kein Betrag, kein Grund, keine Notiz", async () => {
  const { gesendet, jobId } = await reklamiere();
  assert.deepEqual(gesendet.map((e) => e.kind), [1059, 1059]);
  assert.deepEqual(regelKeineZahlungsdaten(gesendet), []);
  assert.deepEqual(regelKeinKlartext(gesendet, [NOTIZ, "falsches_modell", jobId, "21000"]), []);
});

test("Reklamation: weder Identitaet noch Sitzung sichtbar, p-Tags nur an Provider und Pruefer", async () => {
  const { gesendet, identitaet, sitzung, provider, pruefer } = await reklamiere();
  assert.deepEqual(regelKundeVerborgen(gesendet, identitaet), []);
  assert.deepEqual(regelKundeVerborgen(gesendet, sitzung), []);
  assert.deepEqual(regelPTagsNur(gesendet, [provider.publicKey(), pruefer.publicKey()]), []);
});

test("Reklamation: Provider und Pruefer lesen sie vollstaendig", async () => {
  const { gesendet, sitzung, provider, pruefer, jobId } = await reklamiere();
  for (const [wrap, signer] of [[gesendet[0], provider], [gesendet[1], pruefer]] as const) {
    const r = await openPrivateKundenEvent(wrap, signer, 8);
    assert.ok(r.ok, !r.ok ? r.grund : "");
    assert.equal(r.kundePk, sitzung);
    const d = parseDispute({ ...r.request, sig: "" });
    assert.deepEqual([d.jobId, d.reason, d.amountMsat, d.note], [jobId, "falsches_modell", 21_000, NOTIZ]);
  }
});

test("Verdrahtung: reklamiere() versiegelt wie das Szenario, der KI-Verlauf liegt nur im Tresor", () => {
  const agent = ["agent", "modellwahl", "agent-verlauf", "agent-wege", "agent-anzeige", "agent-eingabe"].map((d) => readFileSync(new URL(`../../src/shell/tabs/${d}.ts`, import.meta.url), "utf8")).join("\n");
  const f = agent.slice(agent.indexOf("async function reklamiere("), agent.indexOf("function addUsageBubble("));
  // Seit D1b: der Schlüssel des Auftrags, nicht der aktuelle für den Provider
  assert.match(f, /const sitzung = auftragId \? kiSitzungen\.fuerAuftrag\(auftragId\) : undefined;\n  if \(!state\.keypair \|\| !jobId \|\| !sitzung\) \{/);
  assert.doesNotMatch(f, /kiSitzungen\.fuer\(/);
  assert.match(f, /buildDispute\(\{\s*jobId, customerPubkey: sitzung\.publicKey\(\), providerPubkey: providerPk,/);
  // Seit 5.6b: Pruefer aus dem eigenen Netz, genannt in der Reklamation; Material nur fuer ihn.
  assert.match(f, /const empfaenger = \[\s*\{ pk: providerPk, powBits: powJeProvider\.get\(providerPk\) \?\? 0 \},\s*\.\.\.\(pruefer \? \[\{ pk: pruefer\.pk,/);
  assert.match(f, /pruefer: pruefer \? \[pruefer\.pk\] : \[\],/);
  assert.match(f, /await buildPrivateDispute\(\{ dispute, sessionSigner: sitzung, empfaenger, materialFuerPruefer: material \}\);/);
  assert.match(f, /await \(await ensurePool\(\)\)\.publish\(wraps\[0\]!\);/);
  assert.match(f, /await stelleZu\(wraps\[1\]!, pruefer\);/);
  // Nie mehr offen: kein signiertes Reklamations-Event direkt in den Pool
  assert.doesNotMatch(f, /publish\(await sitzung\.signEvent\(/);
  assert.doesNotMatch(f, /\(öffentlich\)/);
  // Verlauf: nur ueber geheim, nie direkt in localStorage
  assert.match(agent, /geheim\.getItem\("freedom\.agentHistory"\)/);
  assert.match(agent, /geheim\.setItem\("freedom\.agentHistory"/);
  assert.doesNotMatch(agent, /localStorage\.setItem\("freedom\.(agentHistory|chats)/);
  const tresor = readFileSync(new URL("../../src/shell/tresor.ts", import.meta.url), "utf8");
  assert.match(tresor, /"freedom\.agentHistory"/);
});

test("5.6b: Pruefer aus dem Netz mit Frage und Antwort – Relays sehen nichts davon, nur der Pruefer liest es", async () => {
  const { pool, relay } = aufzeichnung();
  const provider = new LocalSigner(generateKeypair().sk);
  const kontakt = new LocalSigner(generateKeypair().sk);
  const sitzung = new KiSitzungen().fuer(provider.publicKey());
  const FRAGE = "Wie hoch ist die Rate fuer meinen Kredit bei der Hausbank?";
  const ANTWORT = "Ein Rezept fuer Apfelkuchen";
  const dispute = buildDispute({
    jobId: "b".repeat(64), customerPubkey: sitzung.publicKey(), providerPubkey: provider.publicKey(),
    reason: "unbrauchbar", amountMsat: 21_000, note: NOTIZ, pruefer: [kontakt.publicKey()],
  });
  const { wraps } = await buildPrivateDispute({
    dispute, sessionSigner: sitzung, empfaenger: [{ pk: provider.publicKey(), powBits: 8 }, { pk: kontakt.publicKey() }],
    materialFuerPruefer: { frage: FRAGE, antwort: ANTWORT },
  });
  for (const w of wraps) await pool.publish(w);
  assert.deepEqual(regelKeinKlartext(relay.gesendet, [FRAGE, ANTWORT, NOTIZ, "unbrauchbar"]), []);
  assert.deepEqual(regelKeineZahlungsdaten(relay.gesendet), []);
  assert.deepEqual(regelKundeVerborgen(relay.gesendet, sitzung.publicKey()), []);
  assert.deepEqual(regelPTagsNur(relay.gesendet, [provider.publicKey(), kontakt.publicKey()]), []);
  const beimKontakt = await openPrivateKundenEvent(relay.gesendet[1]!, kontakt);
  assert.ok(beimKontakt.ok);
  assert.deepEqual(parseDispute({ ...beimKontakt.request, sig: "" }).material, { frage: FRAGE, antwort: ANTWORT });
  const beimProvider = await openPrivateKundenEvent(relay.gesendet[0]!, provider, 8);
  assert.ok(beimProvider.ok);
  assert.equal(parseDispute({ ...beimProvider.request, sig: "" }).material, undefined);
});
