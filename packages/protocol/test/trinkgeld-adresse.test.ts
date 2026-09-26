/**
 * Schritt 4.9d: Adresse fuer ein SOL-Trinkgeld versiegelt anfragen. Geprueft
 * wird, dass Relays weder Adresse noch Geber sehen, dass nur der Empfaenger
 * die Anfrage oeffnet und der Geber nur dessen Antwort zur eigenen Anfrage nimmt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIND_ADRESS_ANFRAGE, buildAdressAnfrage, buildAdressAntwort, oeffneAdressAnfrage, oeffneAdressAntwort,
} from "../src/trinkgeld-adresse.js";
import { giftWrapMitSigner } from "../src/gift-wrap.js";
import { LocalSigner } from "../src/signer.js";
import { generateKeypair } from "../src/event.js";

const neu = () => new LocalSigner(generateKeypair().sk);
const ADRESSE = "Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb";

test("Anfrage und Antwort: nur die Beteiligten oeffnen, Relays sehen weder Geber noch Adresse", async () => {
  const [geber, empf, fremd] = [neu(), neu(), neu()];
  const { wrap, anfrageId } = await buildAdressAnfrage({ von: geber, anPk: empf.publicKey(), kette: "solana:devnet", nowSecs: 1_790_000_000 });
  assert.equal(wrap.created_at, 1_790_000_000);
  assert.ok(!JSON.stringify(wrap).includes(geber.publicKey()), "Geber nicht offen");
  assert.equal(await oeffneAdressAnfrage(wrap, fremd), null);
  const a = await oeffneAdressAnfrage(wrap, empf);
  assert.deepEqual(a, { von: geber.publicKey(), anfrageId, kette: "solana:devnet", zeit: 1_790_000_000 });

  const antwort = await buildAdressAntwort({ von: empf, anPk: geber.publicKey(), anfrageId, adresse: ADRESSE, kette: "solana:devnet" });
  assert.ok(!JSON.stringify(antwort).includes(ADRESSE), "Adresse nicht offen");
  assert.deepEqual(await oeffneAdressAntwort(antwort, geber, { vonPk: empf.publicKey(), anfrageId }), { adresse: ADRESSE, kette: "solana:devnet" });
  assert.equal(await oeffneAdressAntwort(antwort, geber, { vonPk: fremd.publicKey(), anfrageId }), null, "von einem anderen");
  assert.equal(await oeffneAdressAntwort(antwort, geber, { vonPk: empf.publicKey(), anfrageId: "00".repeat(32) }), null, "zu einer anderen Anfrage");
  const untergeschoben = await buildAdressAntwort({ von: fremd, anPk: geber.publicKey(), anfrageId, adresse: ADRESSE, kette: "solana:devnet" });
  assert.equal(await oeffneAdressAntwort(untergeschoben, geber, { vonPk: empf.publicKey(), anfrageId }), null, "Fremder gibt sich als Empfaenger aus");
});

test("Streng gelesen: falsche Kette, kaputte Adresse, fremder Kern ergeben null oder werfen", async () => {
  const [geber, empf] = [neu(), neu()];
  await assert.rejects(() => buildAdressAnfrage({ von: geber, anPk: empf.publicKey(), kette: "ethereum" }), /Kette/);
  await assert.rejects(() => buildAdressAntwort({ von: empf, anPk: geber.publicKey(), anfrageId: "ab".repeat(32), adresse: "<x>", kette: "solana:devnet" }), /Adresse/);
  const kern = (kind: number, tags: string[][]) => giftWrapMitSigner({ pubkey: geber.publicKey(), kind, created_at: 1, tags, content: "" }, geber, empf.publicKey());
  assert.equal(await oeffneAdressAnfrage(await kern(14, [["kette", "solana:devnet"]]), empf), null, "eine DM ist keine Anfrage");
  assert.equal(await oeffneAdressAnfrage(await kern(KIND_ADRESS_ANFRAGE, [["kette", "ethereum"]]), empf), null);
});
