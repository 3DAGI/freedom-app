/**
 * Leak-Szenario „Trinkgeld-Adresse“ (Schritt 4.9d): Anfrage und Antwort so,
 * wie `chat-zap.ts` und die Posteingang-Antwort in `kommunikation.ts` sie
 * senden – mitgeschnitten am Relay. Weder die Adresse noch Geber oder
 * Empfaenger als Autor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LocalSigner, buildAdressAnfrage, buildAdressAntwort, generateKeypair, regelAutorNicht, regelKeineSolAdresse,
} from "@freedomstack/protocol";
import { aufzeichnung } from "./aufzeichnung.js";

const ADRESSE = "Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb";

test("Trinkgeld-Adresse: Relays sehen weder die Adresse noch, wer fragt oder antwortet", async () => {
  const { pool, relay } = aufzeichnung();
  const [geber, empf] = [new LocalSigner(generateKeypair().sk), new LocalSigner(generateKeypair().sk)];
  const { wrap, anfrageId } = await buildAdressAnfrage({ von: geber, anPk: empf.publicKey(), kette: "solana:mainnet" });
  await pool.publish(wrap);
  await pool.publish(await buildAdressAntwort({ von: empf, anPk: geber.publicKey(), anfrageId, adresse: ADRESSE, kette: "solana:mainnet" }));
  assert.equal(relay.gesendet.length, 2);
  assert.deepEqual(regelKeineSolAdresse(relay.gesendet, [ADRESSE]), []);
  assert.deepEqual(regelAutorNicht(relay.gesendet, geber.publicKey()), []);
  assert.deepEqual(regelAutorNicht(relay.gesendet, empf.publicKey()), []);
});
