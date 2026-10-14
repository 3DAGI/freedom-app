/**
 * A-21b1 (`docs/KIT-PLAN.md`): Anweisungen als `@solana/kit`-`Instruction`, für web3.js über
 * `alsWeb3()`. Die Bytes ganzer Nachrichten prüfen die Vektoren (`sol-vektoren.test.ts`); hier
 * die Brücke selbst – Rollen, Daten, die von Hand gebaute Ed25519-Anweisung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountRole } from "@solana/kit";
import { Ed25519Program } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { alsWeb3, ed25519Anweisung, ED25519_PROGRAMM, konto, SYSTEM_PROGRAMM } from "../src/kit-bruecke.js";
import { erstatteKanalAnweisung, KANAL_PROGRAMM_ID, oeffneKanalAnweisung, stockeKanalAufAnweisung } from "../src/channel.js";
import { adresse } from "./sol-vektoren-faelle.js";

test("A-21b1: alsWeb3 – vier Rollen, Programm und Daten unverändert", () => {
  const ix = alsWeb3({
    programAddress: konto(SYSTEM_PROGRAMM, AccountRole.READONLY).address,
    accounts: [
      konto(adresse(1), AccountRole.WRITABLE_SIGNER), konto(adresse(2), AccountRole.READONLY_SIGNER),
      konto(adresse(3), AccountRole.WRITABLE), konto(adresse(4), AccountRole.READONLY),
    ],
    data: new Uint8Array([1, 2, 3]),
  });
  assert.equal(ix.programId.toBase58(), SYSTEM_PROGRAMM);
  assert.deepEqual(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [
    [adresse(1), true, true], [adresse(2), true, false], [adresse(3), false, true], [adresse(4), false, false],
  ]);
  assert.deepEqual([...ix.data], [1, 2, 3]);
  assert.equal(alsWeb3({ programAddress: konto(SYSTEM_PROGRAMM, AccountRole.READONLY).address }).keys.length, 0, "ohne Konten und Daten");
  assert.throws(() => konto("keine-adresse", AccountRole.READONLY), "nur gültige Adressen");
});

test("A-21b1: Ed25519-Anweisung von Hand – Byte für Byte wie web3.js, falsche Längen abgewiesen", () => {
  for (const laenge of [0, 1, 80, 1000]) {
    const geheim = new Uint8Array(32).fill(laenge % 251 + 1);
    const nachricht = new Uint8Array(laenge).map((_, i) => (i * 7 + laenge) % 256);
    const schluessel = ed25519.getPublicKey(geheim);
    const signatur = ed25519.sign(nachricht, geheim);
    const kit = ed25519Anweisung({ schluessel, signatur, nachricht });
    const web3 = Ed25519Program.createInstructionWithPublicKey({ publicKey: schluessel, message: nachricht, signature: signatur });
    assert.equal(kit.programAddress, ED25519_PROGRAMM);
    assert.equal(web3.programId.toBase58(), ED25519_PROGRAMM);
    assert.deepEqual([...kit.data!], [...web3.data], `Nachricht ${laenge} Byte`);
    assert.deepEqual(kit.accounts, []);
  }
  assert.throws(() => ed25519Anweisung({ schluessel: new Uint8Array(31), signatur: new Uint8Array(64), nachricht: new Uint8Array(1) }), /32 Byte/);
  assert.throws(() => ed25519Anweisung({ schluessel: new Uint8Array(32), signatur: new Uint8Array(63), nachricht: new Uint8Array(1) }), /64 Byte/);
  assert.throws(() => ed25519Anweisung({ schluessel: new Uint8Array(32), signatur: new Uint8Array(64), nachricht: new Uint8Array(0xffff) }), /zu lang/);
});

test("A-21b1: der Zahlkanal baut kit-Anweisungen – Adressen als Text, Rollen statt Schaltern", () => {
  const kunde = adresse(1), provider = adresse(2);
  const auf = oeffneKanalAnweisung({
    kunde, provider, nonce: 7n, betrag: 1n, ablauf: 1_800_000_000n, sitzungsSchluessel: adresse(8), empfaenger: [],
  });
  assert.equal(auf.programAddress, KANAL_PROGRAMM_ID);
  assert.deepEqual(auf.accounts!.map((k) => k.role), [AccountRole.WRITABLE_SIGNER, AccountRole.READONLY, AccountRole.WRITABLE, AccountRole.READONLY]);
  assert.equal(auf.accounts![3]!.address, SYSTEM_PROGRAMM);
  const kanal = auf.accounts![2]!.address;
  assert.deepEqual(erstatteKanalAnweisung({ kunde, kanal }).accounts!.map((k) => k.role), [AccountRole.WRITABLE, AccountRole.WRITABLE], "erstatten ohne Unterschrift (Z1)");
  assert.equal(stockeKanalAufAnweisung({ kunde, kanal, betrag: 5n }).accounts![0]!.role, AccountRole.WRITABLE_SIGNER);
  assert.throws(() => stockeKanalAufAnweisung({ kunde, kanal, betrag: 0n }), /größer als 0/);
});
