/**
 * Schritt 4.9: Swap-Anfragen und -Antworten nur im Umschlag. Geprueft wird,
 * dass Relays weder Rechnung noch SOL-Adresse sehen, dass nur der LP die
 * Anfrage oeffnet und dass der Kunde nur die Antwort seines LP zu seiner
 * Anfrage annimmt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIND_SWAP_ANFRAGE, KIND_SWAP_ANTWORT, oeffneSwapAnfrage, oeffneSwapAntwort, versiegleSwapAnfrage, versiegleSwapAntwort,
} from "../src/swap-versiegelt.js";
import { giftWrapMitSigner } from "../src/gift-wrap.js";
import { LocalSigner } from "../src/signer.js";
import { generateKeypair } from "../src/event.js";

const neu = () => new LocalSigner(generateKeypair().sk);
const SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const BOLT11 = "lnbc100u1" + "q".repeat(300);

test("Anfrage: nur der LP oeffnet sie, Tags unveraendert, ID wie berechnet", async () => {
  const [kunde, lp, fremd] = [neu(), neu(), neu()];
  const tags = [["offer", "lp-1"], ["amount_sats", "21000"], ["hashlock", "ab".repeat(32)], ["solana_address", SOL]];
  const { wrap, anfrageId } = await versiegleSwapAnfrage({ tags, kunde, lpPk: lp.publicKey(), nowSecs: 1_790_000_000 });
  assert.equal(wrap.kind, 1059);
  assert.equal(wrap.created_at, 1_790_000_000, "ohne Zeitversatz – der LP liest die letzte Stunde");
  assert.deepEqual(wrap.tags, [["p", lp.publicKey()]]);
  assert.ok(!JSON.stringify(wrap).includes(SOL), "keine SOL-Adresse im Umschlag");
  assert.ok(!JSON.stringify(wrap).includes(kunde.publicKey()), "kein Absender im Umschlag");
  assert.equal(await oeffneSwapAnfrage(wrap, fremd), null);
  const a = await oeffneSwapAnfrage(wrap, lp);
  assert.ok(a);
  assert.equal(a.id, anfrageId);
  assert.equal(a.kind, KIND_SWAP_ANFRAGE);
  assert.equal(a.pubkey, kunde.publicKey());
  assert.deepEqual(a.tags, [["p", lp.publicKey()], ...tags]);
});

test("Anfrage in der Gegenrichtung: keine Rechnung im Umschlag; ein fremdes ['p'] wird ersetzt", async () => {
  const [kunde, lp] = [neu(), neu()];
  const { wrap } = await versiegleSwapAnfrage({ tags: [["p", "ee".repeat(32)], ["offer", "lp-1-buy"], ["bolt11", BOLT11]], kunde, lpPk: lp.publicKey() });
  assert.ok(!JSON.stringify(wrap).includes(BOLT11.slice(0, 40)));
  const a = await oeffneSwapAnfrage(wrap, lp);
  assert.deepEqual(a?.tags.filter((t) => t[0] === "p"), [["p", lp.publicKey()]]);
});

test("Der LP nimmt nur Swap-Anfragen aus dem Umschlag – andere Kerne ergeben null", async () => {
  const [kunde, lp] = [neu(), neu()];
  for (const kind of [1, 14, 25010, KIND_SWAP_ANTWORT]) {
    const wrap = await giftWrapMitSigner({ pubkey: kunde.publicKey(), kind, created_at: 1, tags: [], content: "" }, kunde, lp.publicKey());
    assert.equal(await oeffneSwapAnfrage(wrap, lp), null, String(kind));
  }
  const zuLang = await giftWrapMitSigner({ pubkey: kunde.publicKey(), kind: KIND_SWAP_ANFRAGE, created_at: 1, tags: [], content: "x".repeat(5001) }, kunde, lp.publicKey());
  assert.equal(await oeffneSwapAnfrage(zuLang, lp), null, "Inhalt zu lang");
  await assert.rejects(() => versiegleSwapAnfrage({ tags: [], kunde, lpPk: "npub1xyz" }), /LP-Pubkey/);
});

test("Antwort: nur vom erwarteten LP und nur zur eigenen Anfrage", async () => {
  const [kunde, lp, fremd] = [neu(), neu(), neu()];
  const { anfrageId } = await versiegleSwapAnfrage({ tags: [["offer", "lp-1"]], kunde, lpPk: lp.publicKey() });
  const antwort = await versiegleSwapAntwort({
    lp, kundePk: kunde.publicKey(), anfrageId, tags: [["swap_id", "swap-1"], ["amount_lamports", "1000"]], content: BOLT11,
  });
  assert.ok(!JSON.stringify(antwort).includes(BOLT11.slice(0, 40)), "Rechnung des LP nicht offen");
  assert.ok(!JSON.stringify(antwort).includes("swap-1"), "Swap-ID nicht offen – sie fuehrt zur Sperre auf der Kette");
  const o = await oeffneSwapAntwort(antwort, kunde, { lpPk: lp.publicKey(), anfrageId });
  assert.equal(o?.content, BOLT11);
  assert.deepEqual(o?.tags, [["e", anfrageId], ["p", kunde.publicKey()], ["swap_id", "swap-1"], ["amount_lamports", "1000"]]);
  assert.equal(await oeffneSwapAntwort(antwort, kunde, { lpPk: fremd.publicKey(), anfrageId }), null, "anderer LP erwartet");
  assert.equal(await oeffneSwapAntwort(antwort, kunde, { lpPk: lp.publicKey(), anfrageId: "00".repeat(32) }), null, "andere Anfrage");
  assert.equal(await oeffneSwapAntwort(antwort, fremd, { lpPk: lp.publicKey(), anfrageId }), null, "nicht an mich");
  const untergeschoben = await versiegleSwapAntwort({ lp: fremd, kundePk: kunde.publicKey(), anfrageId, tags: [["status", "VORAB"]], content: BOLT11 });
  assert.equal(await oeffneSwapAntwort(untergeschoben, kunde, { lpPk: lp.publicKey(), anfrageId }), null, "Fremder gibt sich als LP aus");
});
