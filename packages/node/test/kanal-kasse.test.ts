/**
 * Schritt 4.3c: Kasse des Providers für den Zahlkanal. Geprüft wird, dass der
 * Knoten nur Gutschriften annimmt, die auf der Kette gedeckt sind, nie
 * ungedeckt arbeitet (Vorauszahlung bis zum Gebot), rechtzeitig einlöst und
 * nach einem Neustart nichts verliert.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createHash } from "node:crypto";
import {
  ausDraht, ED25519_PROGRAMM, KANAL_KONTO_BYTES, KANAL_PROGRAMM_ID, kanalAdresse, leseNachricht, neuerSitzungsSchluessel, signiereGutschrift,
  SYSTEM_PROGRAMM, type Instruction, type KanalEmpfaenger,
} from "@freedomstack/protocol";
import { EINLOES_SCHWELLE, KanalKasse, kanalKasseAusUmgebung, kanalSpeicher, type KanalKonto } from "../src/kanal-kasse.js";
import { RUECKLAGE } from "../src/sol-auszahlung.js";
import { ATTRAPPE_BLOCKHASH, ketteAufPort } from "./kette-attrappe.js";

const JETZT = 1_900_000_000;
const provider = Keypair.generate().publicKey.toBase58();
const kunde = Keypair.generate().publicKey.toBase58();
const empfaenger: KanalEmpfaenger[] = [{ adresse: Keypair.generate().publicKey.toBase58(), ppm: 25_000 }];

/** Kanal-Konto nach docs/ZAHLKANAL.md. */
function konto(p: { sitzung: string; eingezahlt: bigint; ausgezahlt?: bigint; ablauf: bigint; provider?: string; nonce?: bigint }): Uint8Array {
  const b = Buffer.alloc(KANAL_KONTO_BYTES);
  createHash("sha256").update("account:Channel").digest().subarray(0, 8).copy(b, 0);
  let o = 8;
  for (const k of [kunde, p.provider ?? provider, p.sitzung]) { new PublicKey(k).toBuffer().copy(b, o); o += 32; }
  o = b.writeBigUInt64LE(p.nonce ?? 1n, o); o = b.writeBigUInt64LE(p.eingezahlt, o); o = b.writeBigUInt64LE(p.ausgezahlt ?? 0n, o);
  o = b.writeBigInt64LE(p.ablauf, o); o = b.writeUInt32LE(empfaenger.length, o);
  for (const e of empfaenger) { new PublicKey(e.adresse).toBuffer().copy(b, o); o += 32; o = b.writeUInt32LE(e.ppm, o); }
  b[o] = 255;
  return b;
}

function aufbau(p: { eingezahlt?: bigint; laufzeit?: number; owner?: string; anderer?: string } = {}) {
  const sitzung = neuerSitzungsSchluessel();
  const nonce = BigInt(Math.floor(Math.random() * 1e9));
  const kanal = kanalAdresse(kunde, provider, nonce).adresse;
  const ablauf = BigInt(JETZT + (p.laufzeit ?? 86_400));
  const kette = new Map<string, KanalKonto>([[kanal, {
    owner: p.owner ?? KANAL_PROGRAMM_ID,
    daten: konto({ sitzung: sitzung.oeffentlich, eingezahlt: p.eingezahlt ?? 1_000_000n, ablauf, provider: p.anderer, nonce }),
  }]]);
  const gesendet: Instruction[][] = [];
  const uhr = { jetzt: JETZT };
  const opts = {
    provider,
    lese: async (a: string) => kette.get(a) ?? null,
    sende: async (ixs: Instruction[]) => { gesendet.push(ixs); return "sig" + gesendet.length; },
    jetzt: () => uhr.jetzt,
  };
  const g = (betrag: bigint, schluessel = sitzung.geheim) => signiereGutschrift(schluessel, kanal, betrag, ablauf);
  return { sitzung, kanal, ablauf, kette, gesendet, uhr, opts, g };
}

