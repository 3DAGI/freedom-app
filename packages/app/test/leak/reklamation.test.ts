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
  const agent = readFileSync(new URL("../../src/shell/tabs/agent.ts", import.meta.url), "utf8");
  const f = agent.slice(agent.indexOf("async function reklamiere("), agent.indexOf("function addUsageBubble("));
  assert.match(f, /const sitzung = kiSitzungen\.fuer\(providerPk\);/);
  assert.match(f, /buildDispute\(\{\s*jobId, customerPubkey: sitzung\.publicKey\(\), providerPubkey: providerPk,/);
  assert.match(f, /const empfaenger = \[providerPk, \.\.\.\(pruefer \? \[pruefer\] : \[\]\)\]/);
  assert.match(f, /await buildPrivateDispute\(\{ dispute, sessionSigner: sitzung, empfaenger \}\);/);
  assert.match(f, /for \(const wrap of wraps\) await pool\.publish\(wrap\);/);
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
