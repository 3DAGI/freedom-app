/**
 * Leak-Szenario „SOL-Trinkgeld-Beleg“ (Schritt 4.7b): der echte Versand der
 * App (`sendeTrinkgeldBeleg`, aufgerufen von `sendZap()` in `chat-zap.ts`),
 * mitgeschnitten am Pool. Standard ist privat: nur Umschlaege, weder Adresse
 * noch Signatur noch Betrag noch Notiz auf den Relays.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalSigner, generateKeypair, regelKeinKlartext, regelKeineSolAdresse } from "@freedomstack/protocol";
import { sendeTrinkgeldBeleg } from "../../src/trinkgeld-beleg.js";
import { aufzeichnung } from "./aufzeichnung.js";

const AN = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb";
const SIG = "3".repeat(88);

test("SOL-Trinkgeld: der Beleg geht nur versiegelt ueber den Pool", async () => {
  const { pool, relay } = aufzeichnung();
  await sendeTrinkgeldBeleg(pool, new LocalSigner(generateKeypair().sk), {
    empfaenger: generateKeypair().pk, signatur: SIG, lamports: 2_345_678, an: AN, kette: "solana:mainnet", notiz: "Danke fürs Erklären",
  }, false);
  assert.equal(relay.gesendet.length, 2);
  assert.ok(relay.gesendet.every((e) => e.kind === 1059));
  assert.deepEqual(regelKeineSolAdresse(relay.gesendet, [AN]), []);
  assert.deepEqual(regelKeinKlartext(relay.gesendet, [SIG, "2345678", "Danke fürs Erklären"]), []);
});