test("Annahme: nur Konten des Kanal-Programms, für diesen Provider, mit genug Laufzeit", async () => {
  const a = aufbau();
  assert.deepEqual(await new KanalKasse(a.opts).nimmAn(a.g(100n), 50n), { ok: true, empfaenger });
  const fremd = aufbau({ owner: Keypair.generate().publicKey.toBase58() });
  assert.deepEqual(await new KanalKasse(fremd.opts).nimmAn(fremd.g(100n), 50n), { ok: false, grund: "Konto gehört nicht dem Kanal-Programm" });
  const anderer = aufbau({ anderer: Keypair.generate().publicKey.toBase58() });
  assert.deepEqual(await new KanalKasse(anderer.opts).nimmAn(anderer.g(100n), 50n), { ok: false, grund: "Kanal für einen anderen Provider" });
  const kurz = aufbau({ laufzeit: 600 });
  assert.deepEqual(await new KanalKasse(kurz.opts).nimmAn(kurz.g(100n), 50n), { ok: false, grund: "Kanal läuft zu bald ab" });
  const k = new KanalKasse(a.opts);
  assert.deepEqual(await k.nimmAn({ ...a.g(100n), kanal: kanalAdresse(kunde, provider, 999n).adresse }, 50n), { ok: false, grund: "Kanal nicht gefunden" });
});

test("Gutschrift: gültig signiert, steigend, bis zur Einlage – und sie muss Abgerechnetes plus Gebot decken", async () => {
  const a = aufbau();
  const k = new KanalKasse(a.opts);
  assert.deepEqual(await k.nimmAn(a.g(100n, neuerSitzungsSchluessel().geheim), 50n), { ok: false, grund: "Signatur ungültig" });
  assert.deepEqual(await k.nimmAn(a.g(40n), 50n), { ok: false, grund: "Gutschrift deckt das Gebot nicht" });
  assert.deepEqual(await k.nimmAn(a.g(1_000_001n), 50n), { ok: false, grund: "mehr als die Einlage" });
  assert.equal((await k.nimmAn(a.g(100n), 50n)).ok, true);
  assert.equal(k.verbuche(a.kanal, 30n), 30n);
  // Dieselbe Gutschrift noch einmal: reicht, solange 70 frei sind
  assert.equal((await k.nimmAn(a.g(100n), 60n)).ok, true);
  assert.deepEqual(await k.nimmAn(a.g(100n), 80n), { ok: false, grund: "Gutschrift deckt das Gebot nicht" });
  // Eine niedrigere nach einer höheren nie
  assert.deepEqual(await k.nimmAn(a.g(90n), 10n), { ok: false, grund: "nicht mehr als die letzte Gutschrift" });
  assert.equal((await k.nimmAn(a.g(200n), 150n)).ok, true);
  // Gebucht wird höchstens bis zur Gutschrift
  assert.equal(k.verbuche(a.kanal, 500n), 170n);
  assert.equal(k.eintrag(a.kanal)!.abgerechnet, "200");
  assert.equal(k.verbuche(a.kanal, 1n), 0n);
});

test("Aufgestockt: eine Gutschrift über der bekannten Einlage liest den Kanal neu", async () => {
  const a = aufbau({ eingezahlt: 1_000n });
  const k = new KanalKasse(a.opts);
  assert.equal((await k.nimmAn(a.g(500n), 100n)).ok, true);
  assert.deepEqual(await k.nimmAn(a.g(1_500n), 100n), { ok: false, grund: "mehr als die Einlage" });
  a.kette.set(a.kanal, { owner: KANAL_PROGRAMM_ID, daten: konto({ sitzung: a.sitzung.oeffentlich, eingezahlt: 2_000n, ablauf: a.ablauf, nonce: 0n }) });
  // Der Kunde hat aufgestockt – die Nonce im Konto ist hier egal, die Adresse bleibt
  assert.equal((await k.nimmAn(a.g(1_500n), 100n)).ok, true);
  assert.equal(k.eintrag(a.kanal)!.eingezahlt, "2000");
});

