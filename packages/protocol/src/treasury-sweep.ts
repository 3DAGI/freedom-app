/**
 * Treasury-Sweep: Automatische Weiterleitung von Wochen-Wallets zur Haupt-Wallet.
 *
 * Läuft als Interval auf dem Treasury-Node (oder JEDER Node mit dem Master-Secret).
 * Für jede vergangene + aktuelle Woche:
 *   1. Woche-Wallet aus Master ableiten
 *   2. SOL-Balance via RPC prüfen
 *   3. Bei Balance > Schwelle: Transfer zur Haupt-Wallet (Fee-Payer = Wochen-Wallet)
 *   4. Wiederholen bis Balance < Schwelle (Staub bleibt liegen, egal)
 *
 * AUSFALLSICHERHEIT: Der Sweep ist idempotent — verpasste Wochen werden beim
 * nächsten Lauf nachgeholt. Selbst nach monatelangem Ausfall: Ein einziger
 * Lauf mit dem Backup-Master holt ALLES nach (auf jedem beliebigen Gerät).
 */
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { deriveWeekRecipient } from "./treasury.js";

export interface SweepConfig {
  /** Treasury-Master-Secret (hex) — ableitbar aus dem Offline-Backup! */
  masterSecretHex: string;
  /** Ziel-Haupt-Wallet (Hardware-Wallet, geheim). */
  targetWalletBase58: string;
  /** Solana-RPC. */
  rpcUrl?: string;
  /** Wochen zurück rekonstruieren (verpasste sweeps nachholen). */
  lookbackWeeks?: number;
  /** Mindestbalance in Lamports zum Sweepen (unterhalb: Staub). */
  minBalanceLamports?: number;
}

export interface SweepResult {
  week: number;
  address: string;
  balanceLamports: number;
  swept: boolean;
  signature?: string;
  error?: string;
}

/** Sweept alle Wochen-Wallets im Lookback-Fenster zur Haupt-Wallet. */
export async function sweepAllWeeks(cfg: SweepConfig): Promise<SweepResult[]> {
  // Kein fest verdrahteter Anbieter: Der Pool waehlt einen erreichbaren
  // Endpunkt und weicht bei Ausfall aus.
  const { RpcPool, DEFAULT_MAINNET_RPCS } = await import("./rpc-pool.js");
  const rpcUrl = cfg.rpcUrl ?? new RpcPool(DEFAULT_MAINNET_RPCS).bestUrl();
  const connection = new Connection(rpcUrl, "confirmed");
  const target = new PublicKey(cfg.targetWalletBase58);
  const currentWeek = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  const lookback = cfg.lookbackWeeks ?? 12; // 3 Monate rückwirkend
  // Staub-Schwelle absolut in LAMPORTS (500_000 ≈ 0,0005 SOL). Die frühere
  // Fassung hatte hier zwei konkurrierende Berechnungen stehen, von denen eine
  // ungenutzt blieb und die andere msat mit lamports verwechselte.
  const threshold = cfg.minBalanceLamports ?? 500_000;

  const results: SweepResult[] = [];

  for (let week = currentWeek - lookback; week <= currentWeek; week++) {
    const recipient = deriveWeekRecipient(cfg.masterSecretHex, week);
    // KRITISCHER FIX: Das Keypair wurde vorher aus recipient.pubkeyHex
    // abgeleitet — also aus dem OEFFENTLICHEN Schluessel. Das ergibt ein
    // Keypair, das die Zieladresse gar nicht kontrolliert; jede Signatur war
    // ungueltig und der Sweep konnte nie Geld bewegen. Richtig ist der Seed.
    const keypair = Keypair.fromSeed(recipient.seed);
    const pub = keypair.publicKey;

    // Sicherheitsnetz: abgeleitete Adresse und Keypair muessen uebereinstimmen.
    if (pub.toBase58() !== recipient.address) {
      results.push({
        week,
        address: recipient.short,
        balanceLamports: -1,
        swept: false,
        error: "adresse passt nicht zum abgeleiteten keypair",
      });
      continue;
    }

    let balance: number;
    try {
      balance = await connection.getBalance(pub, "confirmed");
    } catch (e) {
      results.push({ week, address: recipient.short, balanceLamports: -1, swept: false, error: `rpc: ${(e as Error).message.slice(0, 60)}` });
      continue;
    }

    if (balance <= threshold) {
      results.push({ week, address: recipient.short, balanceLamports: balance, swept: false });
      continue;
    }

    try {
      // Fee für die Transfer-Transaction: ~5000 lamports. Rest geht an Target.
      const transferAmount = balance - 10_000;
      if (transferAmount <= 0) {
        results.push({ week, address: recipient.short, balanceLamports: balance, swept: false, error: "balance < fee" });
        continue;
      }
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: pub,
          toPubkey: target,
          lamports: transferAmount,
        }),
      );
      tx.feePayer = pub;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.sign(keypair);
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      results.push({ week, address: recipient.short, balanceLamports: balance, swept: true, signature: sig });
    } catch (e) {
      results.push({ week, address: recipient.short, balanceLamports: balance, swept: false, error: (e as Error).message.slice(0, 80) });
    }
  }
  return results;
}

/** Einmal-Lauf (für cron/systemd-timer). Gibt Zusammenfassung für Logs. */
export async function runSweepOnce(cfg: SweepConfig): Promise<string> {
  const results = await sweepAllWeeks(cfg);
  const swept = results.filter((r) => r.swept);
  const totalLamports = swept.reduce((s, r) => s + r.balanceLamports, 0);
  return `[treasury-sweep] ${results.length} wochen geprüft, ${swept.length} gesweept (${totalLamports} lamports), fehler: ${results.filter(r => r.error).length}`;
}
