/**
 * Abnahme-Lauf des LP gegen Solana-Devnet und Lightning-Testnet (Schritt 8.3b)
 * – fuer den MENSCH, mit zwei eigenen LND-Knoten (LP und Kunde) und zwei
 * Devnet-Konten. Aufruf (Ablauf siehe docs/SWAPS.md, „Abnahme-Lauf“):
 *
 *   npm run lp-abnahme -- hin hin-ablauf rueck rueck-ablauf
 *
 * Nie Mainnet: Die Solana-Adresse muss Devnet, Testnet oder lokal sein, und eine
 * Probe-Rechnung des Kunden muss eine Testnet-, Signet- oder Regtest-Rechnung sein.
 * Der LP nutzt eine eingeschraenkte Macaroon wie im Betrieb (`pruefeLpMacaroon`).
 */
import { pathToFileURL } from "node:url";
import { SLOW_BLOCK_SECS } from "@freedomstack/protocol";
import { ALLE_FAELLE, abnahmeBericht, lpAbnahme, type Abnahme, type FallName } from "./lp-abnahme.js";

/** Wie die App (`RUECK_PUFFER_SECS` in app/src/rueck-swap.ts): Puffer fuer Bestaetigung und Weg. */
const RUECK_PUFFER_SECS = 1800;

export interface AbnahmeEinstellungen {
  rpc: string;
  lp: { rest: string; macaroon: string; solKeypair: string };
  kunde: { rest: string; macaroon: string; solKeypair: string };
  unsicheresTls: boolean;
  sats: number;
  lamportsPerSat: number;
  cltv: number;
  hinSperrSecs: number;
  faelle: FallName[];
}

/** Einstellungen aus der Umgebung – wirft mit allem, was fehlt oder nicht erlaubt ist. */
export function abnahmeEinstellungen(env: Record<string, string | undefined>, args: readonly string[] = []): AbnahmeEinstellungen {
  const fehlt = ["LND_LP_REST", "LND_LP_MACAROON", "LND_KUNDE_REST", "LND_KUNDE_MACAROON", "SOLANA_KEYPAIR_LP", "SOLANA_KEYPAIR_KUNDE"].filter((k) => !env[k]);
  if (fehlt.length > 0) throw new Error(`Es fehlt: ${fehlt.join(", ")}`);
  const rpc = env.SOLANA_RPC ?? "https://api.devnet.solana.com";
  if (!/devnet|testnet|localhost|127\.0\.0\.1/.test(rpc)) throw new Error(`SOLANA_RPC ${rpc}: nur Devnet, Testnet oder lokal – nie Mainnet`);
  const zahl = (k: string, standard: number, min: number) => {
    const n = Number(env[k] ?? standard);
    if (!Number.isSafeInteger(n) || n < min) throw new Error(`${k}=${env[k]}: ganze Zahl ab ${min}`);
    return n;
  };
  const faelle = args.length > 0 ? [...args] : [...ALLE_FAELLE];
  const unbekannt = faelle.filter((f) => !(ALLE_FAELLE as readonly string[]).includes(f));
  if (unbekannt.length > 0) throw new Error(`Unbekannte Faelle: ${unbekannt.join(", ")} (erlaubt: ${ALLE_FAELLE.join(", ")})`);
  return {
    rpc,
    lp: { rest: env.LND_LP_REST!, macaroon: env.LND_LP_MACAROON!, solKeypair: env.SOLANA_KEYPAIR_LP! },
    kunde: { rest: env.LND_KUNDE_REST!, macaroon: env.LND_KUNDE_MACAROON!, solKeypair: env.SOLANA_KEYPAIR_KUNDE! },
    unsicheresTls: env.LND_INSECURE_TLS === "1",
    sats: zahl("ABNAHME_SATS", 10_000, 1),
    lamportsPerSat: zahl("ABNAHME_LAMPORTS_PER_SAT", 100, 1),
    cltv: zahl("ABNAHME_CLTV", 144, 18),
    hinSperrSecs: zahl("ABNAHME_HIN_SPERRE", 600, 60),
    faelle: faelle as FallName[],
  };
}

/** Testnet, Signet oder Regtest – eine Mainnet-Rechnung (lnbc…) bricht den Lauf ab. */
export function istTestnetRechnung(bolt11: string): boolean {
  return /^ln(tb|tbs|bcrt|sb)\d*/i.test(bolt11.trim());
}

export async function starteAbnahme(e: AbnahmeEinstellungen, log = (z: string) => console.log(z)): Promise<boolean> {
  const { AnchorSolanaHtlc, LndLightningAdapter, loadMacaroonHex, loadSolanaKeypair, pruefeLpMacaroon } = await import("@freedomstack/protocol");
  const lpMacaroon = await loadMacaroonHex(e.lp.macaroon);
  const mac = pruefeLpMacaroon(lpMacaroon);
  if (!mac.ok) throw new Error(`LND_LP_MACAROON: ${mac.grund} – wie im Betrieb nur eine eingeschraenkte (docs/SWAPS.md)`);
  const lpKp = await loadSolanaKeypair(e.lp.solKeypair);
  const kundeKp = await loadSolanaKeypair(e.kunde.solKeypair);
  const kundeLn = new LndLightningAdapter({ restUrl: e.kunde.rest, macaroonHex: await loadMacaroonHex(e.kunde.macaroon), allowInsecureTls: e.unsicheresTls });
  const probe = await kundeLn.createInvoice(1);
  await kundeLn.cancelHoldInvoice(probe.paymentHash).catch(() => undefined);
  if (!istTestnetRechnung(probe.bolt11)) throw new Error("Der Lightning-Knoten des Kunden ist kein Testnet-Knoten – Abbruch, nie Mainnet");
  const a: Abnahme = {
    lp: {
      ln: new LndLightningAdapter({ restUrl: e.lp.rest, macaroonHex: lpMacaroon, allowInsecureTls: e.unsicheresTls }),
      sol: new AnchorSolanaHtlc({ rpcUrl: e.rpc, keypair: lpKp }),
      solAdresse: lpKp.publicKey.toBase58(),
    },
    kunde: { ln: kundeLn, sol: new AnchorSolanaHtlc({ rpcUrl: e.rpc, keypair: kundeKp }), solAdresse: kundeKp.publicKey.toBase58() },
    uhr: () => Math.floor(Date.now() / 1000),
    warte: (s) => new Promise((r) => setTimeout(r, s * 1000)),
    sats: e.sats, lamportsPerSat: e.lamportsPerSat, feePpm: 3000,
    hin: { tSolSecs: e.hinSperrSecs, lnCltvDeltaBlocks: e.cltv },
    // Frist wie die App sie waehlt (planeRueckSwap): cltv · langsamer Block + 1 h + Puffer
    rueck: { sperrSecs: e.cltv * SLOW_BLOCK_SECS + 3600 + RUECK_PUFFER_SECS, lnCltvDeltaBlocks: e.cltv },
    takt: 15, geduld: 900, log,
  };
  log(`Abnahme: ${e.faelle.join(", ")} · ${e.sats} sats · Gegenrichtung sperrt ${Math.round(a.rueck.sperrSecs / 3600)} h`);
  const faelle = await lpAbnahme(a, e.faelle);
  log(abnahmeBericht(faelle));
  return faelle.every((f) => f.ok);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const ok = await starteAbnahme(abnahmeEinstellungen(process.env, process.argv.slice(2)));
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
}