test("Einlösen: ab der Schwelle oder kurz vor Ablauf, mit Ed25519-Anweisung und Empfängern; nie zweimal", async () => {
  const a = aufbau({ eingezahlt: 50_000_000n });
  const k = new KanalKasse({ ...a.opts, einloesSchwelle: 1_000n });
  assert.equal((await k.nimmAn(a.g(500n), 100n)).ok, true);
  assert.deepEqual(await k.loeseFaelligeEin(), [], "unter der Schwelle und weit vor Ablauf: warten");
  assert.equal((await k.nimmAn(a.g(1_200n), 100n)).ok, true);
  const r = await k.loeseFaelligeEin();
  assert.deepEqual(r, [{ kanal: a.kanal, betrag: 1_200n, signatur: "sig1" }]);
  const [ed, settle] = a.gesendet[0]!;
  assert.equal(ed!.programAddress, ED25519_PROGRAMM);
  assert.equal(settle!.programAddress, KANAL_PROGRAMM_ID);
  assert.equal(Buffer.from(settle!.data!).readBigUInt64LE(8), 1_200n);
  assert.deepEqual(settle!.accounts!.slice(3).map((x) => x.address), empfaenger.map((e) => e.adresse));
  assert.deepEqual(await k.loeseFaelligeEin(), [], "schon eingelöst");
  // Kurz vor Ablauf wird auch ein kleiner Rest eingelöst
  assert.equal((await k.nimmAn(a.g(1_300n), 50n)).ok, true);
  a.uhr.jetzt = Number(a.ablauf) - 1_000;
  assert.deepEqual(await k.loeseFaelligeEin(), [{ kanal: a.kanal, betrag: 1_300n, signatur: "sig2" }]);
  assert.equal(EINLOES_SCHWELLE, 10_000_000n, "Standard: 0,01 SOL");
});

test("Scheitert das Senden, bleibt die Gutschrift offen (nur der Fehlername); abgelaufen fällt sie weg – gemeldet", async () => {
  const a = aufbau();
  let versuche = 0;
  const k = new KanalKasse({
    ...a.opts, einloesSchwelle: 1n,
    sende: async () => { versuche++; throw Object.assign(new Error("RPC sagt: interne Adresse 10.0.0.1"), { name: "SendTransactionError" }); },
  });
  assert.equal((await k.nimmAn(a.g(700n), 100n)).ok, true);
  assert.deepEqual(await k.loeseFaelligeEin(), [{ kanal: a.kanal, betrag: 700n, fehler: "SendTransactionError" }]);
  assert.equal(k.eintrag(a.kanal)!.eingeloest, "0");
  a.uhr.jetzt = Number(a.ablauf) - 60;
  assert.deepEqual(await k.loeseFaelligeEin(), [{ kanal: a.kanal, betrag: 700n, fehler: "abgelaufen – nicht eingelöst" }]);
  assert.equal(versuche, 1, "zu spät wird nicht mehr gesendet");
  assert.equal(k.eintrag(a.kanal), undefined);
});

