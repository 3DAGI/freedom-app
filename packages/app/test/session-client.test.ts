/**
 * SessionClient signiert ueber den Signer (Schritt 1.3) – nicht mit dem rohen
 * Schluessel, und der Schluessel steckt in keiner Darstellung des Clients.
 * Seit 3.1 ist das der Sitzungsschluessel je Provider, nie die Identitaet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalSigner, generateKeypair, toHex, verifyEvent, type NostrEvent, type OutboxPool } from "@freedomstack/protocol";
import { SessionClient } from "../src/session-client.js";
import { KiSitzungen } from "../src/ki-sitzung.js";

function fakePool(): { pool: OutboxPool; gesendet: NostrEvent[] } {
  const gesendet: NostrEvent[] = [];
  const pool = { publish: async (ev: NostrEvent) => { gesendet.push(ev); return { ok: true }; } } as unknown as OutboxPool;
  return { pool, gesendet };
}

test("SessionClient: Session-Eroeffnung ist vom Signer signiert", async () => {
  const kunde = generateKeypair();
  const provider = generateKeypair();
  const { pool, gesendet } = fakePool();
  const sc = new SessionClient({
    signerFuer: () => new LocalSigner(kunde.sk), pool, defaultBudgetSats: 100, settleEverySats: 20, ttlSecs: 3600,
  });
  const s = await sc.openSession(provider.pk);
  assert.equal(gesendet.length, 1);
  assert.equal(verifyEvent(gesendet[0]), true);
  assert.equal(gesendet[0].pubkey, kunde.pk);
  assert.ok(s.open.sessionId.startsWith(`sess-${kunde.pk.slice(0, 8)}-`));
});

test("SessionClient: der Schluessel taucht nicht auf, wenn der Client serialisiert wird", () => {
  const kunde = generateKeypair();
  const { pool } = fakePool();
  const signer = new LocalSigner(kunde.sk);
  const sc = new SessionClient({
    signerFuer: () => signer, pool, defaultBudgetSats: 100, settleEverySats: 20, ttlSecs: 3600,
  });
  const json = JSON.stringify(sc);
  assert.ok(!json.includes(toHex(kunde.sk)), "kein Schluessel als Hex");
  // Vorher lag cfg.keypair.sk hier als Zahlenobjekt {"0":…} – jetzt haelt der Client nur eine Funktion
  assert.ok(!/"sk"/.test(json), "kein Feld sk");
});

test("SessionClient mit KiSitzungen: je Provider ein eigener Schluessel, nie die Identitaet", async () => {
  const identitaet = generateKeypair();
  const [a, b] = [generateKeypair().pk, generateKeypair().pk];
  const { pool, gesendet } = fakePool();
  const sitzungen = new KiSitzungen();
  const sc = new SessionClient({
    signerFuer: (pk) => sitzungen.fuer(pk), pool, defaultBudgetSats: 100, settleEverySats: 20, ttlSecs: 3600,
  });
  await sc.openSession(a);
  await sc.openSession(b);
  await sc.chargeForResult(a, 5000, "e".repeat(64));
  assert.equal(gesendet.length, 3);
  assert.ok(gesendet.every((ev) => verifyEvent(ev) && ev.pubkey !== identitaet.pk));
  assert.equal(gesendet[0].pubkey, sitzungen.fuer(a).publicKey());
  assert.equal(gesendet[1].pubkey, sitzungen.fuer(b).publicKey());
  assert.notEqual(gesendet[0].pubkey, gesendet[1].pubkey, "zwei Provider sehen nicht denselben Schluessel");
  assert.equal(gesendet[2].pubkey, gesendet[0].pubkey, "Beleg vom Sitzungsschluessel desselben Providers");
  assert.equal(sitzungen.fuer(a), sitzungen.fuer(a), "fester Schluessel je Provider");
});
