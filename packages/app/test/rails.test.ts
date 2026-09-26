/**
 * Schritt 4.1a: die Zahlschienen der App mit Attrappen statt Wallets –
 * Lightning (NWC, WebLN, Lightning-Adresse) und Solana (verbundene Wallet).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { bech32 } from "@scure/base";
import { zahle } from "@freedomstack/protocol";
import { LightningRail, SolanaRail, bolt11BetragMsat, bolt11ZahlungsHash } from "../src/rails.js";

// Testvektor aus BOLT 11 – oeffentlich, kein Geheimnis.
const BOLT11 = "lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp";
const SOL_ZIEL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb";
const SOL_ICH = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const SIGNATUR = "5".repeat(88);

/** Eine bolt11-Rechnung mit bekanntem Payment-Hash (Signatur egal – geprueft wird nur der Hash). */
function rechnung(preimage: Buffer, hrp: string): string {
  const hash = createHash("sha256").update(preimage).digest();
  const zeit = [0, 0, 0, 0, 0, 0, 1];
  const p = bech32.toWords(hash);
  const words = [...zeit, 1, Math.floor(p.length / 32), p.length % 32, ...p, ...new Array(104).fill(0)];
  return bech32.encode(hrp, words, false);
}

test("bolt11: Betrag und Payment-Hash aus dem Testvektor", () => {
  assert.equal(bolt11BetragMsat(BOLT11), 250_000_000);
  assert.equal(bolt11ZahlungsHash(BOLT11), "0001020304050607080900010203040506070809000102030405060708090102");
  assert.equal(bolt11BetragMsat("lnbc10n1xyz"), 1_000);
  assert.equal(bolt11BetragMsat("lnbc1xyz"), null, "ohne Betrag");
  assert.equal(bolt11ZahlungsHash("lnbc1kaputt"), null);
});

test("Lightning ueber NWC: zahlt genau die Rechnung, Beleg prueft sich am Hash", async () => {
  const preimage = Buffer.alloc(32, 7);
  const pr = rechnung(preimage, "lnbc210n"); // 21 sats
  const bezahlt: string[] = [];
  const rail = new LightningRail({
    nwc: () => ({ payInvoice: async (b) => { bezahlt.push(b); return { preimage: preimage.toString("hex") }; }, getBalance: async () => 42_000 }),
    jetzt: () => 1_790_000_000,
  });
  assert.equal(await rail.verfuegbar(), true);
  const beleg = await zahle([rail], { ziel: pr, betrag: { einheit: "msat", wert: 21_000 }, zweck: "zap" });
  assert.deepEqual(bezahlt, [pr]);
  assert.equal(beleg.rechnung, pr);
  assert.equal(await rail.verify(beleg), true);
  assert.equal(await rail.verify({ ...beleg, ref: "00".repeat(32) }), false, "falsches Preimage");
  assert.deepEqual(await rail.balance(), { einheit: "msat", wert: 42_000 });
  // Rechnung ueber einen anderen Betrag: nicht zahlen
  await assert.rejects(rail.pay({ ziel: pr, betrag: { einheit: "msat", wert: 20_000 }, zweck: "zap" }), /nicht gezahlt/);
  assert.equal(bezahlt.length, 1);
});

test("Lightning ohne NWC: WebLN; ohne beides: nicht verfuegbar", async () => {
  const preimage = Buffer.alloc(32, 9);
  const pr = rechnung(preimage, "lnbc10n");
  let aktiviert = false;
  const rail = new LightningRail({ webln: () => ({ enable: async () => { aktiviert = true; }, sendPayment: async () => ({ preimage: preimage.toString("hex") }) }) });
  const b = await rail.pay({ ziel: pr, betrag: { einheit: "msat", wert: 1_000 }, zweck: "trinkgeld" });
  assert.ok(aktiviert);
  assert.equal(await rail.verify(b), true);
  const leer = new LightningRail({});
  assert.equal(await leer.verfuegbar(), false);
  await assert.rejects(leer.pay({ ziel: pr, betrag: { einheit: "msat", wert: 1_000 }, zweck: "zap" }), /Keine Lightning-Wallet/);
});