test("Neustart: Gutschriften und Buchungen liegen in der Datei und kommen zurück", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanal-kasse-"));
  try {
    const pfad = join(dir, "kanaele.json");
    const a = aufbau();
    const k1 = new KanalKasse({ ...a.opts, speicher: kanalSpeicher(pfad) });
    assert.equal((await k1.nimmAn(a.g(900n), 100n)).ok, true);
    k1.verbuche(a.kanal, 250n);
    const roh = JSON.parse(readFileSync(pfad, "utf8"));
    assert.equal(roh[0].beste.betrag, "900");
    const k2 = new KanalKasse({ ...a.opts, speicher: kanalSpeicher(pfad) });
    assert.deepEqual(k2.eintrag(a.kanal), k1.eintrag(a.kanal));
    assert.deepEqual(await k2.nimmAn(a.g(800n), 1n), { ok: false, grund: "nicht mehr als die letzte Gutschrift" });
    assert.deepEqual(await k2.nimmAn(a.g(900n), 700n), { ok: false, grund: "Gutschrift deckt das Gebot nicht" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("4.3c2: Kasse nur mit ZAHLKANAL=1 und einem Schlüssel, der zu NODE_SOL_ADDRESS passt; verdrahtet in main.ts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanal-umgebung-"));
  try {
    const schluessel = Keypair.generate();
    const pfad = join(dir, "id.json");
    writeFileSync(pfad, JSON.stringify([...schluessel.secretKey]));
    const o = { rpcUrl: "http://127.0.0.1:1", datei: join(dir, "kanaele.json"), standardSchluessel: join(dir, "fehlt.json") };
    const adresse = schluessel.publicKey.toBase58();
    assert.deepEqual(await kanalKasseAusUmgebung({ NODE_SOL_ADDRESS: adresse, SOLANA_KEYPAIR: pfad }, o), { grund: "aus (ZAHLKANAL=1 setzen)", fall: "aus" });
    assert.deepEqual(await kanalKasseAusUmgebung({ ZAHLKANAL: "1", SOLANA_KEYPAIR: pfad }, o), { grund: "NODE_SOL_ADDRESS fehlt", fall: "adresseFehlt" });
    const unlesbar = await kanalKasseAusUmgebung({ ZAHLKANAL: "1", NODE_SOL_ADDRESS: adresse }, o);
    assert.match(unlesbar.grund!, /nicht lesbar/);
    assert.equal(unlesbar.fall, "schluesselUnlesbar", "Kennung für den Status (B-11c)");
    assert.deepEqual(await kanalKasseAusUmgebung({ ZAHLKANAL: "1", NODE_SOL_ADDRESS: Keypair.generate().publicKey.toBase58(), SOLANA_KEYPAIR: pfad }, o),
      { grund: "Schlüssel aus SOLANA_KEYPAIR passt nicht zu NODE_SOL_ADDRESS", fall: "schluesselPasstNicht" });
    const r = await kanalKasseAusUmgebung({ ZAHLKANAL: "1", NODE_SOL_ADDRESS: adresse, SOLANA_KEYPAIR: pfad, KANAL_EINLOES_SCHWELLE_LAMPORTS: "5000" }, o);
    assert.ok(r.kasse instanceof KanalKasse);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /const \{ kasse: kanalKasse, grund: kanalGrund(?:, [a-zA-Z]+(?:: [a-zA-Z]+)?)* \} = await kanalKasseAusUmgebung\(process\.env, \{/);
  assert.match(main, /solanaAddress: process\.env\.NODE_SOL_ADDRESS \|\| undefined,\s*kanalKasse,/, "an den Provider");
  assert.match(main, /kanal: kanalKasse && process\.env\.NODE_SOL_ADDRESS \? \{ adresse: process\.env\.NODE_SOL_ADDRESS, programm: KANAL_PROGRAMM_ID \} : undefined,/, "Angebot nur mit Kasse");
  assert.match(main, /kanalKasse\.loeseFaelligeEin\(\)/, "Einlösen im Takt");
});

test("A-21e1: Kasse und Auszahlung aus der Umgebung über kit – Kanal lesen, als Provider einlösen, Rest an die eigene Adresse", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanal-kit-"));
  const schluessel = Keypair.generate();
  const ich = schluessel.publicKey.toBase58();
  const payout = Keypair.generate().publicKey.toBase58();
  const sitzung = neuerSitzungsSchluessel();
  const nonce = 42n;
  const kanal = kanalAdresse(kunde, ich, nonce).adresse;
  // Frist einmal aus der Uhr: Kasse und Konto rechnen mit derselben
  const ablauf = BigInt(Math.floor(Date.now() / 1000) + 2 * 86_400);
  const kette = await ketteAufPort({
    konten: new Map([
      [kanal, { owner: KANAL_PROGRAMM_ID, data: konto({ sitzung: sitzung.oeffentlich, eingezahlt: 1_000_000n, ablauf, provider: ich, nonce }) }],
      [ich, { owner: SYSTEM_PROGRAMM, lamports: RUECKLAGE + 300_000_000n }],
    ]),
  });
  try {
    const pfad = join(dir, "id.json");
    writeFileSync(pfad, JSON.stringify([...schluessel.secretKey]));
    const r = await kanalKasseAusUmgebung({
      ZAHLKANAL: "1", NODE_SOL_ADDRESS: ich, SOLANA_KEYPAIR: pfad, KANAL_EINLOES_SCHWELLE_LAMPORTS: "1", NODE_SOL_PAYOUT: payout,
    }, { rpcUrl: kette.url, datei: join(dir, "kanaele.json"), standardSchluessel: join(dir, "fehlt.json") });
    assert.ok(r.kasse && r.auszahlung, r.grund ?? r.auszahlungGrund ?? "");

    // Annehmen liest den Kanal über den Pool
    assert.equal((await r.kasse.nimmAn(signiereGutschrift(sitzung.geheim, kanal, 700n, ablauf), 100n)).ok, true);
    assert.deepEqual(kette.anfragen.map((x) => [x.method, x.params[0]]), [["getAccountInfo", kanal]]);

    // Einlösen: signiert als Provider, gesendet mit Vorabsimulation, dann bestätigt
    const [ein] = await r.kasse.loeseFaelligeEin();
    assert.equal(ein!.betrag, 700n);
    assert.equal(ein!.fehler, undefined);
    assert.equal(kette.gesendet.length, 1);
    const tx = ausDraht(kette.gesendet[0]!);
    const n = leseNachricht(tx);
    assert.equal(n.zahler, ich);
    assert.equal(n.lebensdauer, ATTRAPPE_BLOCKHASH);
    assert.deepEqual(n.anweisungen.map((x) => x.programm), [ED25519_PROGRAMM, KANAL_PROGRAMM_ID]);
    assert.equal(Buffer.from(n.anweisungen[1]!.daten).readBigUInt64LE(8), 700n);
    assert.ok(ed25519.verify(tx.signatures[ich as never]!, Uint8Array.from(tx.messageBytes), schluessel.publicKey.toBytes()), "der Schlüssel des Knotens");
    const senden = kette.anfragen.find((x) => x.method === "sendTransaction")!;
    assert.deepEqual(senden.params[1], { encoding: "base64", preflightCommitment: "confirmed" });
    assert.ok(!JSON.stringify(kette.anfragen).includes("skipPreflight"));
    assert.equal(r.kasse.eintrag(kanal)!.eingeloest, "700");

    // Auszahlung: Guthaben über der Rücklage an NODE_SOL_PAYOUT, kein Programm
    const aus = await r.auszahlung.pruefe();
    assert.ok(aus && "signatur" in aus, JSON.stringify(aus, (_k, v) => (typeof v === "bigint" ? String(v) : v)));
    assert.equal(aus.betrag, 300_000_000n);
    const ueber = leseNachricht(ausDraht(kette.gesendet[1]!));
    assert.equal(ueber.zahler, ich);
    assert.equal(ueber.anweisungen[0]!.programm, SYSTEM_PROGRAMM);
    assert.deepEqual(ueber.anweisungen[0]!.konten.map((k) => k.adresse), [ich, payout]);
    assert.equal(Buffer.from(ueber.anweisungen[0]!.daten).readBigUInt64LE(4), 300_000_000n, "die Rücklage bleibt");
    assert.ok(kette.anfragen.some((x) => x.method === "getAccountInfo" && x.params[0] === payout), "erst gefragt, ob das Ziel ein Programm ist");
  } finally {
    await kette.schliesse();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A-21e1: lehnt die Kette die Einlösung ab, bleibt die Gutschrift offen – nach außen nur der Fehlername", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanal-kit-"));
  const schluessel = Keypair.generate();
  const ich = schluessel.publicKey.toBase58();
  const sitzung = neuerSitzungsSchluessel();
  const kanal = kanalAdresse(kunde, ich, 7n).adresse;
  const ablauf = BigInt(Math.floor(Date.now() / 1000) + 2 * 86_400);
  const kette = await ketteAufPort({
    konten: new Map([[kanal, { owner: KANAL_PROGRAMM_ID, data: konto({ sitzung: sitzung.oeffentlich, eingezahlt: 1_000_000n, ablauf, provider: ich, nonce: 7n }) }]]),
    fehler: { InstructionError: [1, { Custom: 6003 }] },
  });
  try {
    const pfad = join(dir, "id.json");
    writeFileSync(pfad, JSON.stringify([...schluessel.secretKey]));
    const r = await kanalKasseAusUmgebung({ ZAHLKANAL: "1", NODE_SOL_ADDRESS: ich, SOLANA_KEYPAIR: pfad, KANAL_EINLOES_SCHWELLE_LAMPORTS: "1" },
      { rpcUrl: kette.url, datei: join(dir, "kanaele.json"), standardSchluessel: pfad });
    assert.equal((await r.kasse!.nimmAn(signiereGutschrift(sitzung.geheim, kanal, 500n, ablauf), 100n)).ok, true);
    assert.deepEqual(await r.kasse!.loeseFaelligeEin(), [{ kanal, betrag: 500n, fehler: "Error" }]);
    assert.equal(r.kasse!.eintrag(kanal)!.eingeloest, "0", "bleibt offen für den nächsten Takt");
  } finally {
    await kette.schliesse();
    rmSync(dir, { recursive: true, force: true });
  }
});
