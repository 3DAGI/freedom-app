/**
 * Solana-Vektoren der App (A-21a, `docs/KIT-PLAN.md`): HTLC (sperren, einlösen,
 * zurückholen), Einlösung über einen Relayer, Zahlkanal über die Wallet, Überweisung
 * und Trinkgeld – mit festen Eingaben genau die Nachrichten aus
 * `protocol/test/fixtures/solana-vektoren.json` (web3.js v1). Der Wechsel zu
 * `@solana/kit` muss dieselben Bytes liefern.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appFaelle } from "./sol-vektoren-faelle.js";

const datei = JSON.parse(readFileSync(new URL("../../protocol/test/fixtures/solana-vektoren.json", import.meta.url), "utf8")) as {
  protokoll: Record<string, string>; app: Record<string, string>;
};

test("A-21a: App – jede gesendete Nachricht gleicht dem festgehaltenen Vektor, keiner fehlt, keiner zu viel", async () => {
  const ist = await appFaelle();
  assert.deepEqual(Object.keys(ist).sort(), Object.keys(datei.app).sort());
  for (const [name, b64] of Object.entries(ist)) assert.equal(b64, datei.app[name], name);
});

test("A-21a: Zahlkanal über die Wallet der App ergibt dieselben Bytes wie im Protokoll", () => {
  for (const name of ["kanal-oeffnen", "kanal-aufstocken"]) assert.equal(datei.app[name], datei.protokoll[name], name);
});

test("A-21a: zweimal gebaut, zweimal dieselben Bytes – das Preimage des Deposits ist vorgegeben", async () => {
  assert.deepEqual(await appFaelle(), await appFaelle());
});