test("Lightning-Adresse: LNURL holt die Rechnung – falscher Betrag, Grenzen und http fallen auf", async () => {
  const preimage = Buffer.alloc(32, 3);
  let antwortBetrag = "lnbc210n";
  let callback = "https://pay.example/cb";
  const aufrufe: string[] = [];
  const holen = (async (url: string) => {
    aufrufe.push(url);
    if (url.includes(".well-known")) {
      return new Response(JSON.stringify({ tag: "payRequest", callback, minSendable: 1_000, maxSendable: 1_000_000, commentAllowed: 20 }));
    }
    return new Response(JSON.stringify({ pr: rechnung(preimage, antwortBetrag) }));
  }) as typeof fetch;
  const nwc = { payInvoice: async () => ({ preimage: preimage.toString("hex") }), getBalance: async () => 0 };
  const rail = new LightningRail({ nwc: () => nwc, holen });
  const b = await rail.pay({ ziel: "alice@pay.example", betrag: { einheit: "msat", wert: 21_000 }, zweck: "zap", notiz: "Danke für den Beitrag!" });
  assert.equal(aufrufe[0], "https://pay.example/.well-known/lnurlp/alice");
  assert.match(aufrufe[1], /amount=21000/);
  assert.match(aufrufe[1], /comment=Danke/);
  assert.equal(await rail.verify(b), true, "geprueft an der geholten Rechnung");
  antwortBetrag = "lnbc2100n"; // Server schickt eine teurere Rechnung
  await assert.rejects(rail.pay({ ziel: "alice@pay.example", betrag: { einheit: "msat", wert: 21_000 }, zweck: "zap" }), /nicht gezahlt/);
  await assert.rejects(rail.pay({ ziel: "alice@pay.example", betrag: { einheit: "msat", wert: 5_000_000 }, zweck: "zap" }), /außerhalb/);
  callback = "http://pay.example/cb";
  await assert.rejects(rail.pay({ ziel: "alice@pay.example", betrag: { einheit: "msat", wert: 21_000 }, zweck: "zap" }), /keine gültige Zahlungsanfrage/);
});

test("Solana: verbundene Wallet signiert die gebaute Ueberweisung; Pruefung nur mit RPC", async () => {
  const gebaut: Array<[string, string, number]> = [];
  const wallet = { adresse: SOL_ICH, signiereUndSende: async () => SIGNATUR };
  const rail = new SolanaRail({
    wallet: () => wallet,
    baueUeberweisung: async (von, an, lamports) => { gebaut.push([von, an, lamports]); return { tx: true }; },
    pruefeUeberweisung: async (sig, an, lamports) => sig === SIGNATUR && an === SOL_ZIEL && lamports === 5_000,
    guthaben: async () => 1e9,
  });
  assert.equal(await rail.verfuegbar(), true);
  assert.deepEqual((await rail.quote({ ziel: SOL_ZIEL, betrag: { einheit: "lamports", wert: 5_000 }, zweck: "trinkgeld" })).gebuehr, { einheit: "lamports", wert: 5000 });
  const b = await zahle([rail], { ziel: SOL_ZIEL, betrag: { einheit: "lamports", wert: 5_000 }, zweck: "trinkgeld" });
  assert.deepEqual(gebaut, [[SOL_ICH, SOL_ZIEL, 5_000]]);
  assert.equal(b.ref, SIGNATUR);
  assert.equal(await rail.verify(b), true);
  assert.equal(await rail.verify({ ...b, betrag: { einheit: "lamports", wert: 6_000 } }), false);
  assert.deepEqual(await rail.balance(), { einheit: "lamports", wert: 1e9 });
  // Ohne RPC-Pruefung: nicht pruefbar, also nicht bestaetigt
  const ohne = new SolanaRail({ wallet: () => wallet, baueUeberweisung: async () => ({}) });
  assert.equal(await ohne.verify(b), false);
  // An sich selbst, kaputte Signatur, keine Wallet
  await assert.rejects(rail.pay({ ziel: SOL_ICH, betrag: { einheit: "lamports", wert: 5_000 }, zweck: "trinkgeld" }), /sich selbst/);
  const kaputt = new SolanaRail({ wallet: () => ({ ...wallet, signiereUndSende: async () => "x" }), baueUeberweisung: async () => ({}) });
  await assert.rejects(kaputt.pay({ ziel: SOL_ZIEL, betrag: { einheit: "lamports", wert: 5_000 }, zweck: "trinkgeld" }), /keine gültige Signatur/);
  const leer = new SolanaRail({ wallet: () => undefined, baueUeberweisung: async () => ({}) });
  assert.equal(await leer.verfuegbar(), false);
});

test("Offline (7.3): beide Schienen fragen das Netz, zahle() sagt es klar", async () => {
  const ln = new LightningRail({ nwc: () => ({ payInvoice: async () => ({ preimage: "00" }), getBalance: async () => 0 }), online: () => false });
  const sol = new SolanaRail({ wallet: () => ({ adresse: SOL_ICH, signiereUndSende: async () => SIGNATUR }), baueUeberweisung: async () => ({}), online: () => false });
  assert.equal(ln.online(), false);
  assert.equal(sol.online(), false);
  await assert.rejects(zahle([ln, sol], { ziel: BOLT11, betrag: { einheit: "msat", wert: 250_000_000 }, zweck: "zap" }), /Offline: Sats/);
  await assert.rejects(zahle([ln, sol], { ziel: SOL_ZIEL, betrag: { einheit: "lamports", wert: 5000 }, zweck: "trinkgeld" }), /Offline: SOL/);
  // Ohne Angabe gilt: Netz da.
  assert.equal(new LightningRail({}).online(), true);
});
