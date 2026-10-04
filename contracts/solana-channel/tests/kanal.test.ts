/**
 * Schritt 4.3b: das Zahlkanal-Programm gegen einen lokalen Validator, mit dem
 * Client aus `packages/protocol/src/channel.ts` – beide folgen
 * `docs/ZAHLKANAL.md`. Die Tests der Karte: open; mehrere Gutschriften;
 * settle; zweites settle mit niedrigerem Betrag scheitert; settle nach Ablauf
 * scheitert; falsche Signatur scheitert; Gutschrift eines anderen Kanals
 * (Replay) scheitert; refund vor Ablauf scheitert, danach klappt er – seit Z1 ohne
 * Unterschrift des Kunden;
 * Aufteilung stimmt auf den Lamport.
 *
 * Braucht `solana-test-validator` im PATH und das gebaute Programm
 * (`target/deploy/solana_channel.so`) – beides macht `pruefen.sh`. Fehlt eines,
 * werden die Tests mit Grund übersprungen, nie still grün.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  KANAL_KONTO_BYTES, KANAL_PROGRAMM_ID, erstatteKanalIx, kanalAdresse, leseKanal, neuerSitzungsSchluessel,
  oeffneKanalIx, rechneKanalAbIxs, signiereGutschrift, stockeKanalAufIx, teileKanalZahlung,
  type Gutschrift, type KanalEmpfaenger,
} from "../../../packages/protocol/src/channel.js";
import { KanalKasse } from "../../../packages/node/src/kanal-kasse.js";

const SO = fileURLToPath(new URL("../target/deploy/solana_channel.so", import.meta.url));
const hatValidator = spawnSync("solana-test-validator", ["--version"]).status === 0;
const skip = !hatValidator ? "solana-test-validator fehlt (pruefen.sh)" : !existsSync(SO) ? "Programm nicht gebaut (pruefen.sh)" : false;
// pruefen.sh (und damit die CI) verlangt die Tests: Dort ist Überspringen ein Fehler.
if (skip && process.env.KANAL_TESTS_PFLICHT === "1") throw new Error(`Zahlkanal-Tests nicht ausführbar: ${skip}`);

const PORT = 20_000 + Math.floor(Math.random() * 200) * 50;
let validator: ChildProcess | undefined;
let ledger = "";
let conn: Connection;
// Endet der Validator vorzeitig, wartet web3.js auf Bestätigungen endlos (getBlockHeight
// scheitert, zählt als -1) – dann scheitern die Tests sofort, mit dem Ende seines Logs.
let validatorWeg: Promise<never> = new Promise(() => {});
let beendet = false;

function validatorLog(): string {
  try {
    const zeilen = readFileSync(join(ledger, "validator.log"), "utf8").trimEnd().split("\n");
    const fehler = zeilen.filter((z) => / (ERROR|WARN) |panicked/.test(z));
    return (fehler.length ? fehler : zeilen).slice(-15).join("\n");
  } catch {
    return "(kein validator.log)";
  }
}

/** Wartet auf `p`, solange der Validator läuft. */
function solangeValidator<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, validatorWeg]);
}
const zahler = Keypair.generate(); // zahlt alle Gebühren – so bleiben die Beträge der Beteiligten Lamport-genau

// Anchor-Fehlercodes (6000 + Stelle im Enum KanalFehler)
const F = {
  NullBetrag: 6000, Abgelaufen: 6001, NochNichtAbgelaufen: 6002, AnteileZuHoch: 6005, FalscherProvider: 6007,
  FalscherKunde: 6008, GutschriftFehlt: 6009, GutschriftUngueltig: 6010, FalscherSchluessel: 6011,
  NichtsAuszuzahlen: 6012, EmpfaengerFalsch: 6013,
} as const;

let lauf = 0;
async function schicke(ixs: TransactionInstruction[], signer: Keypair[]): Promise<string> {
  // Ed25519 signiert deterministisch: Ein zweiter Versuch mit derselben Gutschrift wäre
  // Byte für Byte dieselbe Transaktion. Ein eigenes Rechenlimit je Versuch macht sie verschieden.
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 + ++lauf }), ...ixs);
  tx.feePayer = zahler.publicKey;
  return solangeValidator(sendAndConfirmTransaction(conn, tx, [zahler, ...signer], { commitment: "confirmed" }));
}

async function scheitert(p: Promise<unknown>, code?: number): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    if (code === undefined) return true;
    const text = `${(e as Error).message} ${JSON.stringify((e as { logs?: unknown }).logs ?? "")}`;
    assert.ok(text.includes(`0x${code.toString(16)}`), `erwartet Fehler ${code}, bekam: ${text.slice(0, 400)}`);
    return true;
  });
}

