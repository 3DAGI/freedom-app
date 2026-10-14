/**
 * Solana-Vektoren (A-21a, `docs/KIT-PLAN.md`): Jede Transaktion, die Protokoll und Knoten
 * heute bauen, ergibt mit festen Eingaben genau die Nachricht aus
 * `fixtures/solana-vektoren.json` (web3.js v1). Der Wechsel zu `@solana/kit` (A-21b–f)
 * muss dieselben Bytes liefern – die Datei wird dafür nie neu erzeugt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Ed25519Program, PublicKey, VersionedMessage } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { gutschriftNachricht } from "../src/index.js";
import { BLOCKHASH, KANAL, SITZUNG, adresse, protokollFaelle } from "./sol-vektoren-faelle.js";

const datei = JSON.parse(readFileSync(new URL("./fixtures/solana-vektoren.json", import.meta.url), "utf8")) as {
  web3js: string; protokoll: Record<string, string>; app: Record<string, string>;
};
const nachricht = (b64: string) => VersionedMessage.deserialize(Buffer.from(b64, "base64"));

test("A-21a: Protokoll und Knoten – jede Nachricht gleicht dem festgehaltenen Vektor, keiner fehlt, keiner zu viel", async () => {
  const ist = await protokollFaelle();
  assert.deepEqual(Object.keys(ist).sort(), Object.keys(datei.protokoll).sort());
  for (const [name, b64] of Object.entries(ist)) assert.equal(b64, datei.protokoll[name], name);
});

test("A-21a: zweimal gebaut, zweimal dieselben Bytes – kein Zufall, keine Uhr", async () => {
  assert.deepEqual(await protokollFaelle(), await protokollFaelle());
});

test("A-21a: die Vektoren tragen, was sie sollen – Blockhash, Zahler, Ed25519-Prüfung mit gültiger Signatur", () => {
  for (const [name, b64] of Object.entries({ ...datei.protokoll, ...datei.app })) {
    const m = nachricht(b64);
    assert.equal(m.version, "legacy", name);
    // Ohne Internet steht der Wert des Nonce-Kontos an der Stelle des Blockhashs
    assert.equal(m.recentBlockhash, name === "offline-ueberweisung" ? adresse(98) : BLOCKHASH, name);
  }
  const e = nachricht(datei.protokoll["kanal-einloesen"]!);
  assert.equal(e.staticAccountKeys[0]!.toBase58(), adresse(2), "der Provider zahlt");
  const [pruefung] = e.compiledInstructions;
  assert.equal(e.staticAccountKeys[pruefung!.programIdIndex]!.toBase58(), Ed25519Program.programId.toBase58(), "Ed25519 vor settle");
  // Kopf 16 Byte, dann Schlüssel (32), Signatur (64), Nachricht
  const d = pruefung!.data;
  const pk = d.subarray(16, 48), sig = d.subarray(48, 112), msg = d.subarray(112);
  assert.deepEqual(Uint8Array.from(pk), new PublicKey(SITZUNG).toBytes(), "der Sitzungsschlüssel des Kanals");
  assert.deepEqual(Uint8Array.from(msg), gutschriftNachricht(KANAL, 12_345_678n, 1_800_000_000n));
  assert.ok(ed25519.verify(sig, msg, pk), "die Signatur im Vektor ist gültig");
  assert.equal(datei.web3js, "1.98.4");
});

