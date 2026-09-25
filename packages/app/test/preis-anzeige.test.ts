/**
 * Schritt 4.4b: jede Preisanzeige in beiden Einheiten, Kurszeile mit
 * Warnungen, Deposit-Deckel aus Anbieterpreis und Marktkurs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { anbieterKursWarnung, ausLamports, ausMsat, depositDeckel, kursZeile, satsText, solText } from "../src/preis-anzeige.js";

const KURS = { satsProSol: 150_000, quellen: 3, streuung: 0.01, warnungen: [] as string[] };

test("Beide Einheiten: aus msat und aus Lamports; ohne Kurs ehrlich", () => {
  assert.equal(ausMsat(21_000, KURS), "21 sats ≈ 0,00014 SOL");
  assert.equal(ausMsat(1_500_000, KURS), "1.500 sats ≈ 0,01 SOL");
  assert.equal(ausLamports(2_000_000, KURS), "0,002 SOL ≈ 300 sats");
  assert.equal(ausMsat(21_000), "21 sats (SOL: kein Kurs)");
  assert.equal(ausLamports(1_000_000_000), "1 SOL (sats: kein Kurs)");
  assert.equal(satsText(1_500), "1,5 sats", "Bruchteile unter 10 sats");
  assert.equal(solText(5_000), "0,000005 SOL");
  assert.equal(ausMsat(-5, KURS), "0 sats ≈ 0 SOL", "negativ wird 0");
});

test("Kurszeile: Quellen und Warnungen sichtbar, ohne Kurs Warnung", () => {
  assert.deepEqual(kursZeile(KURS), { text: "Kurs: 1 SOL ≈ 150.000 sats (Median aus 3 Quellen)", warnung: false });
  const wenig = kursZeile({ satsProSol: 160_000, quellen: 1, streuung: 0, warnungen: ["Kurs aus nur 1 Quelle"] });
  assert.equal(wenig.warnung, true);
  assert.match(wenig.text, /1 Quelle\) ⚠ Kurs aus nur 1 Quelle/);
  assert.equal(kursZeile(undefined).warnung, true);
  assert.match(kursZeile(undefined).text, /SOL-Preise nicht verfügbar/);
});

test("Deposit-Deckel: Anbieterpreis in Lamports plus 10 %; Anbieterkurs neben dem Markt warnt", () => {
  // 1000 msat/1k bei 150.000 sats/SOL = 6.667 Lamports/1k, plus 10 % = 7.334
  assert.equal(depositDeckel(1000, KURS), 7_334);
  assert.throws(() => depositDeckel(0, KURS), /keinen Preis/);
  assert.equal(anbieterKursWarnung({ satsProSol: 155_000 }, KURS), undefined, "3 %: keine Warnung");
  assert.match(anbieterKursWarnung({ satsProSol: 5_000_000 }, KURS)!, /5\.000\.000 sats, der Markt mit 150\.000 sats \(3233 % Abweichung\)/);
  assert.equal(anbieterKursWarnung(undefined, KURS), undefined);
});

test("Verdrahtung: kein fester SOL-Kurs mehr, Kurs in Modellwahl, Schaetzung, Zap, Wallet-Tab und Deposit", () => {
  const lies = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const agent = lies("../src/shell/tabs/agent.ts");
  assert.ok(!agent.includes("FREEDOM_SOL_PRICE_SATS") && !agent.includes("150_000"), "fester Kurs entfernt");
  assert.match(agent, /const preis = ausMsat\(info\.priceMsat, aktuellerKurs\(\)\);/);
  assert.match(agent, /tokens ≈ \$\{ausMsat\(estSats \* 1000, aktuellerKurs\(\)\)\}/);
  const zap = lies("../src/chat-zap.ts");
  assert.match(zap, /id="zap-umrechnung"/);
  assert.match(zap, /einheit === "sol" \? ausLamports\(wert \* 1e9, aktuellerKurs\(\)\) : ausMsat\(wert \* 1000, aktuellerKurs\(\)\)/);
  const tab = lies("../src/shell/tabs/waehrung.ts");
  assert.match(tab, /const maxLamportsPerKToken = depositDeckel\(angebot\.textRatePerKTokenMsat, markt\);/);
  assert.match(tab, /maxLamportsPerKToken,\n\s+\}\)\);/);
  assert.ok(!tab.includes("maxLamportsPerKToken: 1000"), "fester Deckel entfernt");
  assert.match(tab, /zeigeKurs\(\);/);
  assert.match(lies("../src/shell/index.html"), /<div id="kurs-info" class="mono-sm"><\/div>/);
});