async function kettenzeit(): Promise<bigint> {
  const t = await conn.getBlockTime(await conn.getSlot("confirmed"));
  return BigInt(t ?? Math.floor(Date.now() / 1000));
}

async function warteBis(zeit: bigint): Promise<void> {
  for (let i = 0; i < 120 && (await kettenzeit()) <= zeit; i++) await new Promise((r) => setTimeout(r, 500));
}

async function neuesKonto(sol = 2): Promise<Keypair> {
  const k = Keypair.generate();
  await solangeValidator(conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, sol * LAMPORTS_PER_SOL), "confirmed"));
  return k;
}

const lamports = async (a: string | PublicKey) => BigInt(await conn.getBalance(new PublicKey(a), "confirmed"));
const kanal = async (a: string) => leseKanal((await conn.getAccountInfo(new PublicKey(a), "confirmed"))!.data);

before(async () => {
  if (skip) return;
  ledger = mkdtempSync(join(tmpdir(), "kanal-ledger-"));
  validator = spawn("solana-test-validator", [
    // RPC auf PORT, Websocket (Bestätigungen) auf PORT + 1 – Faucet und Rest dahinter
    "--reset", "--quiet", "--ledger", ledger, "--rpc-port", String(PORT), "--faucet-port", String(PORT + 2),
    "--dynamic-port-range", `${PORT + 3}-${PORT + 40}`, "--bpf-program", KANAL_PROGRAMM_ID, SO,
  ], { stdio: "ignore" });
  validatorWeg = new Promise<never>((_, weg) => {
    validator!.on("exit", (code, signal) => {
      if (!beendet) weg(new Error(`Validator vorzeitig beendet (Code ${code}, Signal ${signal}):\n${validatorLog()}`));
    });
  });
  validatorWeg.catch(() => {}); // wer nicht wartet, bekommt es nicht als unbehandelten Fehler
  conn = new Connection(`http://127.0.0.1:${PORT}`, "confirmed");
  for (let i = 0; i < 120; i++) {
    try { await conn.getVersion(); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  await solangeValidator(conn.confirmTransaction(await conn.requestAirdrop(zahler.publicKey, 10 * LAMPORTS_PER_SOL), "confirmed"));
});

after(() => {
  // Die Websocket-Verbindung der Bestätigungen verbindet sonst endlos neu (max_reconnects:
  // Infinity) – auch nach close(), wenn sie gerade verbindet oder web3.js für ein offenes
  // Abo neu aufbaut. Dann endet der Prozess nie (so lief der CI-Job von 4.3c1 bis zum Limit).
  const ws = (conn as unknown as { _rpcWebSocket?: { setAutoReconnect(an: boolean): void; close(): void } } | undefined)?._rpcWebSocket;
  ws?.setAutoReconnect(false);
  ws?.close();
  beendet = true;
  validator?.kill("SIGKILL");
  if (ledger) rmSync(ledger, { recursive: true, force: true });
});

interface Aufbau {
  kunde: Keypair; provider: Keypair; adresse: string; ablauf: bigint;
  sitzung: ReturnType<typeof neuerSitzungsSchluessel>; empfaenger: KanalEmpfaenger[];
}

async function oeffne(p: { nonce: bigint; betrag: bigint; laufzeit: bigint; empfaenger: KanalEmpfaenger[]; kunde?: Keypair; provider?: Keypair; sitzung?: Aufbau["sitzung"] }): Promise<Aufbau> {
  const kunde = p.kunde ?? await neuesKonto();
  const provider = p.provider ?? await neuesKonto(1); // ein leeres Konto bliebe unter der Mietbefreiung
  const sitzung = p.sitzung ?? neuerSitzungsSchluessel();
  const ablauf = (await kettenzeit()) + p.laufzeit;
  await schicke([oeffneKanalIx({
    kunde: kunde.publicKey.toBase58(), provider: provider.publicKey.toBase58(), nonce: p.nonce, betrag: p.betrag, ablauf,
    sitzungsSchluessel: sitzung.oeffentlich, empfaenger: p.empfaenger,
  })], [kunde]);
  const { adresse } = kanalAdresse(kunde.publicKey.toBase58(), provider.publicKey.toBase58(), p.nonce);
  return { kunde, provider, adresse, ablauf, sitzung, empfaenger: p.empfaenger };
}

const einloesen = (a: Aufbau, g: Gutschrift, empfaenger = a.empfaenger, provider = a.provider) =>
  schicke(rechneKanalAbIxs({ provider: provider.publicKey.toBase58(), gutschrift: g, sitzungsSchluessel: a.sitzung.oeffentlich, empfaenger }), [provider]);

// Gemeinsamer Kanal der ersten Tests: drei Empfänger, einer davon ein leeres Konto
let k1: Aufbau;
let entwicklung: Keypair, relay: Keypair;
const leer = Keypair.generate();

test("open: Einlage und Miete im Kanal, Konto nach Format; zu hohe Anteile, Betrag 0 und Ablauf in der Vergangenheit scheitern on-chain", { skip }, async () => {
  entwicklung = await neuesKonto(1);
  relay = await neuesKonto(1);
  const empfaenger = [
    { adresse: entwicklung.publicKey.toBase58(), ppm: 25_000 },
    { adresse: relay.publicKey.toBase58(), ppm: 15_000 },
    { adresse: leer.publicKey.toBase58(), ppm: 5_000 },
  ];
  k1 = await oeffne({ nonce: 1n, betrag: 1_000_000n, laufzeit: 3_600n, empfaenger });
  const miete = BigInt(await conn.getMinimumBalanceForRentExemption(KANAL_KONTO_BYTES));
  assert.equal(await lamports(k1.adresse), miete + 1_000_000n);
  const st = await kanal(k1.adresse);
  assert.equal(st.kunde, k1.kunde.publicKey.toBase58());
  assert.equal(st.provider, k1.provider.publicKey.toBase58());
  assert.equal(st.sitzungsSchluessel, k1.sitzung.oeffentlich);
  assert.deepEqual([st.nonce, st.eingezahlt, st.ausgezahlt, st.ablauf], [1n, 1_000_000n, 0n, k1.ablauf]);
  assert.deepEqual(st.empfaenger, empfaenger);

  // Am Client vorbei: das Programm prüft selbst
  const basis = () => oeffneKanalIx({
    kunde: k1.kunde.publicKey.toBase58(), provider: Keypair.generate().publicKey.toBase58(), nonce: 9n, betrag: 5n,
    ablauf: k1.ablauf, sitzungsSchluessel: k1.sitzung.oeffentlich, empfaenger: [{ adresse: relay.publicKey.toBase58(), ppm: 100_000 }],
  });
  const zuHoch = basis(); zuHoch.data.writeUInt32LE(100_001, 68 + 32);
  await scheitert(schicke([zuHoch], [k1.kunde]), F.AnteileZuHoch);
  const null_ = basis(); null_.data.writeBigUInt64LE(0n, 16);
  await scheitert(schicke([null_], [k1.kunde]), F.NullBetrag);
  const vorbei = basis(); vorbei.data.writeBigInt64LE((await kettenzeit()) - 10n, 24);
  await scheitert(schicke([vorbei], [k1.kunde]), F.Abgelaufen);
});

test("mehrere Gutschriften, settle mit der letzten: Aufteilung auf den Lamport; leeres Empfängerkonto → Anteil an den Provider", { skip }, async () => {
  const s = k1.sitzung.geheim;
  const gutschriften = [100_000n, 250_000n, 400_000n].map((b) => signiereGutschrift(s, k1.adresse, b, k1.ablauf));
  const vorher = await Promise.all([k1.provider.publicKey, entwicklung.publicKey, relay.publicKey, leer.publicKey, k1.adresse].map(lamports));
  await einloesen(k1, gutschriften[2]);
  const nachher = await Promise.all([k1.provider.publicKey, entwicklung.publicKey, relay.publicKey, leer.publicKey, k1.adresse].map(lamports));
  const erwartet = teileKanalZahlung(400_000n, k1.empfaenger);
  assert.deepEqual(erwartet.anteile, [10_000n, 6_000n, 2_000n]);
  assert.equal(nachher[1] - vorher[1], 10_000n, "Entwicklung");
  assert.equal(nachher[2] - vorher[2], 6_000n, "Relay");
  assert.equal(nachher[3], 0n, "leeres Konto bliebe unter der Mietbefreiung – nichts dorthin");
  assert.equal(nachher[0] - vorher[0], 384_000n, "Provider: Rest samt dem nicht zuordenbaren Anteil");
  assert.equal(vorher[4] - nachher[4], 400_000n, "genau die Gutschrift verlässt den Kanal");
  assert.equal((await kanal(k1.adresse)).ausgezahlt, 400_000n);
});

test("zweites settle mit gleichem oder niedrigerem Betrag scheitert; höhere zahlt nur die Differenz; Empfänger in falscher Reihenfolge scheitern", { skip }, async () => {
  const s = k1.sitzung.geheim;
  await scheitert(einloesen(k1, signiereGutschrift(s, k1.adresse, 250_000n, k1.ablauf)), F.NichtsAuszuzahlen);
  await scheitert(einloesen(k1, signiereGutschrift(s, k1.adresse, 400_000n, k1.ablauf)), F.NichtsAuszuzahlen);
  const g = signiereGutschrift(s, k1.adresse, 600_000n, k1.ablauf);
  await scheitert(einloesen(k1, g, [...k1.empfaenger].reverse()), F.EmpfaengerFalsch);
  await scheitert(einloesen(k1, g, k1.empfaenger.slice(0, 2)), F.EmpfaengerFalsch);
  const vorher = await lamports(k1.adresse);
  await einloesen(k1, g);
  assert.equal(vorher - (await lamports(k1.adresse)), 200_000n);
});

test("falsche Signatur, fremder Schlüssel, fehlende Ed25519-Anweisung, Gutschrift eines anderen Kanals (Replay) und fremder Provider scheitern", { skip }, async () => {
  const betrag = 700_000n;
  // Signiert mit einem anderen Schlüssel, aber als Sitzungsschlüssel ausgegeben: die Laufzeit verwirft die Signatur
  const falsch = signiereGutschrift(neuerSitzungsSchluessel().geheim, k1.adresse, betrag, k1.ablauf);
  await scheitert(einloesen(k1, falsch));
  // Gültig signiert von einem fremden Schlüssel: das Programm lehnt den Schlüssel ab
  const fremd = neuerSitzungsSchluessel();
  const g = signiereGutschrift(fremd.geheim, k1.adresse, betrag, k1.ablauf);
  await scheitert(schicke(rechneKanalAbIxs({ provider: k1.provider.publicKey.toBase58(), gutschrift: g, sitzungsSchluessel: fremd.oeffentlich, empfaenger: k1.empfaenger }), [k1.provider]), F.FalscherSchluessel);
  // Ohne Ed25519-Anweisung
  const echt = signiereGutschrift(k1.sitzung.geheim, k1.adresse, betrag, k1.ablauf);
  const [, nurSettle] = rechneKanalAbIxs({ provider: k1.provider.publicKey.toBase58(), gutschrift: echt, sitzungsSchluessel: k1.sitzung.oeffentlich, empfaenger: k1.empfaenger });
  await scheitert(schicke([nurSettle], [k1.provider]), F.GutschriftFehlt);
  // Replay: derselbe Sitzungsschlüssel, ein zweiter Kanal – dessen Gutschrift gilt hier nicht
  const k2 = await oeffne({ nonce: 2n, betrag: 1_000_000n, laufzeit: 3_600n, empfaenger: [], kunde: k1.kunde, provider: k1.provider, sitzung: k1.sitzung });
  const [edAnders] = rechneKanalAbIxs({ provider: k1.provider.publicKey.toBase58(), gutschrift: signiereGutschrift(k1.sitzung.geheim, k2.adresse, betrag, k2.ablauf), sitzungsSchluessel: k1.sitzung.oeffentlich, empfaenger: [] });
  await scheitert(schicke([edAnders, nurSettle], [k1.provider]), F.GutschriftUngueltig);
  // Nur der Provider des Kanals löst ein
  const dieb = await neuesKonto(1);
  await scheitert(einloesen(k1, echt, k1.empfaenger, dieb), F.FalscherProvider);
  // Die echte geht danach durch
  await einloesen(k1, echt);
  assert.equal((await kanal(k1.adresse)).ausgezahlt, betrag);
});

test("top_up: Einlage steigt; eine Gutschrift über der Einlage zahlt nur bis zur Einlage", { skip }, async () => {
  await schicke([stockeKanalAufIx({ kunde: k1.kunde.publicKey.toBase58(), kanal: k1.adresse, betrag: 500_000n })], [k1.kunde]);
  assert.equal((await kanal(k1.adresse)).eingezahlt, 1_500_000n);
  const vorher = await lamports(k1.adresse);
  await einloesen(k1, signiereGutschrift(k1.sitzung.geheim, k1.adresse, 9_000_000n, k1.ablauf));
  assert.equal(vorher - (await lamports(k1.adresse)), 800_000n, "1,5 Mio eingezahlt, 700.000 schon ausgezahlt");
  const st = await kanal(k1.adresse);
  assert.equal(st.ausgezahlt, 1_500_000n);
  await scheitert(schicke([stockeKanalAufIx({ kunde: k1.provider.publicKey.toBase58(), kanal: k1.adresse, betrag: 1n })], [k1.provider]), F.FalscherKunde);
});

test("refund vor Ablauf scheitert, settle nach Ablauf scheitert, refund danach – auch ohne Unterschrift des Kunden (Z1): Rest und Miete an den Kunden, Konto geschlossen", { skip }, async () => {
  const k3 = await oeffne({ nonce: 3n, betrag: 300_000n, laufzeit: 4n, empfaenger: [] });
  // Z1: Der Kunde unterschreibt nicht – die Gebühr zahlt der Zahler der Tests, das Geld geht an den Kunden
  const erstatten = (kunde = k3.kunde.publicKey) => schicke([erstatteKanalIx({ kunde: kunde.toBase58(), kanal: k3.adresse })], []);
  await scheitert(erstatten(), F.NochNichtAbgelaufen);
  const g = signiereGutschrift(k3.sitzung.geheim, k3.adresse, 100_000n, k3.ablauf);
  await warteBis(k3.ablauf);
  await scheitert(einloesen(k3, g), F.Abgelaufen);
  await scheitert(erstatten((await neuesKonto(1)).publicKey), F.FalscherKunde);
  const imKanal = await lamports(k3.adresse);
  const vorher = await lamports(k3.kunde.publicKey);
  await erstatten();
  assert.equal((await lamports(k3.kunde.publicKey)) - vorher, imKanal, "Einlage und Miete zurück, ohne Abzug – die Gebühr zahlte ein anderer");
  assert.equal(await conn.getAccountInfo(new PublicKey(k3.adresse), "confirmed"), null, "Konto geschlossen");
});

test("Kasse des Knotens (4.3c): nimmt Gutschriften an, bucht und löst sie gegen das Programm ein – Lamport-genau, nicht zweimal", { skip }, async () => {
  const provider = await neuesKonto(1);
  const werber = await neuesKonto(1);
  const empfaenger = [{ adresse: werber.publicKey.toBase58(), ppm: 25_000 }];
  const k = await oeffne({ nonce: 5n, betrag: 2_000_000n, laufzeit: 7_200n, empfaenger, provider });
  const kasse = new KanalKasse({
    provider: provider.publicKey.toBase58(),
    lese: async (a) => {
      const i = await conn.getAccountInfo(new PublicKey(a), "confirmed");
      return i ? { owner: i.owner.toBase58(), daten: i.data } : null;
    },
    sende: (ixs) => schicke(ixs, [provider]),
    einloesSchwelle: 1n,
  });
  const g = (b: bigint) => signiereGutschrift(k.sitzung.geheim, k.adresse, b, k.ablauf);
  assert.deepEqual(await kasse.nimmAn(g(300_000n), 200_000n), { ok: true, empfaenger });
  assert.equal(kasse.verbuche(k.adresse, 150_000n), 150_000n);
  assert.deepEqual(await kasse.nimmAn(g(500_000n), 300_000n), { ok: true, empfaenger });
  const vorher = await Promise.all([provider.publicKey, werber.publicKey].map(lamports));
  const r = await kasse.loeseFaelligeEin();
  assert.equal(r.length, 1);
  assert.ok(r[0].signatur && !r[0].fehler, `Einlösen: ${r[0].fehler ?? "ohne Signatur"}`);
  const nachher = await Promise.all([provider.publicKey, werber.publicKey].map(lamports));
  assert.equal(nachher[0] - vorher[0], 487_500n, "Provider: 97,5 %");
  assert.equal(nachher[1] - vorher[1], 12_500n, "Werber: 2,5 %");
  assert.equal((await kanal(k.adresse)).ausgezahlt, 500_000n);
  assert.deepEqual(await kasse.loeseFaelligeEin(), [], "schon eingelöst");
  // Eine fremde Kasse (anderer Provider) nimmt die Gutschrift nicht an
  const fremd = new KanalKasse({ provider: Keypair.generate().publicKey.toBase58(), lese: async (a) => {
    const i = await conn.getAccountInfo(new PublicKey(a), "confirmed");
    return i ? { owner: i.owner.toBase58(), daten: i.data } : null;
  }, sende: async () => "nie" });
  assert.deepEqual(await fremd.nimmAn(g(600_000n), 1n), { ok: false, grund: "Kanal für einen anderen Provider" });
});
