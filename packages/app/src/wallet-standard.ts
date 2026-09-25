/**
 * Wallet Standard (Schritt 4.2c) – ohne Abhaengigkeit.
 *
 * Browser-Wallets (Backpack, Solflare, Phantom und andere) melden sich heute
 * ueber den Wallet Standard an statt ueber ein eigenes `window.solana`. Das
 * Protokoll ist klein: Die App ruft „app-ready“ mit einer Registrierung aus,
 * Wallets, die spaeter laden, rufen „register-wallet“ – beide landen hier in
 * derselben Liste. Das Paket `@wallet-standard/app` taete dasselbe; fuer zwei
 * Ereignisse lohnt keine neue Abhaengigkeit.
 *
 * `alsAnbieter()` macht aus einer Standard-Wallet die Form, die der Rest der
 * App schon kennt (`connect`, `signTransaction`, `signAndSendTransaction`).
 */
import { base58 } from "@scure/base";

export interface StandardKonto {
  address: string;
  chains?: readonly string[];
}

export interface StandardWallet {
  name: string;
  chains: readonly string[];
  features: Record<string, unknown>;
}

type Registrierung = { register(...wallets: StandardWallet[]): () => void };

type Verbinden = { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly StandardKonto[] }> };
type SignierenUndSenden = {
  signAndSendTransaction(...inputs: Array<{ account: StandardKonto; transaction: Uint8Array; chain: string }>): Promise<Array<{ signature: Uint8Array }>>;
};
type Signieren = {
  signTransaction(...inputs: Array<{ account: StandardKonto; transaction: Uint8Array; chain?: string }>): Promise<Array<{ signedTransaction: Uint8Array }>>;
};

const gefunden = new Set<StandardWallet>();
let beobachtet: EventTarget | null = null;

/**
 * Alle angemeldeten Wallets, die Solana koennen. Beim ersten Aufruf lauscht
 * die App auf spaete Anmeldungen und fragt die schon geladenen ab.
 */
export function solanaWallets(ziel: EventTarget = globalThis as unknown as EventTarget): StandardWallet[] {
  if (beobachtet !== ziel) {
    beobachtet = ziel;
    gefunden.clear();
    const reg: Registrierung = {
      register(...ws) {
        for (const w of ws) gefunden.add(w);
        return () => { for (const w of ws) gefunden.delete(w); };
      },
    };
    ziel.addEventListener("wallet-standard:register-wallet", (e) => {
      try { ((e as CustomEvent).detail as (r: Registrierung) => void)(reg); } catch { /* fremde Wallet – ihr Fehler bleibt ihrer */ }
    });
    ziel.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: reg }));
  }
  return [...gefunden].filter(kannSolana);
}

function kannSolana(w: StandardWallet): boolean {
  return Array.isArray(w.chains) && w.chains.some((c) => typeof c === "string" && c.startsWith("solana:")) &&
    !!w.features?.["standard:connect"] &&
    (!!w.features["solana:signAndSendTransaction"] || !!w.features["solana:signTransaction"]);
}

/** Die Kette zum eingestellten RPC: Devnet- und Testnet-Adressen tragen ihren Namen. */
export function ketteAusRpc(url: string): "solana:mainnet" | "solana:devnet" | "solana:testnet" {
  if (/devnet/i.test(url)) return "solana:devnet";
  if (/testnet/i.test(url)) return "solana:testnet";
  return "solana:mainnet";
}

type Tx = { serialize(opts?: unknown): Uint8Array; version?: unknown };

function serialisiere(tx: Tx): Uint8Array {
  // Versionierte Transaktionen serialisieren ohne Optionen; alte nur ohne
  // Signaturpruefung, denn die Signatur fehlt ja noch.
  return Uint8Array.from(tx.version !== undefined ? tx.serialize() : tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
}

/** Eine Standard-Wallet in der Form von `window.solana`. */
export function alsAnbieter(w: StandardWallet, kette: () => Promise<string>) {
  let konto: StandardKonto | undefined;
  const feature = <T>(name: string): T => {
    const f = w.features[name] as T | undefined;
    if (!f) throw new Error(`${w.name} kann ${name} nicht`);
    return f;
  };
  const verbundenesKonto = (): StandardKonto => {
    if (!konto) throw new Error("Wallet nicht verbunden");
    return konto;
  };
  const passendeKette = async (): Promise<string> => {
    const k = await kette();
    if (!w.chains.includes(k)) throw new Error(`${w.name} unterstützt ${k} nicht`);
    return k;
  };
  const anbieter: {
    name: string;
    connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
    signTransaction?(tx: unknown): Promise<unknown>;
    signAndSendTransaction?(tx: unknown): Promise<{ signature: string }>;
  } = {
    name: w.name,
    async connect(opts) {
      const { accounts } = await feature<Verbinden>("standard:connect").connect(opts?.onlyIfTrusted ? { silent: true } : undefined);
      konto = accounts.find((a) => !a.chains || a.chains.some((c) => c.startsWith("solana:")));
      if (!konto || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(konto.address)) throw new Error(`${w.name} gab kein Solana-Konto frei`);
      const adresse = konto.address;
      return { publicKey: { toBase58: () => adresse } };
    },
  };
  // Nur anbieten, was die Wallet kann – der Rest der App fragt danach.
  if (w.features["solana:signTransaction"]) {
    anbieter.signTransaction = async (tx) => {
      const t = tx as Tx;
      const [r] = await feature<Signieren>("solana:signTransaction").signTransaction({
        account: verbundenesKonto(), transaction: serialisiere(t), chain: await passendeKette(),
      });
      const { Transaction, VersionedTransaction } = await import("@solana/web3.js");
      return t.version !== undefined ? VersionedTransaction.deserialize(r.signedTransaction) : Transaction.from(r.signedTransaction);
    };
  }
  if (w.features["solana:signAndSendTransaction"]) {
    anbieter.signAndSendTransaction = async (tx) => {
      const [r] = await feature<SignierenUndSenden>("solana:signAndSendTransaction").signAndSendTransaction({
        account: verbundenesKonto(), transaction: serialisiere(tx as Tx), chain: await passendeKette(),
      });
      if (!(r?.signature instanceof Uint8Array) || r.signature.length !== 64) throw new Error(`${w.name} lieferte keine gültige Signatur`);
      return { signature: base58.encode(r.signature) };
    };
  }
  return anbieter;
}
