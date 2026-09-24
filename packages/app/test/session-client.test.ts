/**
 * SessionClient signiert ueber den Signer (Schritt 1.3) – nicht mit dem rohen
 * Schluessel, und der Schluessel steckt in keiner Darstellung des Clients.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalSigner, generateKeypair, toHex, verifyEvent, type NostrEvent, type OutboxPool } from "@freedomstack/protocol";
import { SessionClient } from "../src/session-client.js";

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
    signer: new LocalSigner(kunde.sk), pool, defaultBudgetSats: 100, settleEverySats: 20, ttlSecs: 3600,
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
  const sc = new SessionClient({
    signer: new LocalSigner(kunde.sk), pool, defaultBudgetSats: 100, settleEverySats: 20, ttlSecs: 3600,
  });
  const json = JSON.stringify(sc);
  assert.ok(!json.includes(toHex(kunde.sk)), "kein Schluessel als Hex");
  // Vorher lag cfg.keypair.sk hier als Zahlenobjekt {"0":…} – jetzt nur der Signer mit Pubkey
  assert.ok(!/"sk"/.test(json), "kein Feld sk");
  assert.ok(json.includes('"type":"LocalSigner"') && json.includes(kunde.pk));
});
