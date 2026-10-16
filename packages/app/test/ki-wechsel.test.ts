/**
 * D1b2: neuer Sitzungsschlüssel je Unterhaltung – alte bleiben eine Weile für
 * späte Antworten, offene Beträge begleicht die App mit dem alten Schlüssel
 * (ab 1 sat, Rechnung zuerst, unklar nie von selbst), Antworten fragt sie nur
 * für die Schlüssel der gesuchten Aufträge ab.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LocalSigner, generateKeypair } from "@freedomstack/protocol";
import { ALT_HALTEN_MS, KiSitzungen } from "../src/ki-sitzung.js";
import { SessionClient } from "../src/session-client.js";

const lies = (d: string) => readFileSync(new URL(`../src/${d}`, import.meta.url), "utf8");
const ohneKommentare = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("KiSitzungen: neue Unterhaltung, neue Schlüssel – alte halten nur für späte Antworten, Abfragen nur je Auftrag", () => {
  const s = new KiSitzungen();
  const [a, b] = [generateKeypair().pk, generateKeypair().pk];
  const T = 1_000_000;
  const altA = s.fuer(a);
  const altB = s.fuer(b);
  s.merkeAuftrag("r-alt", altA);
  assert.deepEqual(s.neueUnterhaltung(T), [altA, altB], "die bisherigen kommen zurück – zum Begleichen");
  const neuA = s.fuer(a);
  assert.notEqual(neuA.publicKey(), altA.publicKey());
  assert.equal(s.aktuell(a), neuA);
  assert.equal(s.aktuell(b), undefined, "angelegt erst beim nächsten Auftrag");
  s.merkeAuftrag("r-neu", neuA);
  // Späte Antworten an den alten Schlüssel lassen sich noch öffnen
  assert.equal(s.mitPubkey(altA.publicKey(), T + ALT_HALTEN_MS - 1), altA);
  // Abgefragt wird nur nach den Schlüsseln der gesuchten Aufträge – nie alte und neue zusammen
  assert.deepEqual(s.pubkeysFuer(["r-neu"], T + 1), [neuA.publicKey()]);
  assert.deepEqual(s.pubkeysFuer(["r-alt"], T + 1), [altA.publicKey()]);
  assert.deepEqual(s.pubkeysFuer(["unbekannt"], T + 1), []);
  // Nach der Haltezeit sind die alten weg
  assert.equal(s.mitPubkey(altA.publicKey(), T + ALT_HALTEN_MS), undefined);
  assert.deepEqual(s.pubkeysFuer(["r-alt"], T + ALT_HALTEN_MS), []);
  assert.equal(s.mitPubkey(neuA.publicKey(), T + ALT_HALTEN_MS), neuA, "der aktuelle bleibt");
  assert.deepEqual(s.neueUnterhaltung(T + 1), [neuA], "ohne Auftrag keiner mehr");
  assert.ok(ALT_HALTEN_MS >= 10 * 60_000, "länger als ein Lauf mit Failover");
});

test("SessionClient.begleiche: offene ganze sats mit dem alten Schlüssel – Rechnung zuerst, ohne neue Antwort, unklar nie von selbst", async () => {
  const provider = generateKeypair();
  const alt = new LocalSigner(generateKeypair().sk);
  const sc = new SessionClient({ signerFuer: () => alt });
  const zahlungen: number[] = [];
  let scheitert: "rechnung" | "zahlen" | null = null;
  const wallet = {
    async rechnung(msat: number) { if (scheitert === "rechnung") throw new Error("weg"); return `lnbc-${msat}`; },
    async zahle(rechnung: string, msat: number) { if (scheitert === "zahlen") throw new Error("Zeit"); zahlungen.push(msat); return "ab".repeat(32); },
  };
  assert.deepEqual(sc.offeneVon(alt.publicKey()), []);
  // Ohne Wallet verbucht (etwa: die Rechnung des Providers kam nicht) – seit RM2c3 zahlt sonst schon die Antwort
  await sc.chargeForResult(provider.pk, 12_500, undefined, alt);
  assert.deepEqual(zahlungen, []);
  assert.deepEqual(sc.offeneVon(alt.publicKey()), [provider.pk]);
  assert.deepEqual(sc.offeneVon(generateKeypair().pk), [], "nur je Schlüssel");

  // Rechnung scheitert: nichts gezahlt, nicht unklar – beim nächsten Mal wieder
  scheitert = "rechnung";
  assert.deepEqual(await sc.begleiche(provider.pk, alt, wallet), { settled: false, unklar: false, gezahltMsat: 0 });
  assert.deepEqual(await sc.begleiche(provider.pk, alt, undefined), { settled: false, unklar: false, gezahltMsat: 0 }, "ohne Wallet nichts");
  scheitert = null;
  const r = await sc.begleiche(provider.pk, alt, wallet);
  assert.deepEqual([r.settled, r.gezahltMsat, r.rechnung, r.paymentRef], [true, 12_000, "lnbc-12000", "ab".repeat(32)], "ganze sats ab 1 sat – mit dem Preimage die Quittung");
  assert.deepEqual(zahlungen, [12_000]);
  assert.deepEqual(sc.offeneVon(alt.publicKey()), [], "500 msat bleiben – keine ganze sat");
  assert.equal((await sc.begleiche(provider.pk, alt, wallet)).settled, false);

  // Unklarer Ausgang: gemeldet, danach nie von selbst
  await sc.chargeForResult(provider.pk, 3_000, undefined, alt);
  scheitert = "zahlen";
  assert.deepEqual(await sc.begleiche(provider.pk, alt, wallet), { settled: false, unklar: true, gezahltMsat: 0 });
  scheitert = null;
  assert.deepEqual(sc.offeneVon(alt.publicKey()), [], "unklar: nicht mehr offen zum Begleichen");
  assert.equal((await sc.begleiche(provider.pk, alt, wallet)).settled, false);
  assert.equal((await sc.chargeForResult(provider.pk, 1_000, wallet, alt)).settled, false, "auch keine neue Antwort zahlt für diesen Schlüssel");
  assert.deepEqual(zahlungen, [12_000]);
});

test("Verdrahtet: Wechsel bei neuer und anderer Unterhaltung, späte Antworten gleich beglichen, Abfrage nur je Auftrag", () => {
  const verlauf = lies("shell/tabs/agent-verlauf.ts");
  const oeffne = verlauf.slice(verlauf.indexOf("function oeffneVerlauf("), verlauf.indexOf("export function neueAufgabe("));
  assert.match(oeffne, /if \(aktuellerVerlauf\?\.id !== v\.id\) wechsleKiSchluessel\(\);[^\n]*\n  aktuellerVerlauf = v;/, "nur bei einer anderen Unterhaltung");
  const neu = verlauf.slice(verlauf.indexOf("export function neueAufgabe("));
  assert.match(neu, /neueZuordnung\(\);[^\n]*\n  wechsleKiSchluessel\(\);/);
  assert.equal(ohneKommentare(verlauf).match(/wechsleKiSchluessel\(\)/g)?.length, 2);

  const agent = lies("shell/tabs/agent.ts");
  assert.match(agent, /void quittungNachZahlung\(r\.providerPubkey, abrechnung\.providerMsat, charge\);\n[^\n]*\n  void begleicheWennVerlassen\(sc, r\.providerPubkey, kiSitzungen\.fuerAuftrag\(r\.requestId\)\)/);
  assert.match(lies("shell/pruefrunde-lauf.ts"), /void quittungNachZahlung\(r\.providerPubkey, abrechnung\.providerMsat, charge\);\n    void begleicheWennVerlassen\(sc, r\.providerPubkey, kiSitzungen\.fuerAuftrag\(r\.requestId\)\)/);
  assert.match(lies("shell/tabs/agent-wege.ts"), /const pks = quelle \? \[quelle\.sitzungPk\] : kiSitzungen\.pubkeysFuer\(ids\);/);

  const w = ohneKommentare(lies("shell/ki-wechsel.ts"));
  assert.match(w, /const bisher = kiSitzungen\.neueUnterhaltung\(\);/);
  assert.match(w, /for \(const provider of sc\.offeneVon\(kunde\.publicKey\(\)\)\) await begleiche\(sc, provider, kunde\);/);
  // Nur der Schlüssel, der schuldet – nie der aktuelle für einen verlassenen
  assert.match(w, /if \(!kunde \|\| kiSitzungen\.aktuell\(provider\) === kunde\) return;/);
  assert.match(w, /const \{ zahlung \} = await providerZahlung\(provider\);\n  if \(!zahlung\) return;[^\n]*\n  const r = await sc\.begleiche\(provider, kunde, zahlung\);/);
  assert.match(w, /await quittungNachBegleichen\(provider, r\);/);
  assert.doesNotMatch(w, /\.message|localStorage|geheim|publish\(/);
});
