/**
 * Schritt 4.6d: Vorab-Gebuehr der Hinrichtung. Die App zahlt sie nur, wenn
 * das Angebot sie angekuendigt hat, genau in dieser Hoehe, mit gueltiger
 * Rechnung – und nur, wenn die Antwort vom LP selbst stammt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generatePreimage } from "@freedomstack/protocol";
import { MAX_VORAB_SATS, pruefeVorab } from "../src/swap-client.js";
import { knotenSchluessel, rechnung } from "../../protocol/test/bolt11-hilfe.js";

const LP_KNOTEN = knotenSchluessel();
const antwort = (sats: string, bolt11: string) => ({ tags: [["status", "VORAB"], ["vorab_sats", sats]], content: bolt11 });

test("Vorab-Gebuehr: angekuendigt, gleiche Hoehe, gueltige Rechnung → zahlbar", () => {
  const b = rechnung(LP_KNOTEN, "lnbc100n", generatePreimage()); // 10 sats
  assert.deepEqual(pruefeVorab(antwort("10", b), 10), { ok: true, sats: 10, bolt11: b });
});

test("Vorab-Gebuehr: in diesen Faellen zahlt die App nicht", () => {
  const b10 = rechnung(LP_KNOTEN, "lnbc100n", generatePreimage());
  const faelle: Array<[RegExp, ReturnType<typeof antwort>, number | undefined]> = [
    [/nannte keine Vorab-Gebühr/, antwort("10", b10), undefined],
    [/Verlangt sind 20 sats, angekündigt waren 10/, antwort("20", rechnung(LP_KNOTEN, "lnbc200n", generatePreimage())), 10],
    [/anderen Betrag/, antwort("10", rechnung(LP_KNOTEN, "lnbc1u", generatePreimage())), 10],
    [/anderen Betrag/, antwort("10", rechnung(LP_KNOTEN, "lnbc", generatePreimage())), 10],
    [/ungültig/, antwort("10", "lnbc1kaputt"), 10],
    [/über 1000 sats/, antwort("5000", rechnung(LP_KNOTEN, "lnbc50u", generatePreimage())), 5000],
  ];
  for (const [grund, a, angekuendigt] of faelle) {
    const r = pruefeVorab(a, angekuendigt);
    assert.equal(r.ok, false, String(grund));
    assert.match((r as { grund: string }).grund, grund);
  }
  assert.equal(MAX_VORAB_SATS, 1000);
});

test("Verdrahtung (4.6d): nur Antworten des LP, Vorab erst pruefen, dann ueber die Zahlschiene zahlen", () => {
  const w = readFileSync(new URL("../src/shell/tabs/waehrung.ts", import.meta.url), "utf8");
  // Seit 4.9b nur versiegelte Antworten des LP zur eigenen Anfrage (swapAntworten → oeffneSwapAntwort).
  assert.match(w, /const alle = await swapAntworten\(pool, post\);/);
  assert.match(w, /void pollSwapResponse\(post, toHex\(H\), solAddr, amount, vorabSats\)/);
  const f = w.slice(w.indexOf("async function zahleVorab("), w.indexOf("/** Laufender Swap"));
  const [pruefen, fragen, zahlen] = ["pruefeVorab(antwort, angekuendigt)", "confirm(", "await zahle(zahlschienen()"].map((x) => f.indexOf(x));
  assert.ok(pruefen > 0 && pruefen < fragen && fragen < zahlen, "pruefen → fragen → zahlen");
  assert.match(f, /zweck: "swap"/);
});
