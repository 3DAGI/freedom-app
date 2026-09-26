/**
 * Schritt 8.7: Kosten je Werkzeug in sats und SOL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { werkzeugPreise, werkzeugPreisText } from "../src/werkzeug-preise.js";

test("8.7: guenstigstes Angebot je Werkzeug, sonst Richtpreis – in beiden Einheiten", () => {
  const p = werkzeugPreise([
    { tools: [{ kind: 5060, name: "web_search", priceMsat: 8000 }, { kind: 5062, name: "browser_use", priceMsat: -1 }] },
    { tools: [{ kind: 5060, name: "web_search", priceMsat: 3000 }] },
  ]);
  assert.deepEqual(p.get(5060), { msat: 3000, angeboten: true });
  assert.deepEqual(p.get(5062), { msat: 15000, angeboten: false }, "unsinniger Preis faellt heraus, Richtpreis bleibt");
  assert.equal(werkzeugPreisText(p.get(5060), { satsProSol: 150_000 }), "3 sats ≈ 0,00002 SOL je Aufruf");
  assert.equal(werkzeugPreisText(p.get(5062), { satsProSol: 150_000 }), "15 sats ≈ 0,0001 SOL je Aufruf (Richtpreis)");
  assert.equal(werkzeugPreisText(p.get(5060)), "3 sats (SOL: kein Kurs) je Aufruf");
  assert.equal(werkzeugPreisText(undefined), "Preis unbekannt");
});
