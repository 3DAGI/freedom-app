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
 * App kennt (`connect`, seit A-21d2 `signiereTransaktion` und
 * `signiereUndSendeTransaktion` mit Transaktionen aus kit – die Wallet bekommt Bytes).
 */
import { base58 } from "@scure/base";
import { alsDraht, ausDraht, type SolTransaktion } from "@freedomstack/protocol";
import { t } from "./i18n.js";

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
type NachrichtSignieren = {
  signMessage(...inputs: Array<{ account: StandardKonto; message: Uint8Array }>): Promise<Array<{ signedMessage: Uint8Array; signature: Uint8Array; signatureType?: string }>>;
};

const gleicheBytes = (a: unknown, b: Uint8Array): boolean => a instanceof Uint8Array && a.length === b.length && a.every((x, i) => x === b[i]);

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

/** Eine Standard-Wallet in der Form von `window.solana`. */
export function alsAnbieter(w: StandardWallet, kette: () => Promise<string>) {
  let konto: StandardKonto | undefined;
  const feature = <T>(name: string): T => {
    const f = w.features[name] as T | undefined;
    if (!f) throw new Error(t("zahl.walletKannNicht", { wallet: w.name, was: name }));
    return f;
  };
  const verbundenesKonto = (): StandardKonto => {
    if (!konto) throw new Error(t("zahl.walletNichtVerbunden"));
    return konto;
  };
  const passendeKette = async (): Promise<string> => {
    const k = await kette();
    if (!w.chains.includes(k)) throw new Error(t("zahl.walletOhneKette", { wallet: w.name, kette: k }));
    return k;
  };
  const anbieter: {
    name: string;
    connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
    signiereTransaktion?(tx: SolTransaktion): Promise<SolTransaktion>;
    signiereUndSendeTransaktion?(tx: SolTransaktion): Promise<{ signature: string }>;
    signiereNachricht?(nachricht: Uint8Array): Promise<Uint8Array>;
  } = {
    name: w.name,
    async connect(opts) {
      const { accounts } = await feature<Verbinden>("standard:connect").connect(opts?.onlyIfTrusted ? { silent: true } : undefined);
      konto = accounts.find((a) => !a.chains || a.chains.some((c) => c.startsWith("solana:")));
      if (!konto || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(konto.address)) throw new Error(t("zahl.walletOhneKonto", { wallet: w.name }));
      const adresse = konto.address;
      return { publicKey: { toBase58: () => adresse } };
    },
  };
  // Nur anbieten, was die Wallet kann – der Rest der App fragt danach.
  if (w.features["solana:signTransaction"]) {
    anbieter.signiereTransaktion = async (tx) => {
      const [r] = await feature<Signieren>("solana:signTransaction").signTransaction({
        account: verbundenesKonto(), transaction: alsDraht(tx), chain: await passendeKette(),
      });
      return ausDraht(r.signedTransaction);
    };
  }
  if (w.features["solana:signAndSendTransaction"]) {
    anbieter.signiereUndSendeTransaktion = async (tx) => {
      const [r] = await feature<SignierenUndSenden>("solana:signAndSendTransaction").signAndSendTransaction({
        account: verbundenesKonto(), transaction: alsDraht(tx), chain: await passendeKette(),
      });
      if (!(r?.signature instanceof Uint8Array) || r.signature.length !== 64) throw new Error(t("zahl.walletOhneSignatur", { wallet: w.name }));
      return { signature: base58.encode(r.signature) };
    };
  }
  // A-12b2d: nur genau die Bytes der App – setzt die Wallet einen eigenen Vorspann davor, gilt die Signatur nicht für sie
  if (w.features["solana:signMessage"]) {
    anbieter.signiereNachricht = async (nachricht) => {
      const [r] = await feature<NachrichtSignieren>("solana:signMessage").signMessage({ account: verbundenesKonto(), message: nachricht });
      const ed25519 = !r?.signatureType || r.signatureType === "ed25519";
      if (!ed25519 || !gleicheBytes(r.signedMessage, nachricht) || !(r.signature instanceof Uint8Array) || r.signature.length !== 64) {
        throw new Error(t("zahl.walletNachrichtAnders"));
      }
      return r.signature;
    };
  }
  return anbieter;
}
