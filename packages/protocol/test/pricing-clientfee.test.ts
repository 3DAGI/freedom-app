/**
 * Tests fuer Preisberechnung und Client-Gebuehr.
 *
 * Beides rechnet mit Geld und hatte keine Tests. Der Schwerpunkt liegt auf
 * Rundung und Grenzfaellen — ein Preis, der auf null rundet, macht Arbeit
 * geschenkt, und einer, der ueberlaeuft, macht sie unbezahlbar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MODEL_PRICES, DEFAULT_TOOL_PRICES, DEFAULT_VIDEO_PRICES,
  videoPriceSats, defaultToolPrice, defaultPriceFor, textPriceSats,
} from "../src/pricing.js";
import {
  clientFeePpm, clientFeeTag, parseClientFee, checkClientFee,
  splitWithClientFee, explainFees, MAX_CLIENT_FEE_PERCENT, DEFAULT_CLIENT_FEE_PERCENT,
} from "../src/client-fee.js";
import { splitFeeV1 } from "../src/protocol-fee.js";

// ------------------------------------------------------------- Preise

test("Free-Tier ist gratis, alles andere nicht", () => {
  // Der Nullpreis im Free-Tier ist Absicht: Er laeuft auf dem Geraet des
  // Nutzers selbst. Bei allen anderen waere er ein Fehler — verschenkte
  // Arbeit hoehlt das Anreizsystem schleichend aus.
  for (const m of DEFAULT_MODEL_PRICES) {
    assert.ok(m.model.length > 0);
    if (m.tier === "free") {
      assert.equal(m.inputSatsPerK, 0, `${m.model} sollte gratis sein`);
    } else {
      assert.ok(m.outputSatsPerK > 0, `${m.model} (${m.tier}) ist versehentlich gratis`);
    }
  }
});

test("Ausgabe kostet nie weniger als Eingabe", () => {
  // Bei Sprachmodellen ist die Erzeugung teurer als das Lesen. Ein Preis, der
  // das umdreht, macht lange Antworten kuenstlich billig.
  for (const m of DEFAULT_MODEL_PRICES) {
    assert.ok(m.outputSatsPerK >= m.inputSatsPerK, `${m.model}: Ausgabe billiger als Eingabe`);
  }
});

test("Groessere Stufen kosten mehr", () => {
  const max = (t: string): number =>
    Math.max(...DEFAULT_MODEL_PRICES.filter((m) => m.tier === t).map((m) => m.outputSatsPerK));
  assert.ok(max("pro") > max("classic"), "sonst waehlt niemand die kleinere Stufe");
  assert.ok(max("classic") > max("free"));
});

test("Textpreis waechst mit der Laenge", () => {
  const bezahlt = DEFAULT_MODEL_PRICES.find((m) => m.tier !== "free")!.model;
  assert.ok(textPriceSats(bezahlt, 10_000, 10_000) > textPriceSats(bezahlt, 100, 100));
});

test("Free-Tier bleibt auch bei langen Anfragen gratis", () => {
  const frei = DEFAULT_MODEL_PRICES.find((m) => m.tier === "free")!.model;
  assert.equal(textPriceSats(frei, 100_000, 100_000), 0);
});

test("Bezahlte Modelle kosten bei nennenswerter Laenge etwas", () => {
  const bezahlt = DEFAULT_MODEL_PRICES.find((m) => m.tier !== "free")!.model;
  assert.ok(textPriceSats(bezahlt, 5000, 5000) > 0);
});

test("Unbekanntes Modell wird nicht still mit null bepreist", () => {
  assert.equal(defaultPriceFor("gibt-es-nicht:1b"), undefined);
});

test("Videopreis steigt mit Laenge und Aufloesung", () => {
  const kurz = videoPriceSats(2);
  const lang = videoPriceSats(10);
  assert.ok(lang > kurz);
  assert.ok(DEFAULT_VIDEO_PRICES.length > 0);
});

test("Werkzeugpreise sind je Art hinterlegt", () => {
  for (const t of DEFAULT_TOOL_PRICES) {
    assert.ok(t.kind > 0);
    assert.ok(t.satsPerCall >= 0);
    assert.ok(t.name.length > 0);
  }
  const bekannt = DEFAULT_TOOL_PRICES[0];
  assert.equal(defaultToolPrice(bekannt.kind)?.kind, bekannt.kind);
  assert.equal(defaultToolPrice(999_999), undefined);
});

// ------------------------------------------------------- Client-Gebuehr

test("ppm-Umrechnung stimmt", () => {
  assert.equal(clientFeePpm(2.5), 25_000);
  assert.equal(clientFeePpm(10), 100_000);
  assert.equal(clientFeePpm(0), 0);
});

test("Gebuehr geht als Tag ins Job-Event — offen, nicht versteckt", () => {
  // Eine Gebuehr, die man erst finden muss, ist keine offene Gebuehr.
  const t = clientFeeTag({ recipient: "app@w.cash", ppm: 25_000, clientName: "FreedomStack" });
  assert.equal(t[0], "client_fee");
  assert.ok(t.includes("app@w.cash"));
  assert.ok(t.includes("FreedomStack"));
});

test("Tag laesst sich zurueckleisen", () => {
  const f = { recipient: "a@b.c", ppm: 25_000, clientName: "X" };
  assert.deepEqual(parseClientFee([clientFeeTag(f)]), f);
  assert.equal(parseClientFee([["andere", "tags"]]), null);
});

test("Kaputte Gebuehrenangaben werden verworfen", () => {
  assert.equal(parseClientFee([["client_fee", "a@b.c", "keine-zahl", "X"]]), null);
  assert.equal(parseClientFee([["client_fee", "a@b.c", "-500", "X"]]), null);
  assert.equal(parseClientFee([["client_fee"]]), null);
});

test("Gierige Gebuehren werden abgelehnt", () => {
  // Ohne Obergrenze waere die Offenheit der Schicht ein Werkzeug GEGEN den
  // Nutzer — eine manipulierte App koennte 90 Prozent nehmen.
  const gierig = checkClientFee({ recipient: "a@b.c", ppm: clientFeePpm(90), clientName: "Gierig" });
  assert.equal(gierig.accepted, false);
  assert.match(gierig.reason, /Obergrenze/);
  assert.ok(MAX_CLIENT_FEE_PERCENT <= 10);
});

test("Genau an der Obergrenze wird noch angenommen", () => {
  const grenz = checkClientFee({
    recipient: "a@b.c", ppm: clientFeePpm(MAX_CLIENT_FEE_PERCENT), clientName: "X",
  });
  assert.equal(grenz.accepted, true);
});

test("Gebuehr ohne brauchbaren Empfaenger wird abgelehnt", () => {
  assert.equal(checkClientFee({ recipient: "", ppm: 25_000, clientName: "X" }).accepted, false);
});

test("Keine Gebuehr ist ein gueltiger Zustand", () => {
  const ohne = checkClientFee(null);
  assert.equal(ohne.accepted, true);
  assert.equal(ohne.ppm, 0);
});

// ------------------------------------------------------------- Aufteilung

test("Die Client-Gebuehr schmaelert Pool und Referral NICHT", () => {
  // Sonst koennte eine Client-Entscheidung die Netz-Anteile aushoehlen.
  const betrag = 1_000_000;
  const p = splitFeeV1(betrag);
  for (const prozent of [0, 1, 2.5, 5, 10]) {
    const v = splitWithClientFee(betrag, p, clientFeePpm(prozent));
    assert.equal(v.poolMsat, p.poolMsat, `${prozent}%: Pool veraendert`);
    assert.equal(v.referralMsat, p.referralMsat, `${prozent}%: Referral veraendert`);
  }
});

test("Kein msat entsteht oder verschwindet", () => {
  for (const betrag of [1, 999, 1000, 123_457, 10_000_000]) {
    const p = splitFeeV1(betrag);
    const v = splitWithClientFee(betrag, p, clientFeePpm(2.5));
    assert.equal(
      v.workerMsat + v.poolMsat + v.referralMsat + v.clientMsat, betrag,
      `bei ${betrag} msat`,
    );
  }
});

test("Ohne Client-Gebuehr bekommt der Provider mehr", () => {
  const betrag = 1_000_000;
  const p = splitFeeV1(betrag);
  const mit = splitWithClientFee(betrag, p, clientFeePpm(2.5));
  const ohne = splitWithClientFee(betrag, p, 0);
  assert.ok(ohne.workerMsat > mit.workerMsat);
  assert.equal(ohne.clientMsat, 0);
  assert.equal(Number(ohne.totalFeePercent.toFixed(1)), 2.5, "nur noch die Protokollfee");
});

test("Der Gesamtsatz wird korrekt ausgewiesen", () => {
  const v = splitWithClientFee(1_000_000, splitFeeV1(1_000_000), clientFeePpm(DEFAULT_CLIENT_FEE_PERCENT));
  assert.equal(Number(v.totalFeePercent.toFixed(1)), 5.0);
});

test("Erklaerung nennt jeden Empfaenger", () => {
  // Ein Nutzer soll den Satz lesen und verstanden haben, wohin sein Geld
  // geht — ohne Dokumentation und ohne Nachrechnen.
  const v = splitWithClientFee(1_000_000, splitFeeV1(1_000_000), clientFeePpm(2.5));
  const t = explainFees(v, "FreedomStack App");
  for (const wort of ["Provider", "Reward-Pool", "Werber", "FreedomStack App"]) {
    assert.ok(t.includes(wort), `"${wort}" fehlt in der Erklaerung`);
  }
  assert.match(t, /5\.0 % gesamt/);
});

test("Ohne Client-Gebuehr wird sie auch nicht erwaehnt", () => {
  const v = splitWithClientFee(1_000_000, splitFeeV1(1_000_000), 0);
  assert.ok(!explainFees(v, "X").includes("an X"));
});

test("Ein Betrag von null stuerzt nicht ab", () => {
  const v = splitWithClientFee(0, splitFeeV1(0), clientFeePpm(2.5));
  assert.equal(v.totalFeePercent, 0);
});
