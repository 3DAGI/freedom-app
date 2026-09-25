/**
 * Schritt 4.1b: Zap und SOL-Trinkgeld ueber die Zahlschienen – die Rechnung
 * kommt per LNURL mit signiertem Zap-Request, gezahlt wird ueber die Schiene,
 * die den Betrag der Rechnung prueft.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { bech32 } from "@scure/base";
import { zahle } from "@freedomstack/protocol";
import { LightningRail } from "../src/rails.js";
import { holeZapRechnung, solAdresseAusProfil } from "../src/zap-zahlung.js";

const ZAP_REQUEST = { kind: 9734, pubkey: "a".repeat(64), sig: "b".repeat(128), tags: [["amount", "21000"]] };

function rechnung(hrp: string): { pr: string; preimage: string } {
  const preimage = Buffer.alloc(32, 5);
  const p = bech32.toWords(createHash("sha256").update(preimage).digest());
  const words = [0, 0, 0, 0, 0, 0, 1, 1, Math.floor(p.length / 32), p.length % 32, ...p, ...new Array(104).fill(0)];
  return { pr: bech32.encode(hrp, words, false), preimage: preimage.toString("hex") };
}

function lnurl(opts: { allowsNostr?: boolean; callback?: string; hrp?: string } = {}) {
  const aufrufe: string[] = [];
  const r = rechnung(opts.hrp ?? "lnbc210n");
  const holen = (async (url: string) => {
    aufrufe.push(url);
    if (url.includes(".well-known")) {
      return new Response(JSON.stringify({ tag: "payRequest", callback: opts.callback ?? "https://zap.example/cb", allowsNostr: opts.allowsNostr ?? true, minSendable: 1000, maxSendable: 1e9 }));
    }
    return new Response(JSON.stringify({ pr: r.pr }));
  }) as typeof fetch;
  return { holen, aufrufe, ...r };
}

test("Zap: Rechnung per LNURL mit Zap-Request, bezahlt ueber die Schiene", async () => {
  const l = lnurl();
  const pr = await holeZapRechnung({ lud16: "bob@zap.example", betragMsat: 21_000, zapRequest: ZAP_REQUEST, holen: l.holen });
  assert.equal(pr, l.pr);
  assert.equal(l.aufrufe[0], "https://zap.example/.well-known/lnurlp/bob");
  const cb = new URL(l.aufrufe[1]);
  assert.equal(cb.searchParams.get("amount"), "21000");
  assert.deepEqual(JSON.parse(cb.searchParams.get("nostr")!), ZAP_REQUEST, "signierter Zap-Request geht mit");
  const bezahlt: string[] = [];
  const rail = new LightningRail({ nwc: () => ({ payInvoice: async (b) => { bezahlt.push(b); return { preimage: l.preimage }; }, getBalance: async () => 0 }) });
  const beleg = await zahle([rail], { ziel: pr, betrag: { einheit: "msat", wert: 21_000 }, zweck: "zap" });
  assert.deepEqual(bezahlt, [pr]);
  assert.equal(await rail.verify(beleg), true);
});

test("Zap: Empfaenger ohne Zaps, http-Callback, kaputte Adresse, teurere Rechnung", async () => {
  await assert.rejects(holeZapRechnung({ lud16: "bob@zap.example", betragMsat: 21_000, zapRequest: ZAP_REQUEST, holen: lnurl({ allowsNostr: false }).holen }), /keine Zaps/);
  await assert.rejects(holeZapRechnung({ lud16: "bob@zap.example", betragMsat: 21_000, zapRequest: ZAP_REQUEST, holen: lnurl({ callback: "http://zap.example/cb" }).holen }), /Callback/);
  await assert.rejects(holeZapRechnung({ lud16: "keine-adresse", betragMsat: 21_000, zapRequest: ZAP_REQUEST, holen: lnurl().holen }), /Lightning-Adresse/);
  const teuer = lnurl({ hrp: "lnbc2100n" });
  const pr = await holeZapRechnung({ lud16: "bob@zap.example", betragMsat: 21_000, zapRequest: ZAP_REQUEST, holen: teuer.holen });
  const rail = new LightningRail({ nwc: () => ({ payInvoice: async () => { throw new Error("darf nicht zahlen"); }, getBalance: async () => 0 }) });
  await assert.rejects(zahle([rail], { ziel: pr, betrag: { einheit: "msat", wert: 21_000 }, zweck: "zap" }), /nicht gezahlt/);
});

test("SOL-Adresse aus dem Profil: nur eine gueltige Adresse", () => {
  const sol = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb";
  assert.equal(solAdresseAusProfil(JSON.stringify({ sol })), sol);
  assert.equal(solAdresseAusProfil(JSON.stringify({ sol: "javascript:alert(1)" })), "");
  assert.equal(solAdresseAusProfil("kein json"), "");
  assert.equal(solAdresseAusProfil(JSON.stringify({ sol: 7 })), "");
});

test("Verdrahtung: Zap zahlt nur ueber die Schienen; alte Wallet-Wege sind weg", () => {
  const zap = readFileSync(new URL("../src/chat-zap.ts", import.meta.url), "utf8");
  assert.match(zap, /await zahle\(zahlschienen\(\), \{ ziel: rechnung, betrag: \{ einheit: "msat", wert: betragMsat \}, zweck: "zap" \}\)/);
  assert.match(zap, /const beleg = await zahle\(zahlschienen\(\), \{\s*ziel, betrag: \{ einheit: "lamports"/);
  assert.match(zap, /const zapRequest = await signiere\(buildZapRequest\(/, "Zap-Request signiert");
  assert.doesNotMatch(zap, /detectWallet|sendPayment|signAndSendTransaction|buildSolTransfer|buildZapReceipt|window as unknown as \{ ensurePool/);
  assert.equal(existsSync(new URL("../src/lightning-wallet.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../src/offline-queue.ts", import.meta.url)), false);
  const w = readFileSync(new URL("../src/shell/tabs/waehrung.ts", import.meta.url), "utf8");
  assert.doesNotMatch(w, /payInvoiceAnyDevice|function addZapButton|\.sendPayment\(/);
  const app = readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8");
  assert.match(app, /localStorage\.removeItem\("freedom\.offlineZaps"\);/);
});
