/**
 * Schritt 4.2a: Tageslimit der eingebauten Wallet – rollendes Fenster,
 * ueber dem Limit Nachfrage statt stiller Zahlung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FENSTER_SECS, imFenster, pruefeTageslimit } from "../src/ausgabe-limit.js";

const JETZT = 1_790_000_000;

test("Tageslimit: innerhalb ohne Nachfrage, darueber mit", () => {
  const verlauf = [{ zeit: JETZT - 3600, betrag: 60_000_000 }];
  assert.deepEqual(pruefeTageslimit(verlauf, 30_000_000, 100_000_000, JETZT), { ohneNachfrage: true, verbraucht: 60_000_000, rest: 40_000_000 });
  assert.equal(pruefeTageslimit(verlauf, 40_000_000, 100_000_000, JETZT).ohneNachfrage, true, "genau bis zum Limit");
  assert.equal(pruefeTageslimit(verlauf, 40_000_001, 100_000_000, JETZT).ohneNachfrage, false);
  assert.equal(pruefeTageslimit([], 1, 0, JETZT).ohneNachfrage, false, "Limit 0: immer nachfragen");
});

test("Tageslimit: rollendes Fenster – nicht um Mitternacht zweimal", () => {
  const knappVor = { zeit: JETZT - FENSTER_SECS + 1, betrag: 90 };
  const genauAlt = { zeit: JETZT - FENSTER_SECS, betrag: 90 };
  assert.equal(pruefeTageslimit([knappVor], 20, 100, JETZT).ohneNachfrage, false, "noch im Fenster");
  assert.equal(pruefeTageslimit([genauAlt], 20, 100, JETZT).ohneNachfrage, true, "aus dem Fenster gefallen");
  // Zukuenftige oder kaputte Eintraege zaehlen nicht (Uhr verstellt, Speicher manipuliert)
  assert.deepEqual(imFenster([{ zeit: JETZT + 10, betrag: 5 }, { zeit: JETZT, betrag: -5 }, { zeit: JETZT, betrag: 1.5 }], JETZT), []);
});

test("Tageslimit: ungueltige Eingaben", () => {
  assert.throws(() => pruefeTageslimit([], 0, 100, JETZT), /positive ganze Zahl/);
  assert.throws(() => pruefeTageslimit([], 1.5, 100, JETZT), /positive ganze Zahl/);
  assert.throws(() => pruefeTageslimit([], 1, -1, JETZT), /nicht negative/);
});
