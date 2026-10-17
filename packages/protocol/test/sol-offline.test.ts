/**
 * Schritt 7.2a: SOL ohne Internet (Durable Nonces) – Nonce-Konto anlegen und
 * lesen, Offline-Ueberweisung bauen und pruefen, auch die Negativfaelle.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, NONCE_ACCOUNT_LENGTH, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  LAMPORTS_JE_SIGNATUR, NONCE_KONTO_BYTES, baueNonceKontoAnlegen, baueNonceKontoSchliessen, baueOfflineUeberweisung, leseNonceKonto,
  nonceKontoKosten, pruefeOfflineUeberweisung, type NonceStand,
} from "../src/sol-offline.js";
import { alsDraht, leseNachricht, signiereMit, type SolTransaktion } from "../src/kit-transaktion.js";
import { MeshKind, pruefeMeshInhalt } from "../src/mesh-transport.js";

const HASH = "11111111111111111111111111111111";
const zahler = Keypair.generate();
const ziel = Keypair.generate().publicKey.toBase58();
const nonceKonto = Keypair.generate();
const NONCE_WERT = Keypair.generate().publicKey.toBase58();

/** Nonce-Konto wie auf der Kette: Version 1, eingerichtet, Autoritaet, Wert, 5000 Lamports je Signatur. */
function kontoDaten(autoritaet: PublicKey, wert: string, zustand = 1): Uint8Array {
  const d = new Uint8Array(NONCE_KONTO_BYTES);
  const v = new DataView(d.buffer);
  v.setUint32(0, 1, true);
  v.setUint32(4, zustand, true);
  d.set(autoritaet.toBytes(), 8);
  d.set(new PublicKey(wert).toBytes(), 40);
  v.setBigUint64(72, 5000n, true);
  return d;
}

const stand = (): NonceStand => leseNonceKonto(kontoDaten(zahler.publicKey, NONCE_WERT));

/** Seit A-21d1 baut kit; signiert wird über `signiereMit()` mit dem Schlüssel (32 Byte) der Attrappe. */
const signiert = (tx: SolTransaktion, ...k: Keypair[]): SolTransaktion => k.reduce((t, kp) => signiereMit(t, kp.secretKey.slice(0, 32))!, tx);

function offline(lamports = 12_345): Uint8Array {
  const tx = baueOfflineUeberweisung({ von: zahler.publicKey.toBase58(), an: ziel, lamports, nonceKonto: nonceKonto.publicKey.toBase58(), stand: stand() });
  return alsDraht(signiert(tx, zahler));
}

test("Kosten vorher: Miete bleibt im Konto, dazu zwei Signaturen", () => {
  assert.deepEqual(nonceKontoKosten(1_447_680), { miete: 1_447_680, gebuehr: 2 * LAMPORTS_JE_SIGNATUR, gesamt: 1_457_680 });
  for (const m of [0, -1, 1.5, Number.NaN]) assert.throws(() => nonceKontoKosten(m), /Miete/);
  assert.equal(NONCE_KONTO_BYTES, NONCE_ACCOUNT_LENGTH);
});

test("Nonce-Konto anlegen: Konto erzeugen und einrichten, Zahler ist Autoritaet", () => {
  const tx = baueNonceKontoAnlegen({ zahler: zahler.publicKey.toBase58(), nonceKonto: nonceKonto.publicKey.toBase58(), mieteLamports: 1_447_680, blockhash: HASH, letzteHoehe: 100n });
  const { anweisungen } = leseNachricht(tx);
  assert.equal(anweisungen.length, 2);
  assert.ok(anweisungen.every((ix) => ix.programm === SystemProgram.programId.toBase58()));
  assert.equal(new DataView(anweisungen[1]!.daten.buffer, anweisungen[1]!.daten.byteOffset).getUint32(0, true), 6, "InitializeNonceAccount");
  assert.equal(signiert(tx, zahler).signatures[nonceKonto.publicKey.toBase58() as never], null, "das neue Konto fehlt noch");
  // Gegenprobe mit web3.js: beide Signaturen gültig
  assert.ok(Transaction.from(alsDraht(signiert(tx, zahler, nonceKonto))).verifySignatures(), "Zahler und neues Konto signieren");
});

test("Nonce-Konto lesen: Autoritaet und Wert; Fremdes wird abgelehnt", () => {
  const s = stand();
  assert.equal(s.autoritaet, zahler.publicKey.toBase58());
  assert.equal(s.nonce, NONCE_WERT);
  assert.equal(s.lamportsJeSignatur, 5000);
  assert.throws(() => leseNonceKonto(new Uint8Array(79)), /Kein Nonce-Konto/);
  assert.throws(() => leseNonceKonto(kontoDaten(zahler.publicKey, NONCE_WERT, 0)), /nicht eingerichtet/);
});

test("Offline-Ueberweisung: erst weiterschalten, Nonce statt Blockhash, darf ueber Mesh", () => {
  const roh = offline();
  const tx = Transaction.from(roh);
  assert.equal(tx.recentBlockhash, NONCE_WERT);
  assert.ok(tx.verifySignatures(), "web3.js liest, was kit gebaut hat");
  const p = pruefeOfflineUeberweisung(roh);
  assert.deepEqual(p, {
    ok: true, von: zahler.publicKey.toBase58(), an: ziel, lamports: 12_345,
    nonceKonto: nonceKonto.publicKey.toBase58(), nonce: NONCE_WERT,
  });
  assert.equal(pruefeMeshInhalt(roh, MeshKind.SolanaTx).ok, true);
  assert.ok(roh.length < 400, `${roh.length} Byte – passt in zwei Funkpakete`);
});

