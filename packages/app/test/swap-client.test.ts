/**
 * Tests fuer den Atomic-Swap-Client.
 *
 * Jeder Pruefpunkt hier entspricht einem Weg, auf dem ein boesartiger LP eine
 * Lightning-Zahlung kassieren koennte, ohne SOL zu liefern. Deshalb liegt der
 * Schwerpunkt auf dem Moment VOR dem Bezahlen — danach ist es zu spaet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { PublicKey } from "@solana/web3.js";
import {
  verifyCounterpartyLock,
  buildClaimInstruction,
  claimSwap,
  preimageFits,
  nextStep,
  saveSwapSecret,
  loadSwapSecret,
  listSwapSecrets,
  forgetSwapSecret,
  exportSwapSecrets,
  setzeSwapSpeicher,
  swapSecretKeys,
  OnChainLock,
  SwapState,
} from "../src/swap-client.js";
import { anchorSighash, WalletSigner } from "../src/sol-htlc.js";

const KUNDE = "So11111111111111111111111111111111111111112";
const FREMD = "SysvarC1ock11111111111111111111111111111111";
const NOW = 1_800_000_000;
const PREIMAGE = new Uint8Array(32).fill(3);
const HASH = sha256(PREIMAGE);

const lock = (over: Partial<OnChainLock> = {}): OnChainLock => ({
  amountLamports: 1_000_000,
  timelockUnix: NOW + 3600,
  recipient: KUNDE,
  hashlock: HASH,
  claimed: false,
  refunded: false,
  ...over,
});

const params = (over: Record<string, unknown> = {}) => ({
  lock: lock(),
  expectedHashlock: HASH,
  expectedRecipient: KUNDE,
  expectedLamports: 1_000_000,
  lightningExpiryUnix: NOW + 3600 + 3600,
  nowUnix: NOW,
  ...over,
});

// ------------------------------------------------- Pruefung vor dem Zahlen

test("Swap: korrekte Gegenleistung wird freigegeben", () => {
  const v = verifyCounterpartyLock(params());
  assert.equal(v.ok, true, v.problems.join("; "));
  assert.match(v.summary, /geprüft/);
});

test("Swap: gar nichts gesperrt -> nicht zahlen", () => {
  // Der teuerste Fall: Rechnung zahlen fuer SOL, die es nicht gibt.
  const v = verifyCounterpartyLock(params({ lock: undefined }));
  assert.equal(v.ok, false);
  assert.match(v.summary, /fuer nichts|für nichts/);
});

test("Swap: fremder Hashlock -> Geld waere nicht einloesbar", () => {
  const v = verifyCounterpartyLock(params({ lock: lock({ hashlock: sha256(new Uint8Array(32).fill(9)) }) }));
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /Hashlock/.test(p)));
});

test("Swap: SOL an einen Dritten gesperrt -> abgelehnt", () => {
  const v = verifyCounterpartyLock(params({ lock: lock({ recipient: FREMD }) }));
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /Empfänger/.test(p)));
});

test("Swap: zu wenig gesperrt -> abgelehnt", () => {
  const v = verifyCounterpartyLock(params({ lock: lock({ amountLamports: 1 }) }));
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /Gesperrt sind 1 /.test(p)));
});

test("Swap: mehr gesperrt als zugesagt ist kein Problem", () => {
  const v = verifyCounterpartyLock(params({ lock: lock({ amountLamports: 2_000_000 }) }));
  assert.equal(v.ok, true);
});

test("Swap: bereits eingeloest oder zurueckgeholt -> abgelehnt", () => {
  for (const s of [{ claimed: true }, { refunded: true }]) {
    assert.equal(verifyCounterpartyLock(params({ lock: lock(s) })).ok, false, JSON.stringify(s));
  }
});

test("Swap: Timelock-Ordnung T_sol < T_lightning wird erzwungen", () => {
  // Verdrehte Reihenfolge: der Kunde koennte SOL einloesen, nachdem die
  // Lightning-Zahlung schon zurueckgelaufen ist — der LP verliert.
  const verdreht = verifyCounterpartyLock(params({
    lock: lock({ timelockUnix: NOW + 7200 }),
    lightningExpiryUnix: NOW + 3600,
  }));
  assert.equal(verdreht.ok, false);
  assert.ok(verdreht.problems.some((p) => /nicht vor der Lightning-Frist/.test(p)));
});

test("Swap: zu kleiner Abstand zwischen den Fristen -> abgelehnt", () => {
  const knapp = verifyCounterpartyLock(params({
    lock: lock({ timelockUnix: NOW + 3600 }),
    lightningExpiryUnix: NOW + 3600 + 300, // nur 5 Minuten Abstand
  }));
  assert.equal(knapp.ok, false);
  assert.ok(knapp.problems.some((p) => /Minuten; nötig/.test(p)));
});

test("Swap: abgelaufene oder fast abgelaufene SOL-Frist -> abgelehnt", () => {
  assert.equal(verifyCounterpartyLock(params({ lock: lock({ timelockUnix: NOW - 1 }) })).ok, false);
  const knapp = verifyCounterpartyLock(params({
    lock: lock({ timelockUnix: NOW + 120 }),
    lightningExpiryUnix: NOW + 120 + 3600,
  }));
  assert.equal(knapp.ok, false);
  assert.ok(knapp.problems.some((p) => /zu knapp/.test(p)));
});

test("Swap: mehrere Fehler werden alle gemeldet, nicht nur der erste", () => {
  const v = verifyCounterpartyLock(params({
    lock: lock({ recipient: FREMD, amountLamports: 1 }),
  }));
  assert.ok(v.problems.length >= 2, "der Nutzer soll das ganze Bild sehen");
});

// ------------------------------------------------------------- Einloesen

test("Claim-Instruktion: Preimage als festes [u8;32] OHNE Laengenpraefix", async () => {
  // Das Programm nimmt [u8; 32], nicht Vec<u8>. Borsh kodiert ein festes Array
  // ohne die vier Byte Laenge, die ein Vec davorstellen wuerde. Wer nur eine
  // Seite aendert, bekommt eine abgelehnte Transaktion ohne Fehlermeldung —
  // deshalb steht die Byte-Laenge hier exakt im Test.
  const ix = await buildClaimInstruction("s1", PREIMAGE, KUNDE, FREMD);
  const data = new Uint8Array(ix.data);
  assert.deepEqual(data.slice(0, 8), anchorSighash("claim"));
  assert.deepEqual(data.slice(8), PREIMAGE);
  assert.equal(data.length, 8 + 32, "kein Laengenpraefix");
});

test("Claim-Instruktion: Diskriminator stimmt mit Anchor ueberein", () => {
  assert.deepEqual(
    Buffer.from(anchorSighash("claim")),
    createHash("sha256").update("global:claim").digest().subarray(0, 8),
  );
});

test("Claim-Instruktion: falsche Preimage-Laenge wird abgefangen", async () => {
  await assert.rejects(() => buildClaimInstruction("s", new Uint8Array(16), KUNDE, FREMD), /32 Bytes/);
});

test("Claim-Instruktion: Empfaenger signiert, Initiator bekommt die Miete", async () => {
  const ix = await buildClaimInstruction("s2", PREIMAGE, KUNDE, FREMD);
  assert.equal(ix.keys.length, 3, "recipient, initiator, swap-PDA");
  assert.equal(ix.keys[0].pubkey.toBase58(), KUNDE);
  assert.equal(ix.keys[0].isSigner, true);
  // Der Initiator signiert NICHT — er bekommt nur die Mietbefreiung zurueck,
  // seit das Programm den PDA nach dem Einloesen schliesst.
  assert.equal(ix.keys[1].pubkey.toBase58(), FREMD);
  assert.equal(ix.keys[1].isSigner, false);
  assert.equal(ix.keys[1].isWritable, true);
  assert.equal(ix.keys[2].isWritable, true);
});

function fakeWallet(): WalletSigner {
  return {
    publicKey: new PublicKey(KUNDE),
    async signTransaction(tx: unknown) {
      (tx as { serialize: () => Uint8Array }).serialize = () => new Uint8Array([1]);
      return tx;
    },
  };
}

function fakeConnection(err: unknown = null) {
  return {
    async getLatestBlockhash() {
      return { blockhash: "Fake11111111111111111111111111111111111111", lastValidBlockHeight: 1 };
    },
    async sendRawTransaction() { return "sigAAA"; },
    async confirmTransaction() { return { value: { err } }; },
  } as unknown as import("@solana/web3.js").Connection;
}

test("Einloesen: erfolgreicher Claim liefert die Signatur", async () => {
  const r = await claimSwap({
    connection: fakeConnection(), wallet: fakeWallet(), swapId: "s3", preimage: PREIMAGE,
    initiator: FREMD, timelockUnix: Math.floor(Date.now() / 1000) + 3600,
  });
  assert.equal(r.signature, "sigAAA");
});

test("Einloesen: Ablehnung erklaert die wahrscheinlichen Gruende", async () => {
  await assert.rejects(
    () => claimSwap({
      connection: fakeConnection({ Custom: 1 }), wallet: fakeWallet(), swapId: "s4", preimage: PREIMAGE,
      initiator: FREMD, timelockUnix: Math.floor(Date.now() / 1000) + 3600,
    }),
    /Frist abgelaufen|Preimage nicht passt/,
  );
});

// ------------------------------------------------------------- Preimage

test("Preimage: Zugehoerigkeit wird geprueft", () => {
  assert.equal(preimageFits(bytesToHex(PREIMAGE), bytesToHex(HASH)), true);
  assert.equal(preimageFits(bytesToHex(PREIMAGE), bytesToHex(sha256(new Uint8Array(32)))), false);
  assert.equal(preimageFits("keinhex", "auchnicht"), false);
});

test("Preimage-Ablage: ueberlebt (anders als sessionStorage vorher)", async () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    setItem: (k: string, v: string) => store.set(k, v),
    getItem: (k: string) => store.get(k) ?? null,
    removeItem: (k: string) => store.delete(k),
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  };

  const s = {
    hashlockHex: bytesToHex(HASH), preimageHex: bytesToHex(PREIMAGE),
    solAddress: KUNDE, amountSats: 5000, createdAt: NOW,
  };
  await saveSwapSecret(s);
  assert.deepEqual(loadSwapSecret(s.hashlockHex), s);
  assert.equal(listSwapSecrets().length, 1);

  // Die Sicherung muss den Warnhinweis tragen — wer sie findet, kann einloesen.
  const exportiert = exportSwapSecrets();
  assert.match(exportiert, /Sicher aufbewahren/);
  assert.ok(exportiert.includes(s.preimageHex));

  await forgetSwapSecret(s.hashlockHex);
  assert.equal(loadSwapSecret(s.hashlockHex), null);
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

test("Preimage-Ablage: mit eingesetztem Speicher (Tresor) landet nichts in localStorage", async () => {
  const lokal = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    setItem: (k: string, v: string) => lokal.set(k, v),
    getItem: (k: string) => lokal.get(k) ?? null,
    removeItem: (k: string) => lokal.delete(k),
    get length() { return lokal.size; },
    key: (i: number) => [...lokal.keys()][i] ?? null,
  };
  const tresor = new Map<string, string>([["freedom.nsec", "anderes"]]);
  let geschrieben = 0;
  setzeSwapSpeicher({
    getItem: (k) => tresor.get(k) ?? null,
    setItem: async (k, v) => { await Promise.resolve(); tresor.set(k, v); geschrieben++; },
    removeItem: async (k) => { tresor.delete(k); },
    keys: () => [...tresor.keys()],
  });
  try {
    const s = {
      hashlockHex: bytesToHex(HASH), preimageHex: bytesToHex(PREIMAGE),
      solAddress: KUNDE, amountSats: 5000, createdAt: NOW,
    };
    await saveSwapSecret(s);
    assert.equal(geschrieben, 1, "erst nach dem Schreiben kehrt save zurueck");
    assert.deepEqual(loadSwapSecret(s.hashlockHex), s);
    assert.deepEqual(listSwapSecrets(), [s], "andere Tresor-Eintraege stoeren nicht");
    assert.equal(lokal.size, 0, "kein Preimage in localStorage");
    assert.deepEqual(swapSecretKeys([...tresor.keys()]), [`freedom.swap.${s.hashlockHex}`]);
    assert.deepEqual(swapSecretKeys(["freedom.swapHistory", "freedom.nsec"]), [], "Verlauf ist kein Preimage");
    await forgetSwapSecret(s.hashlockHex);
    assert.equal(loadSwapSecret(s.hashlockHex), null);
  } finally {
    // Standard wiederherstellen (wie in swap-client.ts)
    setzeSwapSpeicher({
      getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v),
      removeItem: (k) => localStorage.removeItem(k),
      keys: () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
        .filter((k): k is string => k !== null),
    });
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

// ------------------------------------------------------------- Ablauf

test("Ablauf: die Oberflaeche sagt vor dem Zahlen ausdruecklich 'noch nicht'", () => {
  const s: SwapState = { phase: "pruefe_sperre", message: "", safeToPay: false };
  assert.match(nextStep(s), /noch nicht zahlen/);
});

test("Ablauf: erst nach der Pruefung wird zum Zahlen aufgefordert", () => {
  assert.match(nextStep({ phase: "zahlbar", message: "", safeToPay: true }), /kann jetzt bezahlt/);
});

test("Ablauf: knappe Frist nach dem Zahlen – erst Dringlichkeit, dann Abraten", () => {
  // Seit Schritt 0.C: Innerhalb von CLAIM_SAFETY_MARGIN_SECS (10 Minuten) vor
  // Fristende wird nicht mehr zum Einloesen gedraengt, sondern abgeraten –
  // eine abgelehnte Einloesung wuerde das Preimage offenlegen.
  const zuKnapp = nextStep(
    { phase: "bezahlt", message: "", safeToPay: false, solTimelockUnix: NOW + 300 },
    NOW,
  );
  assert.match(zuKnapp, /zu knapp/);

  const eilig = nextStep(
    { phase: "bezahlt", message: "", safeToPay: false, solTimelockUnix: NOW + 900 },
    NOW,
  );
  assert.match(eilig, /Jetzt einlösen/);

  const entspannt = nextStep(
    { phase: "bezahlt", message: "", safeToPay: false, solTimelockUnix: NOW + 7200 },
    NOW,
  );
  assert.match(entspannt, /einlösen/);
  assert.doesNotMatch(entspannt, /zu spät|zu knapp/);
});

test("Ablauf: abgelaufener Swap beruhigt statt zu alarmieren", () => {
  // Der gezahlte Betrag laeuft bei Lightning von selbst zurueck — das soll
  // dastehen, sonst glaubt der Nutzer, sein Geld sei weg.
  assert.match(nextStep({ phase: "abgelaufen", message: "", safeToPay: false }), /läuft von selbst zurück/);
});
