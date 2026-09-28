/**
 * Fehler mit Kennung (Schritt 8.16i): Die App erkennt den Fall an `kennung`,
 * die deutsche Meldung bleibt für Knoten, Logs und Tests unverändert.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bech32 } from "@scure/base";
import { ProtokollFehler } from "../src/fehler.js";
import { leseBolt11 } from "../src/bolt11.js";
import { parseNwcUri, nwcKennung, explainNwcError } from "../src/nwc.js";
import { pruefeAnfrage, waehleRail, type PaymentRail, type Zahlanfrage } from "../src/payment-rail.js";
import { pruefeTageslimit } from "../src/ausgabe-limit.js";
import { rueckSwapLamports } from "../src/swap-umgekehrt.js";
import { RpcPool } from "../src/rpc-pool.js";

const wirft = async (fn: () => unknown): Promise<ProtokollFehler> => {
  try {
    await fn();
  } catch (e) {
    assert.ok(e instanceof ProtokollFehler, `ProtokollFehler statt ${String(e)}`);
    assert.ok(e instanceof Error);
    return e;
  }
  return assert.fail("wirft nicht");
};

test("8.16i: Eingaben – Kennung gesetzt, deutsche Meldung unverändert", async () => {
  // Gültiges bech32 mit fremdem Präfix: scheitert an der Prüfung des Protokolls, nicht an bech32
  const fremd = bech32.encode("lnxx", bech32.toWords(new Uint8Array(20)), 2000);
  const b11 = await wirft(() => leseBolt11(fremd));
  assert.deepEqual([b11.kennung, b11.message], ["bolt11-praefix", "kein bolt11-Präfix"]);
  const nwc = await wirft(() => parseNwcUri("http://x"));
  assert.deepEqual([nwc.kennung, nwc.message], ["nwc-praefix", "Keine NWC-Verbindung: erwartet wird nostr+walletconnect://…"]);
  assert.equal((await wirft(() => parseNwcUri(`nostr+walletconnect://${"a".repeat(64)}`))).kennung, "nwc-relay");
  assert.equal((await wirft(() => rueckSwapLamports(0, 1, 0))).kennung, "rueck-betrag");
  assert.equal((await wirft(() => pruefeTageslimit([], 0, 10, 0))).kennung, "betrag-positiv");
  const einheit = await wirft(() => pruefeAnfrage("lightning", { ziel: "a@b.example", betrag: { wert: 5, einheit: "lamports" }, zweck: "trinkgeld" }));
  assert.deepEqual([einheit.kennung, einheit.werte], ["schiene-einheit", { einheit: "lamports", schiene: "lightning", rechnet: "msat" }]);
});

test("8.16i: Netz und Wallet – offline, keine Wallet, kein RPC, Fehler des Wallets", async () => {
  const anfrage: Zahlanfrage = { ziel: "a@b.example", betrag: { wert: 5, einheit: "msat" }, zweck: "trinkgeld" };
  const schiene = (online: boolean, verfuegbar: boolean) => ({ id: "lightning", online: () => online, verfuegbar: async () => verfuegbar }) as unknown as PaymentRail;
  assert.equal((await wirft(() => waehleRail([schiene(false, true)], anfrage))).kennung, "offline-sats");
  assert.equal((await wirft(() => waehleRail([schiene(true, false)], anfrage))).kennung, "wallet-fehlt-sats");
  assert.equal((await wirft(() => waehleRail([], anfrage))).kennung, "schiene-fehlt");
  const tot = new RpcPool([{ url: "https://a.test", label: "a" }], { fetchImpl: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch });
  const rpc = await wirft(() => tot.getSlot());
  assert.deepEqual([rpc.kennung, rpc.werte, rpc.message], ["rpc-unerreichbar", { n: 1, details: "a: ECONNREFUSED" }, "Kein Solana-Endpunkt erreichbar (1 versucht). a: ECONNREFUSED"]);
  assert.deepEqual(["INSUFFICIENT_BALANCE", "RATE_LIMITED", "ANDERS"].map(nwcKennung), ["nwc-guthaben", "nwc-zu-viele", "nwc-fehler"]);
  assert.equal(explainNwcError({ code: "ANDERS", message: "" }), "Wallet-Fehler: ANDERS");
});
