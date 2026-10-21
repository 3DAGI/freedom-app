/**
 * Das HTLC-Programm gegen einen lokalen Validator, mit dem Adapter aus
 * `packages/protocol/src/solana-adapter.ts` – so, wie LP und Kunde es nutzen (A-28a).
 *
 * Beweist:
 *  - `zurueckgeben` (A-28): Der Empfänger gibt eine offene Sperre vor Ablauf zurück –
 *    Betrag und Miete gehen an den Sperrenden, auf den Lamport; danach ist nichts mehr da
 *  - nur der Empfänger, nur an den Sperrenden: ein Fremder, der Sperrende selbst und ein
 *    Empfänger, der das Geld an sich umleiten will, scheitern; die Sperre bleibt, wie sie war
 *  - nach dem Einlösen gibt es nichts zurückzugeben; Einlösen und Rückholen wie bisher
 *    (Rückholen erst nach Ablauf)
 *
 * Braucht `solana-test-validator` im PATH und das gebaute Programm
 * (`target/deploy/solana_htlc.so`) – beides macht `pruefen.sh`. Fehlt eines,
 * werden die Tests mit Grund übersprungen, nie still grün.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { hashlock } from "../../../packages/protocol/src/htlc.js";
import { programmFehlerCode } from "../../../packages/protocol/src/kit-rpc.js";
import { solSchluesselAus } from "../../../packages/protocol/src/kit-transaktion.js";
import { AnchorSolanaHtlc, HTLC_PROGRAMM_ID } from "../../../packages/protocol/src/solana-adapter.js";

const SO = fileURLToPath(new URL("../target/deploy/solana_htlc.so", import.meta.url));
const hatValidator = spawnSync("solana-test-validator", ["--version"]).status === 0;
const skip = !hatValidator ? "solana-test-validator fehlt (pruefen.sh)" : !existsSync(SO) ? "Programm nicht gebaut (pruefen.sh)" : false;
// pruefen.sh (und damit die CI) verlangt die Tests: Dort ist Überspringen ein Fehler.
if (skip && process.env.HTLC_TESTS_PFLICHT === "1") throw new Error(`HTLC-Tests nicht ausführbar: ${skip}`);
if (process.env.HTLC_PROGRAM_ID) throw new Error("HTLC_PROGRAM_ID ist gesetzt – die Tests gelten für das Programm aus dem Code");

const PORT = 20_000 + Math.floor(Math.random() * 200) * 50;
let validator: ChildProcess | undefined;
let ledger = "";
let conn: Connection;
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

/** Wartet auf `p`, solange der Validator läuft – stirbt er, scheitert der Test sofort mit dem Ende seines Logs. */
function solangeValidator<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, validatorWeg]);
}

// Anchor-Fehlercodes: 6000 + Stelle im Enum HtlcError; 3012 = AccountNotInitialized (Konto geschlossen)
const F = { AlreadyClosed: 6002, WrongRecipient: 6004, WrongInitiator: 6005, TimelockNotExpired: 6006, KontoWeg: 3012 } as const;

async function scheitert(p: Promise<unknown>, code: number): Promise<void> {
  await assert.rejects(solangeValidator(p), (e: unknown) => {
    assert.equal(programmFehlerCode(e), code, `erwartet Fehler ${code}, bekam: ${String((e as Error).message).slice(0, 300)}`);
    return true;
  });
}

async function neuesKonto(sol = 2): Promise<Keypair> {
  const k = Keypair.generate();
  await solangeValidator(conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, sol * LAMPORTS_PER_SOL), "confirmed"));
  return k;
}

const lamports = async (a: string | PublicKey) => BigInt(await conn.getBalance(new PublicKey(a), "confirmed"));
const adapter = (k: Keypair) => new AnchorSolanaHtlc({ rpcUrl: `http://127.0.0.1:${PORT}`, schluessel: solSchluesselAus(k.secretKey) });

async function kettenzeit(): Promise<number> {
  return (await conn.getBlockTime(await conn.getSlot("confirmed"))) ?? Math.floor(Date.now() / 1000);
}

/** Der Kunde sperrt für den LP (Richtung SOL → Lightning, 4.6): Initiator Kunde, Empfänger LP. */
async function sperre(kunde: Keypair, lp: Keypair, o: { frist?: number; lamports?: number } = {}) {
  const swapId = randomBytes(16).toString("hex");
  const preimage = randomBytes(32);
  const lock = {
    swapId, hashlock: hashlock(preimage), amountLamports: o.lamports ?? 300_000_000, timelockUnix: o.frist ?? (await kettenzeit()) + 3600,
    recipient: lp.publicKey.toBase58(), initiator: kunde.publicKey.toBase58(),
  };
  await solangeValidator(adapter(kunde).lock(lock));
  return { swapId, preimage, pda: AnchorSolanaHtlc.deriveSwapPda(swapId).pda, lock };
}

