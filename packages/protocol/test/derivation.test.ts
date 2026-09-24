/**
 * Schluesselableitung (Schritt 1.1): SLIP-10 fuer Ed25519 und Solana-Pfade.
 * Die Erwartungswerte stammen aus der SLIP-0010-Spezifikation, Testvektor 1
 * fuer Ed25519 (github.com/satoshilabs/slips, slip-0010.md).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { Keypair } from "@solana/web3.js";
import {
  deriveSolanaKey,
  parseDerivationPath,
  slip10Derive,
  slip10Master,
  slip10PublicKey,
  solanaPath,
} from "../src/derivation.js";

const SEED = hexToBytes("000102030405060708090a0b0c0d0e0f");
const VEKTOR_1 = [
  {
    pfad: "m",
    chain: "90046a93de5380a72b5e45010748567d5ea02bbf6522f979e05c0d8d8ca9fffb",
    priv: "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7",
    pub: "00a4b2856bfec510abab89753fac1ac0e1112364e7d250545963f135f2a33188ed",
  },
  {
    pfad: "m/0H",
    chain: "8b59aa11380b624e81507a27fedda59fea6d0b779a778918a2fd3590e16e9c69",
    priv: "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3",
    pub: "008c8a13df77a28f3445213a0f432fde644acaa215fc72dcdf300d5efaa85d350c",
  },
  {
    pfad: "m/0H/1H/2H/2H/1000000000H",
    chain: "68789923a0cac2cd5a29172a475fe9e0fb14cd6adb5ad98a3fa70333e7afa230",
    priv: "8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793",
    pub: "003c24da049451555d51a7014a37337aa4e12d41e485abccfa46b47dfb2af54b7a",
  },
];

for (const v of VEKTOR_1) {
  test(`SLIP-10-Testvektor 1: ${v.pfad}`, () => {
    const k = v.pfad === "m" ? slip10Master(SEED) : slip10Derive(SEED, v.pfad);
    assert.equal(bytesToHex(k.chainCode), v.chain);
    assert.equal(bytesToHex(k.privateKey), v.priv);
    assert.equal(bytesToHex(slip10PublicKey(k.privateKey)), v.pub);
  });
}

test("Solana-Pfad ist Phantom-kompatibel", () => {
  assert.equal(solanaPath(0), "m/44'/501'/0'/0'");
  assert.equal(solanaPath(7), "m/44'/501'/7'/0'");
  assert.throws(() => solanaPath(-1));
  assert.throws(() => solanaPath(1.5));
});

test("abgeleiteter Solana-Schluessel ist ein gueltiges Keypair fuer web3.js", () => {
  const seed = new Uint8Array(64).fill(7);
  const k = deriveSolanaKey(seed, 0);
  assert.equal(k.secretKey.length, 64);
  const kp = Keypair.fromSecretKey(k.secretKey); // prueft, ob privat und oeffentlich zusammenpassen
  assert.equal(kp.publicKey.toBase58(), Keypair.fromSeed(k.secretKey.slice(0, 32)).publicKey.toBase58());
  assert.deepEqual(kp.publicKey.toBytes(), k.publicKey);
});

test("verschiedene Indizes ergeben verschiedene, stabile Adressen", () => {
  const seed = new Uint8Array(64).fill(1);
  const a0 = bytesToHex(deriveSolanaKey(seed, 0).publicKey);
  const a1 = bytesToHex(deriveSolanaKey(seed, 1).publicKey);
  assert.notEqual(a0, a1);
  assert.equal(bytesToHex(deriveSolanaKey(seed, 0).publicKey), a0);
});

test("nicht gehaertete Schritte werden abgelehnt", () => {
  assert.throws(() => slip10Derive(SEED, "m/44'/501'/0'/0"), /gehaertete/);
});

test("Pfade werden streng geprueft", () => {
  assert.deepEqual(parseDerivationPath("m/0'/1H/2h"), [0x80000000, 0x80000001, 0x80000002]);
  assert.throws(() => parseDerivationPath("44'/501'"), /beginnen/);
  assert.throws(() => parseDerivationPath("m/abc'"), /Ungueltiger/);
  assert.throws(() => parseDerivationPath("m/2147483648'"), /zu gross/);
});

test("zu kurzer oder zu langer Seed wird abgelehnt", () => {
  assert.throws(() => slip10Master(new Uint8Array(8)));
  assert.throws(() => slip10Master(new Uint8Array(65)));
});