test("Offline-Ueberweisung bauen: Unfug wird abgelehnt", () => {
  const basis = { von: zahler.publicKey.toBase58(), an: ziel, lamports: 1, nonceKonto: nonceKonto.publicKey.toBase58(), stand: stand() };
  for (const lamports of [0, -5, 1.5]) assert.throws(() => baueOfflineUeberweisung({ ...basis, lamports }), /positive ganze Zahl/);
  assert.throws(() => baueOfflineUeberweisung({ ...basis, an: basis.von }), /sich selbst/);
  const fremd = leseNonceKonto(kontoDaten(Keypair.generate().publicKey, NONCE_WERT));
  assert.throws(() => baueOfflineUeberweisung({ ...basis, stand: fremd }), /anderen Adresse/);
});

test("Pruefen: ohne Nonce, falsche Reihenfolge, Zusatz, fremde Autoritaet, unsigniert – abgelehnt", () => {
  // Fremde Formen baut hier web3.js – geprüft wird, was eine andere Software schicken könnte.
  const signiert = (tx: Transaction, ...s: Keypair[]) => { tx.recentBlockhash = NONCE_WERT; tx.feePayer = zahler.publicKey; tx.sign(...s); return new Uint8Array(tx.serialize()); };
  const weiter = (autoritaet = zahler.publicKey) => SystemProgram.nonceAdvance({ noncePubkey: nonceKonto.publicKey, authorizedPubkey: autoritaet });
  const zahlung = () => SystemProgram.transfer({ fromPubkey: zahler.publicKey, toPubkey: new PublicKey(ziel), lamports: 5 });

  assert.match((pruefeOfflineUeberweisung(signiert(new Transaction().add(zahlung()), zahler)) as { grund: string }).grund, /Nonce weiterschalten und Überweisung/);
  assert.match((pruefeOfflineUeberweisung(signiert(new Transaction().add(zahlung(), weiter()), zahler)) as { grund: string }).grund, /kein Durable Nonce/);
  assert.equal(pruefeOfflineUeberweisung(signiert(new Transaction().add(weiter(), zahlung(), zahlung()), zahler)).ok, false);
  const andere = Keypair.generate();
  assert.match((pruefeOfflineUeberweisung(signiert(new Transaction().add(weiter(andere.publicKey), zahlung()), zahler, andere)) as { grund: string }).grund, /dieselbe Adresse/);
  // Kennungen (8.16g2b3): Daraus bildet die App den Text in ihrer Sprache.
  const fall = (roh: Uint8Array) => (pruefeOfflineUeberweisung(roh) as { fall?: string }).fall;
  assert.equal(fall(signiert(new Transaction().add(zahlung()), zahler)), "anweisungen");
  assert.equal(fall(signiert(new Transaction().add(zahlung(), weiter()), zahler)), "kein-nonce");
  assert.equal(fall(signiert(new Transaction().add(weiter(andere.publicKey), zahlung()), zahler, andere)), "zahler-verschieden");
  assert.equal(fall(new Uint8Array(1300)), "zu-gross", "Grundprüfung aus pruefeSolanaTx()");

  const unsigniert = baueOfflineUeberweisung({ von: zahler.publicKey.toBase58(), an: ziel, lamports: 5, nonceKonto: nonceKonto.publicKey.toBase58(), stand: stand() });
  assert.equal(pruefeOfflineUeberweisung(alsDraht(unsigniert)).ok, false);
  const verfaelscht = offline();
  verfaelscht[verfaelscht.length - 1] ^= 1;
  assert.equal(pruefeOfflineUeberweisung(verfaelscht).ok, false);
  assert.equal(pruefeOfflineUeberweisung(new Uint8Array([1, 2, 3])).ok, false);
});

test("Nonce-Konto schliessen: ganzes Guthaben zurueck an die Autoritaet", () => {
  const tx = baueNonceKontoSchliessen({ autoritaet: zahler.publicKey.toBase58(), nonceKonto: nonceKonto.publicKey.toBase58(), lamports: 1_447_680, blockhash: HASH, letzteHoehe: 100n });
  const { anweisungen } = leseNachricht(tx);
  assert.equal(anweisungen.length, 1);
  const ix = anweisungen[0]!;
  const d = new DataView(ix.daten.buffer, ix.daten.byteOffset, ix.daten.byteLength);
  assert.equal(d.getUint32(0, true), 5, "WithdrawNonceAccount");
  assert.equal(d.getBigUint64(4, true), 1_447_680n);
  assert.equal(ix.konten[1]!.adresse, zahler.publicKey.toBase58(), "zurück an die Autorität");
  assert.ok(Transaction.from(alsDraht(signiert(tx, zahler))).verifySignatures());
  assert.throws(() => baueNonceKontoSchliessen({ autoritaet: zahler.publicKey.toBase58(), nonceKonto: nonceKonto.publicKey.toBase58(), lamports: 0, blockhash: HASH, letzteHoehe: 100n }), /Guthaben/);
});
