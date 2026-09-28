/**
 * Leak-Szenario „Zap im Chat“ (Schritt 6.3): Die Zap-Anfrage (9734), die
 * `sendZap()` in `chat-zap.ts` an den LNURL-Server des Empfängers schickt,
 * veröffentlicht dieser samt Rechnung in der Quittung (9735). Darum ist sie
 * anonym – nie von der Identität, immer mit „anon“, ohne Adresse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, regelAutorNicht, regelZapAnonym, verifyEvent, type NostrEvent } from "@freedomstack/protocol";
import { baueZapAnfrage, holeZapRechnung } from "../../src/zap-zahlung.js";

test("Zap: die Anfrage an den LNURL-Server ist anonym – signiert von einem Wegwerf-Schlüssel", async () => {
  const ich = generateKeypair().pk;
  const empfaenger = generateKeypair().pk;
  const gesendet: NostrEvent[] = [];
  const holen = (async (url: string) => {
    const u = new URL(url);
    if (u.pathname.startsWith("/.well-known/")) {
      return new Response(JSON.stringify({ tag: "payRequest", callback: "https://zap.example/cb", allowsNostr: true, minSendable: 1000, maxSendable: 1e9 }));
    }
    gesendet.push(JSON.parse(u.searchParams.get("nostr")!) as NostrEvent);
    return new Response(JSON.stringify({ pr: "lnbc210n1rechnung" }));
  }) as typeof fetch;

  const zwei = [baueZapAnfrage({ empfaenger, betragMsat: 21_000, relays: ["wss://eigen.example"] }), baueZapAnfrage({ empfaenger, betragMsat: 21_000, relays: ["wss://eigen.example"] })];
  for (const zapRequest of zwei) await holeZapRechnung({ lud16: "bob@zap.example", betragMsat: 21_000, zapRequest, holen });

  assert.equal(gesendet.length, 2);
  assert.ok(gesendet.every((e) => e.kind === 9734 && verifyEvent(e)), "gültig signiert – sonst lehnt der Server ab");
  assert.deepEqual(regelZapAnonym(gesendet, ich), []);
  assert.deepEqual(regelAutorNicht(gesendet, ich), []);
  assert.notEqual(gesendet[0].pubkey, gesendet[1].pubkey, "je Zap ein neuer Schlüssel – zwei Zaps verbinden sich nicht");
  assert.ok(gesendet.every((e) => e.tags.some((t) => t[0] === "p" && t[1] === empfaenger)));
});
