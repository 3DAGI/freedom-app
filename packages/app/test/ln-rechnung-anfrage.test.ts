/**
 * Schritt 6.3b: Rechnung versiegelt beim Kontakt erfragen – der ganze Weg über
 * ein Relay. Der Empfänger antwortet nur Kontakten, nur auf frische Anfragen,
 * gebremst, und nur mit einer Rechnung seiner eigenen Wallet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LocalSigner, MemoryRelay, OutboxPool, generateKeypair, leseBolt11, type NostrEvent } from "@freedomstack/protocol";
import { ANFRAGE_GUELTIG_SECS, RechnungsBremse, beantworteRechnungsAnfrage, frageRechnungAn } from "../src/ln-rechnung-anfrage.js";
import { knotenSchluessel, rechnung } from "../../protocol/test/bolt11-hilfe.js";

const knoten = knotenSchluessel();
/** Die Wallet des Empfängers: stellt eine Rechnung über genau den Betrag aus (1n = 100 msat). */
const wallet = async (msat: number) => rechnung(knoten, `lnbc${msat / 100}n`, crypto.getRandomValues(new Uint8Array(32)));

function aufbau(o: { kontakt?: boolean; versatz?: number; ohneWallet?: boolean; falscherBetrag?: boolean; bremse?: RechnungsBremse } = {}) {
  const pool = new OutboxPool([new MemoryRelay("mem://ln")], { minAcks: 1 });
  const empf = new LocalSigner(generateKeypair().sk);
  const bremse = o.bremse ?? new RechnungsBremse();
  const gesehen = new Set<string>();
  const ausgestellt: number[] = [];
  /** Die App des Empfängers: öffnet ihren Posteingang (wie alsRechnungsAnfrage). */
  const empfaengerApp = async () => {
    for (const w of await pool.query({ kinds: [1059], "#p": [empf.publicKey()] })) {
      if (gesehen.has(w.id)) continue;
      gesehen.add(w.id);
      await beantworteRechnungsAnfrage({
        wrap: w, signer: empf, bremse, istKontakt: () => o.kontakt !== false,
        stelleAus: async (msat) => { if (o.ohneWallet) return undefined; ausgestellt.push(msat); return wallet(o.falscherBetrag ? msat * 2 : msat); },
        sende: async (wrap: NostrEvent) => { await pool.publish(wrap); },
        jetzt: Math.floor(Date.now() / 1000) + (o.versatz ?? 0),
      });
    }
  };
  const zugestellt: string[] = [];
  const frage = (zahler = new LocalSigner(generateKeypair().sk), betragMsat = 21_000) =>
    frageRechnungAn({ pool, signer: zahler, empfaenger: empf.publicKey(), betragMsat, warteMs: 300, pause: empfaengerApp,
      sende: async (wrap, an) => { zugestellt.push(an); await pool.publish(wrap); } });
  return { pool, empf, frage, ausgestellt, zugestellt };
}

test("6.3b: Kontakt fragt – bekommt eine Rechnung der Wallet über genau den Betrag", async () => {
  const a = aufbau();
  const pr = await a.frage();
  assert.ok(pr);
  assert.equal(leseBolt11(pr).betragMsat, 21_000);
  assert.deepEqual(a.ausgestellt, [21_000]);
  assert.deepEqual(a.zugestellt, [a.empf.publicKey()], "die Anfrage geht an den Posteingang des Empfängers");
});

test("6.3b: keine Rechnung – Fremde, alte Anfragen, ohne Wallet, falscher Betrag der Wallet", async () => {
  assert.equal(await aufbau({ kontakt: false }).frage(), undefined, "kein Kontakt");
  assert.equal(await aufbau({ versatz: ANFRAGE_GUELTIG_SECS + 60 }).frage(), undefined, "zu alt");
  assert.equal(await aufbau({ versatz: -600 }).frage(), undefined, "aus der Zukunft");
  assert.equal(await aufbau({ ohneWallet: true }).frage(), undefined, "ohne Wallet");
  assert.equal(await aufbau({ falscherBetrag: true }).frage(), undefined, "der Zahler nimmt nur genau den Betrag");
});

test("6.3b: Bremse – je Kontakt eine je 30 s, insgesamt zehn je Minute", () => {
  const b = new RechnungsBremse();
  assert.equal(b.erlaubt("a", 0), true);
  assert.equal(b.erlaubt("a", 10_000), false, "derselbe Kontakt zu früh");
  assert.equal(b.erlaubt("a", 30_000), true);
  for (let i = 0; i < 8; i++) assert.equal(b.erlaubt(`k${i}`, 40_000), true);
  assert.equal(b.erlaubt("x", 41_000), false, "zehn in der Minute");
  assert.equal(b.erlaubt("x", 61_000), true, "die erste ist aus der Minute");
  const gebremst = new RechnungsBremse();
  gebremst.erlaubt("egal", Date.now());
  for (let i = 0; i < 9; i++) gebremst.erlaubt(`v${i}`, Date.now());
  return aufbau({ bremse: gebremst }).frage().then((pr) => assert.equal(pr, undefined, "gebremst: keine Rechnung"));
});

test("Verdrahtung (6.3b): Zap ohne öffentliche Adresse fragt versiegelt; der Posteingang antwortet mit der eigenen Wallet", () => {
  const z = readFileSync(new URL("../src/chat-zap.ts", import.meta.url), "utf8");
  assert.match(z, /if \(lud16\) \{[\s\S]*?baueZapAnfrage[\s\S]*?\} else \{[\s\S]*?rechnung = await frageRechnungAn\(\{ pool, signer: appState\.signer!, empfaenger: state\.recipientPubkey, betragMsat, sende: veroeffentlicheDm \}\) \?\? "";/, "an den Posteingang des Empfängers");
  assert.match(z, /await zahle\(zahlschienen\(\), \{ ziel: rechnung, betrag: \{ einheit: "msat", wert: betragMsat \}, zweck: "zap" \}\)/, "gezahlt über die Schiene, die den Betrag prüft");
  const k = readFileSync(new URL("../src/shell/tabs/kommunikation.ts", import.meta.url), "utf8");
  assert.match(k, /async function alsRechnungsAnfrage\(w: NostrEvent\): Promise<null> \{[\s\S]*?stelleAus: eigeneRechnung,/);
  const s = readFileSync(new URL("../src/shell/zahlschienen.ts", import.meta.url), "utf8");
  assert.match(s, /return nwc \? \(await nwc\.makeInvoice\(betragMsat, ""\)\)\.invoice : undefined;/, "Rechnung der eigenen Wallet, ohne Beschreibung");
});
