/**
 * Schritt 4.9b: Die App tauscht nur noch im Umschlag. Geprueft wird, dass sie
 * nur LPs anfragt, die Umschlaege lesen, und nur Antworten annimmt, die der LP
 * selbst zu genau dieser Anfrage versiegelt hat.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LocalSigner, MemoryRelay, OutboxPool, buildEvent, generateKeypair, oeffneSwapAnfrage, signEvent, versiegleSwapAntwort,
} from "@freedomstack/protocol";
import { hinAnfrage, liestUmschlaege, rueckAnfrage, swapAntworten } from "../src/swap-umschlag.js";

const SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

test("Nur LPs mit [\"versiegelt\", \"1\"] werden angefragt", () => {
  assert.equal(liestUmschlaege({ versiegelt: true }), true);
  assert.equal(liestUmschlaege({}), false);
});

test("Hinanfrage: jede von einem neuen Wegwerf-Schluessel, der LP liest Betrag, Hashlock und Adresse", async () => {
  const lp = new LocalSigner(generateKeypair().sk);
  const p = { lpPk: lp.publicKey(), offerId: "lp-1", amountSats: 21000, hashlockHex: "ab".repeat(32), solAdresse: SOL };
  const [a, b] = [await hinAnfrage(p), await hinAnfrage(p)];
  assert.notEqual(a.einmal.publicKey(), b.einmal.publicKey(), "je Swap ein eigener Schluessel");
  const ev = await oeffneSwapAnfrage(a.wrap, lp);
  assert.deepEqual(ev?.tags, [["p", lp.publicKey()], ["offer", "lp-1"], ["amount_sats", "21000"], ["hashlock", "ab".repeat(32)], ["solana_address", SOL]]);
  assert.equal(ev?.id, a.anfrageId);
});

test("Antworten: nur versiegelt, nur vom LP, nur zur eigenen Anfrage – offene und fremde fallen heraus", async () => {
  const lp = new LocalSigner(generateKeypair().sk);
  const fremd = new LocalSigner(generateKeypair().sk);
  const pool = new OutboxPool([new MemoryRelay("mem://swap")], { minAcks: 1 });
  const post = await rueckAnfrage({ lpPk: lp.publicKey(), offerId: "lp-1-buy", bolt11: "lnbc1" });
  const kunde = post.einmal.publicKey();
  const andere = await rueckAnfrage({ lpPk: lp.publicKey(), offerId: "lp-1-buy", bolt11: "lnbc2" });
  await pool.publish(await versiegleSwapAntwort({ lp, kundePk: kunde, anfrageId: post.anfrageId, tags: [["status", "EINGELOEST"]], content: "" }));
  await pool.publish(await versiegleSwapAntwort({ lp: fremd, kundePk: kunde, anfrageId: post.anfrageId, tags: [["status", "VORAB"]], content: "lnbcfremd" }));
  await pool.publish(await versiegleSwapAntwort({ lp, kundePk: kunde, anfrageId: andere.anfrageId, tags: [["status", "GESCHEITERT"]], content: "" }));
  // Eine offene Antwort des LP (wie vor 4.9) zaehlt nicht mehr
  const k = generateKeypair();
  await pool.publish(signEvent(buildEvent(k.pk, 25002, [["e", post.anfrageId], ["p", kunde], ["status", "ABGELEHNT"]], ""), k.sk));
  const a = await swapAntworten(pool, post);
  assert.deepEqual(a.map((x) => x.tags.find((t) => t[0] === "status")?.[1]), ["EINGELOEST"]);
});

test("Verdrahtung (4.9b): Angebotsliste fragt LPs ohne Umschlag nicht an; beide Richtungen lesen nur swapAntworten", () => {
  const w = readFileSync(new URL("../src/shell/tabs/waehrung.ts", import.meta.url), "utf8");
  assert.match(w, /if \(!liestUmschlaege\(offer\)\) \{[^}]*knopf\.disabled = true;/);
  const rueck = w.slice(w.indexOf("async function warteAufRueckAntwort("), w.indexOf("export async function exportSwapBackup("));
  assert.match(rueck, /\(await swapAntworten\(pool, post\)\)\.map\(leseRueckAntwort\)/);
  assert.doesNotMatch(w, /KIND_SWAP_RESPONSE|KIND_SWAP_REQUEST/, "keine offenen Swap-Events mehr");
});
