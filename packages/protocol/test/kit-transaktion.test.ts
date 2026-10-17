/**
 * Transaktionen über kit (A-21d1, `docs/KIT-PLAN.md`): Jede Nachricht, für die das Protokoll
 * kit-Anweisungen hat, gleicht dem Vektor aus A-21a; Signaturen über `@noble/curves` sind
 * gültig und gleich denen von web3.js (Ed25519 ist deterministisch); Draht hin und zurück;
 * gelesen werden Rollen wie bei web3.js.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Message, PublicKey, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  alsDraht, ausDraht, baueTransaktion, erstatteKanalAnweisung, leseNachricht, oeffneKanalAnweisung, rechneKanalAbAnweisungen,
  signiereGutschrift, signiereMit, stockeKanalAufAnweisung, type SolTransaktion,
} from "../src/index.js";
import { BLOCKHASH, EMPFAENGER, KANAL, KUNDE, PROVIDER, SITZUNG, SITZUNG_GEHEIM, adresse, alsText, schluessel } from "./sol-vektoren-faelle.js";

const datei = JSON.parse(readFileSync(new URL("./fixtures/solana-vektoren.json", import.meta.url), "utf8")) as { protokoll: Record<string, string> };
const zeit = { blockhash: BLOCKHASH, letzteHoehe: 1_000n };
const geheim = (n: number): Uint8Array => new Uint8Array(32).fill(n);

const oeffnen = (): SolTransaktion => baueTransaktion({
  zahler: KUNDE,
  anweisungen: [oeffneKanalAnweisung({
    kunde: KUNDE, provider: PROVIDER, nonce: 7n, betrag: 50_000_000n, ablauf: 1_800_000_000n, sitzungsSchluessel: SITZUNG, empfaenger: EMPFAENGER,
  })],
  lebensdauer: zeit,
});

test("A-21d1: kit baut für Zahlkanal öffnen, aufstocken, einlösen und erstatten die Bytes der Vektoren", () => {
  const gutschrift = signiereGutschrift(SITZUNG_GEHEIM, KANAL, 12_345_678n, 1_800_000_000n);
  const ist: Record<string, SolTransaktion> = {
    "kanal-oeffnen": oeffnen(),
    "kanal-aufstocken": baueTransaktion({ zahler: KUNDE, anweisungen: [stockeKanalAufAnweisung({ kunde: KUNDE, kanal: KANAL, betrag: 10_000_000n })], lebensdauer: zeit }),
    "kanal-einloesen": baueTransaktion({
      zahler: PROVIDER, anweisungen: rechneKanalAbAnweisungen({ provider: PROVIDER, gutschrift, sitzungsSchluessel: SITZUNG, empfaenger: EMPFAENGER }), lebensdauer: zeit,
    }),
    "kanal-erstatten": baueTransaktion({ zahler: adresse(5), anweisungen: [erstatteKanalAnweisung({ kunde: KUNDE, kanal: KANAL })], lebensdauer: zeit }),
  };
  for (const [name, tx] of Object.entries(ist)) assert.equal(alsText(tx.messageBytes), datei.protokoll[name], name);
  // Die Höhe gehört nicht zur Nachricht – nur zur Frist beim Bestätigen
  assert.deepEqual(baueTransaktion({ zahler: KUNDE, anweisungen: [], lebensdauer: { ...zeit, letzteHoehe: 5n } }).messageBytes,
    baueTransaktion({ zahler: KUNDE, anweisungen: [], lebensdauer: zeit }).messageBytes);
});

test("A-21d1: signiereMit – gültig, gleich der Signatur von web3.js, nur für verlangte Adressen, ohne die alte zu ändern", () => {
  const tx = oeffnen();
  assert.deepEqual(Object.keys(tx.signatures), [KUNDE], "nur der Kunde unterschreibt");
  assert.equal(tx.signatures[KUNDE as never], null);
  assert.equal(signiereMit(tx, geheim(2)), null, "der Provider wird nicht verlangt");

  const signiert = signiereMit(tx, geheim(1))!;
  assert.equal(tx.signatures[KUNDE as never], null, "die alte Transaktion bleibt unsigniert");
  const sig = signiert.signatures[KUNDE as never]!;
  assert.ok(ed25519.verify(sig, Uint8Array.from(signiert.messageBytes), schluessel(1).publicKey.toBytes()));

  const web3 = Transaction.populate(Message.from(Buffer.from(Uint8Array.from(tx.messageBytes))));
  web3.sign(schluessel(1));
  assert.deepEqual(alsDraht(signiert), Uint8Array.from(web3.serialize()), "dieselben Bytes auf dem Draht");
});

test("A-21d1: Draht hin und zurück – fehlende Signaturen als Nullen, kaputte Bytes werfen", () => {
  const tx = oeffnen();
  const roh = alsDraht(tx);
  assert.equal(roh[0], 1, "ein Platz");
  assert.deepEqual(roh.subarray(1, 65), new Uint8Array(64), "noch nicht signiert");
  const zurueck = ausDraht(alsDraht(signiereMit(tx, geheim(1))!));
  assert.deepEqual(zurueck.messageBytes, tx.messageBytes);
  assert.ok(zurueck.signatures[KUNDE as never]);
  assert.ok(Transaction.from(alsDraht(zurueck)).verifySignatures(), "web3.js liest, was kit schreibt");
  assert.throws(() => ausDraht(new Uint8Array([1, 2, 3])));
});

test("A-21d1: leseNachricht – Zahler, Blockhash und Rollen wie bei web3.js; v0 und fremde Indizes werfen", () => {
  const tx = oeffnen();
  const gelesen = leseNachricht(tx);
  assert.equal(gelesen.zahler, KUNDE);
  assert.equal(gelesen.lebensdauer, BLOCKHASH);
  const web3 = Message.from(Buffer.from(Uint8Array.from(tx.messageBytes)));
  const [ix] = gelesen.anweisungen;
  assert.equal(ix!.programm, web3.accountKeys[web3.instructions[0]!.programIdIndex]!.toBase58());
  assert.deepEqual(ix!.konten, web3.instructions[0]!.accounts.map((i) => ({
    adresse: web3.accountKeys[i]!.toBase58(), signiert: web3.isAccountSigner(i), schreibbar: web3.isAccountWritable(i),
  })));
  assert.deepEqual(ix!.daten, Uint8Array.from(web3.compiledInstructions[0]!.data));

  const v0 = new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(KUNDE), recentBlockhash: BLOCKHASH, instructions: [] }).compileToV0Message());
  assert.throws(() => leseNachricht(ausDraht(v0.serialize())), /legacy/);
  // Ein Index hinter dem letzten Konto (Programm-Index der ersten Anweisung verbogen)
  const roh = Uint8Array.from(tx.messageBytes);
  const m = Message.from(Buffer.from(roh));
  const stelle = 3 + 1 + 32 * m.accountKeys.length + 32 + 1;
  roh[stelle] = 200;
  assert.throws(() => leseNachricht({ ...tx, messageBytes: roh as never }), /Konto/);
});

test("A-21d1: Durable Nonce – kit stellt das Weiterschalten an den Anfang, der Wert steht statt des Blockhashs", () => {
  const nonce = adresse(98), konto = adresse(10);
  const tx = baueTransaktion({ zahler: KUNDE, anweisungen: [], lebensdauer: { nonce, nonceKonto: konto, autoritaet: KUNDE } });
  const g = leseNachricht(tx);
  assert.equal(g.lebensdauer, nonce);
  assert.equal(g.anweisungen.length, 1);
  assert.deepEqual(g.anweisungen[0]!.konten.map((k) => k.adresse), [konto, "SysvarRecentB1ockHashes11111111111111111111", KUNDE]);
  assert.deepEqual(g.anweisungen[0]!.daten, new Uint8Array([4, 0, 0, 0]));
  assert.deepEqual(g.anweisungen[0]!.konten.map((k) => k.signiert), [false, false, true], "die Autorität unterschreibt");
});
