/**
 * Schritt 4.4b: jede Preisanzeige in beiden Einheiten, Kurszeile mit
 * Warnungen, Deposit-Deckel aus Anbieterpreis und Marktkurs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { anbieterKursWarnung, ausLamports, ausMsat, depositDeckel, einnahmeText, kursZeile, satsText, solText } from "../src/preis-anzeige.js";
import { setLang } from "../src/i18n.js";

// Meldungen hier auf Deutsch prüfen (seit 8.16e über Schlüssel in der Sprache der Oberfläche)
setLang("de");

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
  assert.match(agent, /t\("agent\.schaetzung", \{ tokens: estTokens, preis: ausMsat\(estSats \* 1000, aktuellerKurs\(\)\) \}\)/);
  const zap = lies("../src/chat-zap.ts");
  assert.match(zap, /id="zap-umrechnung"/);
  assert.match(zap, /einheit === "sol" \? ausLamports\(wert \* 1e9, aktuellerKurs\(\)\) : ausMsat\(wert \* 1000, aktuellerKurs\(\)\)/);
  const tab = lies("../src/shell/tabs/hinterlegen.ts");
  assert.match(tab, /const maxLamportsPerKToken = depositDeckel\(angebot\.textRatePerKTokenMsat, markt\);/);
  assert.match(tab, /maxLamportsPerKToken,\n\s+\}\)\);/);
  assert.ok(!tab.includes("maxLamportsPerKToken: 1000"), "fester Deckel entfernt");
  assert.match(lies("../src/shell/tabs/waehrung.ts"), /zeigeKurs\(\);/);
  assert.match(lies("../src/shell/index.html"), /<div id="kurs-info" class="mono-sm"><\/div>/);
});

test("C-2: Einnahmen in der Einheit ihrer Kette – SOL nur mit Kurs, sonst ehrlich ohne", () => {
  setLang("de");
  assert.equal(einnahmeText("21000", "lightning", KURS), "21 sats");
  assert.equal(einnahmeText("21000", undefined, KURS), "21 sats", "ohne Kette wie bisher sats");
  assert.equal(einnahmeText("1500000", "solana", KURS), "≈ 0,01 SOL (Wert 1.500 sats)");
  assert.equal(einnahmeText("1500000", "solana"), "SOL, Wert 1.500 sats (kein Kurs)", "ohne Kurs keinen SOL-Betrag erfinden");
  assert.equal(einnahmeText("0", "solana", KURS), "≈ 0 SOL (Wert 0 sats)", "Gratis-Aufträge tragen 0");
  // Fremddaten aus dem Event: nur ganze, nicht negative msat – sonst ein Strich statt „NaN sats“
  for (const v of ["—", "", "-5", "1e3", "1.5", "0x10", " 5", undefined, 5, "9".repeat(19)]) assert.equal(einnahmeText(v, "lightning", KURS), "—", String(v));
  setLang("en");
  assert.equal(einnahmeText("1500000", "solana", KURS), "≈ 0.01 SOL (worth 1,500 sats)");
  assert.equal(einnahmeText("1500000", "solana"), "SOL, worth 1,500 sats (no rate)");
  setLang("de");
  // Verdrahtet: der Earn-Tab zeigt jede Einnahme über einnahmeText(); den Kurs holt er nur, wenn es SOL-Einnahmen gibt
  const earn = readFileSync(new URL("../src/shell/tabs/earn.ts", import.meta.url), "utf8");
  // seit C-6 als Text im DOM, nicht mehr über innerHTML
  assert.match(earn, /el\("span", `\$\{einnahmeText\(get\("volume_msat"\), kette\(ev\), kurs\)\} · \$\{timeAgo\(ev\.created_at\)\}`\)/);
  assert.match(earn, /const kurs = sorted\.some\(\(ev\) => kette\(ev\) === "solana"\) \? \(aktuellerKurs\(\) \?\? await aktualisiereKurs\(\)\.catch\(\(\) => undefined\)\) : undefined;/);
  assert.doesNotMatch(earn, /\/ 1000\)\} sats/, "nicht mehr fest „sats“");
});