before(async () => {
  if (skip) return;
  ledger = mkdtempSync(join(tmpdir(), "htlc-ledger-"));
  validator = spawn("solana-test-validator", [
    "--reset", "--quiet", "--ledger", ledger, "--rpc-port", String(PORT), "--faucet-port", String(PORT + 2),
    "--dynamic-port-range", `${PORT + 3}-${PORT + 40}`, "--bpf-program", HTLC_PROGRAMM_ID, SO,
  ], { stdio: "ignore" });
  validatorWeg = new Promise<never>((_, weg) => {
    validator!.on("exit", (code, signal) => {
      if (!beendet) weg(new Error(`Validator vorzeitig beendet (Code ${code}, Signal ${signal}):\n${validatorLog()}`));
    });
  });
  validatorWeg.catch(() => {});
  conn = new Connection(`http://127.0.0.1:${PORT}`, "confirmed");
  for (let i = 0; i < 120; i++) {
    try { await conn.getVersion(); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
});

after(() => {
  // Wie beim Zahlkanal: Der Websocket von web3.js verbindet sonst endlos neu
  const ws = (conn as unknown as { _rpcWebSocket?: { setAutoReconnect(an: boolean): void; close(): void } } | undefined)?._rpcWebSocket;
  ws?.setAutoReconnect(false);
  ws?.close();
  beendet = true;
  validator?.kill("SIGKILL");
  if (ledger) rmSync(ledger, { recursive: true, force: true });
});

test("A-28: zurueckgeben – der Empfänger gibt vor Ablauf zurück, Betrag und Miete an den Sperrenden, nur einmal", { skip }, async () => {
  const kunde = await neuesKonto(), lp = await neuesKonto(1);
  const s = await sperre(kunde, lp);
  const imKonto = await lamports(s.pda);
  assert.ok(imKonto > BigInt(s.lock.amountLamports), "Betrag samt Miete in der Sperre");
  const vorher = await lamports(kunde.publicKey), lpVorher = await lamports(lp.publicKey);
  await solangeValidator(adapter(lp).zurueckgeben(s.swapId, kunde.publicKey.toBase58()));
  assert.equal(await lamports(kunde.publicKey) - vorher, imKonto, "alles zurück an den Kunden, auf den Lamport");
  assert.ok(lpVorher - (await lamports(lp.publicKey)) <= 10_000n, "der LP zahlt nur die Gebühr");
  assert.equal(await adapter(kunde).get(s.swapId), undefined, "die Sperre ist geschlossen");
  await scheitert(adapter(lp).zurueckgeben(s.swapId, kunde.publicKey.toBase58()), F.KontoWeg);
});

test("A-28: zurueckgeben nur durch den Empfänger und nur an den Sperrenden – sonst bleibt die Sperre", { skip }, async () => {
  const kunde = await neuesKonto(), lp = await neuesKonto(1), fremd = await neuesKonto(1);
  const s = await sperre(kunde, lp);
  const imKonto = await lamports(s.pda);
  await scheitert(adapter(fremd).zurueckgeben(s.swapId, kunde.publicKey.toBase58()), F.WrongRecipient);
  await scheitert(adapter(kunde).zurueckgeben(s.swapId, kunde.publicKey.toBase58()), F.WrongRecipient);
  // Der LP will das Geld an sich selbst umleiten
  await scheitert(adapter(lp).zurueckgeben(s.swapId, lp.publicKey.toBase58()), F.WrongInitiator);
  assert.equal(await lamports(s.pda), imKonto);
  const offen = await adapter(kunde).get(s.swapId);
  assert.ok(offen && !offen.claimed && !offen.refunded);
});

test("A-28: nach dem Einlösen nichts mehr zurückzugeben; Einlösen und Rückholen wie bisher", { skip }, async () => {
  const kunde = await neuesKonto(), lp = await neuesKonto(1);
  const s = await sperre(kunde, lp);
  const lpVorher = await lamports(lp.publicKey);
  await solangeValidator(adapter(lp).claim(s.swapId, s.preimage, kunde.publicKey.toBase58()));
  assert.ok((await lamports(lp.publicKey)) - lpVorher >= BigInt(s.lock.amountLamports) - 10_000n, "der LP hat eingelöst");
  assert.deepEqual(await adapter(lp).getRevealedPreimage(s.swapId), new Uint8Array(s.preimage), "das Preimage steht auf der Kette");
  await scheitert(adapter(lp).zurueckgeben(s.swapId, kunde.publicKey.toBase58()), F.KontoWeg);

  // Rückholen erst nach Ablauf – dann alles an den Kunden
  const kurz = await sperre(kunde, lp, { frist: (await kettenzeit()) + 3 });
  await scheitert(adapter(kunde).refund(kurz.swapId), F.TimelockNotExpired);
  for (let i = 0; i < 60 && (await kettenzeit()) <= kurz.lock.timelockUnix; i++) await new Promise((r) => setTimeout(r, 500));
  const imKonto = await lamports(kurz.pda), vorher = await lamports(kunde.publicKey);
  await solangeValidator(adapter(kunde).refund(kurz.swapId));
  const zurueck = (await lamports(kunde.publicKey)) - vorher;
  assert.ok(zurueck <= imKonto && imKonto - zurueck <= 10_000n, "zurück an den Kunden, abzüglich seiner Gebühr");
  assert.equal(await adapter(kunde).get(kurz.swapId), undefined);
});
