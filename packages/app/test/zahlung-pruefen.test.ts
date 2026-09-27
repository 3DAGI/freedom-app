/**
 * Schritt 4.8 prüfte unter jeder Antwort den Gebühren-Beleg des Knotens
 * (Kind 38051). Seit 5.1.2 zahlt der Knoten keine Gebühren mehr aus und
 * veröffentlicht keinen Beleg; seit 5.1.3 zahlt die App die Anteile selbst
 * (Modell A+) und zeigt je Antwort, wohin das Geld geht. Die Kettenprüfung aus
 * 4.8 bleibt für Trinkgeld-Belege.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("5.1.3: je Antwort die Aufteilung nach A+ statt „Zahlung prüfen“ am Beleg des Knotens; Kettenprüfung bleibt über den RPC-Pool", () => {
  const agent = readFileSync(new URL("../src/shell/tabs/agent.ts", import.meta.url), "utf8");
  assert.match(agent, /\$\{abrechnung && abrechnung\.providerMsat > 0 \? aufteilungZeilen\(abrechnung, zeile\) : ""\}/);
  assert.match(agent, /zeile\("An den Provider", satText\(a\.providerMsat\)\)/);
  assert.match(agent, /zeile\("Weitere Anteile", "kein Empfänger – beim Provider"\)/, "nicht Zuordenbares sichtbar beim Provider");
  assert.doesNotMatch(agent, /verifyFeeProof|KIND_FEE_PROOF|Zahlung prüfen/, "kein Beleg des Knotens mehr – sonst hieße es fälschlich „nicht abgeführt“");
  const state = readFileSync(new URL("../src/shell/state.ts", import.meta.url), "utf8");
  assert.match(state, /return \(await ensureRpcPool\(\)\)\.getTransaction\(signatur\);/);
  const kom = readFileSync(new URL("../src/shell/tabs/kommunikation.ts", import.meta.url), "utf8");
  assert.match(kom, /pruefeTrinkgeld\(t, ketteAusRpc\(await solRpcUrl\(\)\), solTransaktion\)/);
});

test("5.1.4c: Abzeichen ohne Gebühren-Belege – das Profil fragt Kind 38051 nicht mehr ab", () => {
  const profil = readFileSync(new URL("../src/shell/tabs/profil.ts", import.meta.url), "utf8");
  assert.doesNotMatch(profil, /KIND_FEE_PROOF|feeProofs|38051/);
  assert.match(profil, /evaluateQuests\(\{\s*pubkey: state\.keypair\.pk, performances: arbeit,\s*\}\)/);
});
