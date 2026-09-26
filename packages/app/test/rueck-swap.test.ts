/**
 * Schritt 4.6c: Swap SOL → Lightning in der App. Geprueft wird, dass die App
 * erst plant und dann sperrt – mit genau dem Betrag und der Frist, die der LP
 * (4.6b) verlangt –, und dass sie dem Nutzer ehrlich sagt, wo sein Geld ist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  type LpOffer, generatePreimage, hashlock, toHex, rueckSwapId, rueckSwapLamports, pruefeRueckSwapSperre, fromHex,
} from "@freedomstack/protocol";
import {
  MAX_RUECK_FRIST_SECS, RUECK_PUFFER_SECS, baueRueckAnfrage, istRueckAngebot, leseRueckAntwort, planeRueckSwap, rueckText,
} from "../src/rueck-swap.js";
import { knotenSchluessel, rechnung } from "../../protocol/test/bolt11-hilfe.js";

const JETZT = 1_790_000_000;
const LP_SOL = "LpSoL11111111111111111111111111111111111111";
const WALLET = knotenSchluessel(); // Lightning-Wallet des Nutzers

const angebot: LpOffer = {
  offerId: "lp-1-buy", pair: "LN-BTC/SOL", direction: "buy-sol", minSats: 1000, maxSats: 100_000, feePpm: 10_000,
  tSolSecs: 3600, lnCltvDeltaBlocks: 144, expiry: JETZT + 3600, solAddress: LP_SOL, lamportsPerSat: 100,
};

test("Plan: Betrag, Swap-ID, Hashlock und Frist so, wie der LP sie prueft", () => {
  const pre = generatePreimage();
  const bolt11 = rechnung(WALLET, "lnbc100u", pre);
  const p = planeRueckSwap(angebot, bolt11, 10_000, JETZT);
  assert.equal(p.lamports, 1_010_000, "10.000 sats · 100 Lamports · 1 % Gebuehr");
  assert.equal(p.lamports, rueckSwapLamports(10_000, 100, 10_000));
  assert.equal(p.swapId, rueckSwapId(bolt11));
  assert.equal(p.paymentHashHex, toHex(hashlock(pre)));
  assert.equal(p.lpSol, LP_SOL);
  // 144 Bloecke · 20 min + 1 h + 30 min Puffer
  assert.equal(p.timelockUnix, JETZT + 144 * 1200 + 3600 + RUECK_PUFFER_SECS);
  // Auch wenn der ganze Puffer verbraucht ist, nimmt der LP die Sperre mit vollem cltv_limit an.
  const sperre = { recipient: p.lpSol, amountLamports: p.lamports, hashlock: fromHex(p.paymentHashHex), timelockUnix: p.timelockUnix, claimed: false, refunded: false };
  assert.deepEqual(pruefeRueckSwapSperre(sperre, {
    lpSolAdresse: LP_SOL, amountLamports: rueckSwapLamports(10_000, angebot.lamportsPerSat!, angebot.feePpm),
    paymentHash: hashlock(pre), jetzt: JETZT + RUECK_PUFFER_SECS, lnCltvLimitBlocks: angebot.lnCltvDeltaBlocks,
  }), { ok: true });
});

test("Plan: in diesen Faellen wird gar nicht erst gesperrt", () => {
  const bolt11 = rechnung(WALLET, "lnbc100u", generatePreimage());
  const faelle: Array<[RegExp, LpOffer, string, number]> = [
    [/nicht SOL gegen sats/, { ...angebot, direction: "sell-sol" }, bolt11, 10_000],
    [/nicht SOL gegen sats/, { ...angebot, solAddress: undefined }, bolt11, 10_000],
    [/nicht SOL gegen sats/, { ...angebot, lamportsPerSat: undefined }, bolt11, 10_000],
    [/abgelaufen/, { ...angebot, expiry: JETZT }, bolt11, 10_000],
    [/1000–100000 sats/, angebot, rechnung(WALLET, "lnbc5u", generatePreimage()), 500],
    [/anderen Betrag/, angebot, bolt11, 20_000],
    [/anderen Betrag/, angebot, rechnung(WALLET, "lnbc", generatePreimage()), 10_000],
    [/Fristen des Angebots/, { ...angebot, lnCltvDeltaBlocks: 0 }, bolt11, 10_000],
    [/mehr als einer Woche/, { ...angebot, lnCltvDeltaBlocks: 600 }, bolt11, 10_000],
    [/.+/, angebot, "lnbc1kaputt", 10_000],
  ];
  for (const [grund, o, b, sats] of faelle) assert.throws(() => planeRueckSwap(o, b, sats, JETZT), grund);
  assert.ok(MAX_RUECK_FRIST_SECS >= 144 * 1200 + 3600 + RUECK_PUFFER_SECS, "das Standardangebot passt");
  assert.equal(istRueckAngebot(angebot), true);
});

test("Anfrage: nur Angebot und Rechnung – keine SOL-Adresse, kein Betrag daneben", () => {
  const bolt11 = rechnung(WALLET, "lnbc100u", generatePreimage());
  const ev = baueRueckAnfrage("aa".repeat(32), "bb".repeat(32), "lp-1-buy", bolt11, JETZT);
  assert.equal(ev.kind, 25001);
  assert.deepEqual(ev.tags, [["p", "bb".repeat(32)], ["offer", "lp-1-buy"], ["bolt11", bolt11]]);
  assert.equal(ev.pubkey, "aa".repeat(32));
});

test("Antwort: nur bekannte Stati; Text gekuerzt", () => {
  assert.deepEqual(leseRueckAntwort({ tags: [["status", "EINGELOEST"]], content: "" }), { status: "EINGELOEST", text: "" });
  assert.equal(leseRueckAntwort({ tags: [["status", "ALLES_GUT"]], content: "" }), undefined);
  assert.equal(leseRueckAntwort({ tags: [], content: "lnbc…" }), undefined, "Antworten der Hinrichtung (Rechnung im Inhalt) sind keine");
  assert.equal(leseRueckAntwort({ tags: [["status", "ABGELEHNT"]], content: "x".repeat(500) })!.text.length, 200);
});

test("Texte: ehrlich, wo das Geld ist", () => {
  const p = planeRueckSwap(angebot, rechnung(WALLET, "lnbc100u", generatePreimage()), 10_000, JETZT);
  assert.match(rueckText({ status: "EINGELOEST", text: "" }, p), /10000 sats sind in deiner Lightning-Wallet/);
  assert.match(rueckText({ status: "GESCHEITERT", text: "" }, p), /nicht getauscht.*zurück/);
  assert.match(rueckText({ status: "ABGELEHNT", text: "Frist der Sperre zu kurz" }, p), /abgelehnt: Frist der Sperre zu kurz.*zurück/);
  // ZU_SPAET: Der LP HAT gezahlt – nicht „nicht getauscht“ behaupten.
  const spaet = rueckText({ status: "ZU_SPAET", text: "" }, p);
  assert.match(spaet, /hat deine Rechnung bezahlt/);
  assert.doesNotMatch(spaet, /nicht getauscht/);
  assert.match(rueckText(undefined, p), /Warte auf den LP.*Zahlt er nicht/);
});

test("Verdrahtung (4.6c): Angebotsliste, Ablauf, Waechter, Deposit", () => {
  const w = readFileSync(new URL("../src/shell/tabs/waehrung.ts", import.meta.url), "utf8");
  assert.match(w, /rueck \? startRueckSwap\(ev\.pubkey, offer\) : startSwap\(ev\.pubkey, offer\.offerId, offer\.vorabSats\)/);
  assert.match(w, /\(Number\(offer\.feePpm\) \/ 10_000\)\.toFixed\(2\)/, "Gebuehr in Prozent, nicht ppm/100");
  const f = w.slice(w.indexOf("async function startRueckSwap("), w.indexOf("async function warteAufRueckAntwort("));
  // Reihenfolge: planen → merken → sperren → Wegwerf-Schluessel → Anfrage
  const reihenfolge = ["planeRueckSwap(offer, bolt11", "rememberLock({ kind: \"swap\"", "lockRueckSwap({", "new LocalSigner(generateKeypair().sk)", "baueRueckAnfrage(einmal.publicKey()", ".publish(anfrage)"];
  const stellen = reihenfolge.map((x) => f.indexOf(x));
  assert.ok(stellen.every((i) => i >= 0), `alle Schritte vorhanden: ${stellen}`);
  assert.deepEqual([...stellen].sort((a, b) => a - b), stellen, "in dieser Reihenfolge");
  assert.doesNotMatch(f, /signiere\(|state\.keypair/, "nie mit der eigenen Identitaet");
  assert.match(w, /statusEl\.textContent = "verbunden";\s*statusEl\.className = "mono-sm ok";\s*void starteRueckholWaechter\(\);/);
  assert.match(w, /kind: "deposit", reference: sessionId, swapIds: \[refundSwapId, spendSwapId\]/);
  assert.match(w, /m\.setzeSperrSpeicher\(geheim\)/, "gemerkte Sperren liegen im Tresor-Speicher");
  const t = readFileSync(new URL("../src/shell/tresor.ts", import.meta.url), "utf8");
  assert.match(t, /"freedom\.pending\."/, "und wandern beim Einrichten in den Tresor");
});
