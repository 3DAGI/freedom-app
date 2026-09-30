/**
 * Sammlung A-5: Zahlung im Chat anfordern. Die Anforderung ist eine gewöhnliche
 * (versiegelte) Direktnachricht mit `lightning:`- bzw. `solana:`-Adresse; die
 * App des Empfängers erkennt nur Zahlbares (Betrag, lesbare Rechnung, gültige
 * Adresse, natives SOL) und zahlt nur nach Bestätigung über die Zahlschienen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baueAnforderung, lamportsZuSol, leseAnforderung, solZuLamports } from "../src/zahlungs-anforderung.js";
import { LS_ADRESSE_JE_KONTAKT, eigeneAdresseFuer } from "../src/trinkgeld-adresse.js";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
/** Rechnung aus BOLT11 (Beispiel mit Betrag: 2500 µBTC = 250 000 sats). */
const BOLT11 = "lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp";
/** Dieselbe Spezifikation, Rechnung ohne Betrag. */
const OHNE_BETRAG = "lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w";
const ADR = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

test("SOL ↔ Lamports ohne Gleitkomma", () => {
  assert.equal(solZuLamports("0.01"), 10_000_000);
  assert.equal(solZuLamports("1"), 1_000_000_000);
  assert.equal(solZuLamports("0.000000001"), 1);
  assert.equal(solZuLamports("9007199.254740991"), Number.MAX_SAFE_INTEGER);
  assert.equal(solZuLamports("123456789.123456789"), undefined, "mehr, als sich genau zählen lässt");
  for (const falsch of ["", "0", "0.0", "-1", "1e3", "0.0000000001", "1,5", "abc", "1.", ".5"]) assert.equal(solZuLamports(falsch), undefined, falsch);
  assert.equal(lamportsZuSol(10_000_000), "0.01");
  assert.equal(lamportsZuSol(1_000_000_000), "1");
  assert.equal(lamportsZuSol(1), "0.000000001");
  assert.equal(lamportsZuSol(1_500_000_000), "1.5");
});

test("Anforderung bauen und wieder lesen – Lightning, Solana, beides, mit Notiz", () => {
  const ln = baueAnforderung({ rechnung: BOLT11, notiz: " Pizza " });
  assert.equal(ln, `Pizza\nlightning:${BOLT11}`);
  assert.deepEqual(leseAnforderung(ln), { lightning: { rechnung: BOLT11, msat: 250_000_000 } });
  const sol = baueAnforderung({ solana: { adresse: ADR, lamports: 12_345_000 } });
  assert.equal(sol, `solana:${ADR}?amount=0.012345`);
  assert.deepEqual(leseAnforderung(sol), { solana: { adresse: ADR, lamports: 12_345_000 } });
  const beides = leseAnforderung(baueAnforderung({ rechnung: BOLT11, solana: { adresse: ADR, lamports: 1 } }));
  assert.equal(beides?.lightning?.msat, 250_000_000);
  assert.equal(beides?.solana?.lamports, 1);
  // Auch von anderen Apps: nackte Rechnung, Großschreibung, weitere Solana-Pay-Felder
  assert.equal(leseAnforderung(`bitte hier: ${BOLT11.toUpperCase()}`)?.lightning?.rechnung, BOLT11);
  assert.equal(leseAnforderung(`solana:${ADR}?amount=2&label=Laden&message=Danke`)?.solana?.lamports, 2_000_000_000);
});

test("Nur Zahlbares: ohne Betrag, fremde Token, kaputte Adresse oder Rechnung → keine Anforderung", () => {
  for (const text of [
    "",
    "hallo, wie geht's?",
    `lightning:${OHNE_BETRAG}`,
    `lightning:${BOLT11.slice(0, -1)}x`,
    `solana:${ADR}`,
    `solana:${ADR}?amount=0`,
    `solana:${ADR}?amount=-1`,
    `solana:${ADR}?amount=1&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`,
    "solana:0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl?amount=1",
    `wwwlnbc2500u1pvjluez`,
  ]) {
    assert.equal(leseAnforderung(text), null, text.slice(0, 60));
  }
});

test("Eigene Adresse je Kontakt: beim ersten Mal frisch, danach dieselbe; ohne Wallet keine", async () => {
  const m = new Map<string, string>();
  const s = { getItem: (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v), removeItem: async (k: string) => void m.delete(k) };
  let n = 0;
  const frisch = async () => `Adresse${++n}`;
  assert.equal(await eigeneAdresseFuer(s, "a".repeat(64), "mainnet", frisch), "Adresse1");
  assert.equal(await eigeneAdresseFuer(s, "a".repeat(64), "mainnet", frisch), "Adresse1", "stabil – kein Fremder leert den Vorrat");
  assert.equal(await eigeneAdresseFuer(s, "b".repeat(64), "mainnet", frisch), "Adresse2", "je Kontakt eine eigene");
  assert.equal(await eigeneAdresseFuer(s, "a".repeat(64), "devnet", frisch), "Adresse3", "je Kette");
  assert.ok(m.has(LS_ADRESSE_JE_KONTAKT));
  assert.equal(await eigeneAdresseFuer(s, "c".repeat(64), "mainnet", async () => undefined), undefined);
});

test("Verdrahtet: Anfordern aus dem Zap-Dialog, Bezahlen nur an fremden Direktnachrichten, erst bestätigen, nur über die Schienen", () => {
  const zap = src("../src/chat-zap.ts");
  assert.match(zap, /id="zap-anfordern"/);
  assert.match(zap, /fordereAn\(recipientPubkey, recipientName,/);
  const komm = src("../src/shell/tabs/kommunikation.ts");
  assert.match(komm, /const anf = !mine && c\.type === "dm" \? leseAnforderung\(text\) : null;/);
  assert.match(komm, /bezahleAnforderung\(z\.anf, z\.von, pkShort\(z\.von\)\)/);
  const ui = src("../src/shell/anforderung-ui.ts");
  assert.ok(ui.indexOf("await bestaetige(") < ui.indexOf("await zahle("), "erst bestätigen, dann zahlen");
  assert.equal((ui.match(/zweck: "anforderung"/g) ?? []).length, 2);
  assert.match(ui, /zahle\(zahlschienen\(\),/);
  assert.match(ui, /eigeneRechnung\(Number\(betrag\) \* 1000\)/, "sats: Rechnung der eigenen Wallet");
  assert.match(ui, /eigeneAdresseFuer\(geheim, kontakt,/, "SOL: eigene Adresse je Kontakt");
  assert.match(ui, /sendeTrinkgeldBeleg\(await ensurePool\(\), state\.signer!, \{[\s\S]*?\}, false\);/, "Beleg versiegelt, nie offen");
  assert.doesNotMatch(ui, /publish\(|veroeffentliche|innerHTML/, "die Anforderung selbst geht nur über das Eingabefeld hinaus");
});
