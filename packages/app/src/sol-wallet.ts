/**
 * Eingebaute SOL-Wallet (Schritt 4.2a) – fuer alle ohne Browser-Wallet.
 *
 * Der Schluessel kommt aus denselben 12 Woertern wie die Identitaet, nach
 * SLIP-10 auf Phantoms Pfad (Schritt 1.1): Wer die Woerter in Phantom
 * importiert, sieht dieselbe Adresse. Die App speichert die Woerter nicht –
 * wer die Wallet einrichtet, tippt sie einmal ein. Liegen bleibt nur der
 * abgeleitete Schluessel, und zwar nur im Tresor (`geheim`, shell/tresor.ts).
 *
 * Signiert wird synchron mit einer frischen Kopie, die danach genullt wird.
 * Vor jeder Zahlung prueft `freigabe()` das Tageslimit (rollende 24 Stunden,
 * wie das Budget einer NWC-Verbindung): darunter ohne Nachfrage, darueber nur
 * nach ausdruecklicher Bestaetigung. Gezaehlt wird ab der Freigabe – scheitert
 * die Zahlung danach, zaehlt sie trotzdem. Das Limit irrt so zur Nachfrage hin.
 */
import { base58 } from "@scure/base";
import { mnemonicToSeedSync } from "@scure/bip39";
import { ed25519 } from "@noble/curves/ed25519.js";
import { type Ausgabe, type LimitPruefung, deriveSolanaKey, imFenster, pruefeTageslimit } from "@freedomstack/protocol";
import { identityFromMnemonic } from "./identity.js";

/** Schluessel (64 Zeichen Hex) – nur ueber `geheim`. */
export const LS_SOL_WALLET = "freedom.solWallet";
/** Ausgaben der letzten 24 Stunden (JSON) – ebenfalls ueber `geheim`. */
export const LS_SOL_AUSGABEN = "freedom.solWallet.ausgaben";
/** Tageslimit in Lamports – ueber `geheim`, damit es nur mit offenem Tresor aenderbar ist. */
export const LS_SOL_LIMIT = "freedom.solWallet.limit";
/** 0,1 SOL am Tag ohne Nachfrage. */
export const STANDARD_LIMIT = 100_000_000;

export interface WalletSpeicher {
  getItem(key: string): string | null;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Was der Bestaetigungsdialog zeigt. */
export interface Nachfrage {
  lamports: number;
  ziel: string;
  limit: number;
  pruefung: LimitPruefung;
}

/** Das, was die Wallet an einer (legacy) Transaktion von web3.js braucht. */
export interface SignierbareTx {
  serializeMessage(): Uint8Array;
  signatures: Array<{ publicKey: { toBase58(): string } }>;
  addSignature(publicKey: unknown, signatur: Uint8Array): void;
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Den SOL-Schluessel aus den 12 Woertern ableiten. Die Woerter muessen zur
 * Identitaet gehoeren – sonst waere es eine fremde Wallet unter eigenem Namen.
 */
export function solSchluesselAusPhrase(phrase: string, nostrPk: string): Uint8Array {
  const id = identityFromMnemonic(phrase); // prueft die Pruefsumme und normalisiert
  id.sk.fill(0);
  if (id.pk !== nostrPk) throw new Error("Diese Wörter gehören nicht zu deiner Identität.");
  const seed = mnemonicToSeedSync(id.mnemonic!);
  const k = deriveSolanaKey(seed, 0);
  seed.fill(0);
  const privat = k.secretKey.slice(0, 32);
  k.secretKey.fill(0);
  return privat;
}

export class EingebauteSolWallet {
  constructor(
    private s: WalletSpeicher,
    private jetzt: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  /** Einrichten: Schluessel ableiten und speichern. Liefert die Adresse. */
  async einrichten(phrase: string, nostrPk: string): Promise<string> {
    const privat = solSchluesselAusPhrase(phrase, nostrPk);
    try {
      await this.s.setItem(LS_SOL_WALLET, alsHex(privat));
      return base58.encode(ed25519.getPublicKey(privat));
    } finally {
      privat.fill(0);
    }
  }

  eingerichtet(): boolean {
    return HEX64.test(this.s.getItem(LS_SOL_WALLET) ?? "");
  }

  /** Adresse – undefined ohne Wallet oder bei gesperrtem Tresor. */
  adresse(): string | undefined {
    if (!this.eingerichtet()) return undefined;
    return this.mitSchluessel((sk) => base58.encode(ed25519.getPublicKey(sk)));
  }

  limit(): number {
    const n = Number(this.s.getItem(LS_SOL_LIMIT));
    return this.s.getItem(LS_SOL_LIMIT) !== null && Number.isSafeInteger(n) && n >= 0 ? n : STANDARD_LIMIT;
  }

  async setzeLimit(lamports: number): Promise<void> {
    if (!Number.isSafeInteger(lamports) || lamports < 0) throw new Error("Limit muss eine nicht negative ganze Zahl sein");
    await this.s.setItem(LS_SOL_LIMIT, String(lamports));
  }

  /** Wallet von diesem Geraet entfernen (die Woerter stellen sie wieder her). */
  async entfernen(): Promise<void> {
    for (const k of [LS_SOL_WALLET, LS_SOL_AUSGABEN, LS_SOL_LIMIT]) await this.s.removeItem(k);
  }

  ausgaben(): Ausgabe[] {
    try {
      const roh = JSON.parse(this.s.getItem(LS_SOL_AUSGABEN) ?? "[]") as unknown;
      if (!Array.isArray(roh)) return [];
      return imFenster(roh.filter((a): a is Ausgabe => typeof a?.zeit === "number" && typeof a?.betrag === "number"), this.jetzt());
    } catch {
      return [];
    }
  }

  pruefe(lamports: number): LimitPruefung {
    return pruefeTageslimit(this.ausgaben(), lamports, this.limit(), this.jetzt());
  }

  /**
   * Vor jeder Zahlung: im Limit ohne Nachfrage, darueber nur, wenn `bestaetige`
   * zustimmt. Freigegebene Betraege zaehlen sofort zum Tag.
   */
  async freigabe(lamports: number, ziel: string, bestaetige: (n: Nachfrage) => Promise<boolean>): Promise<boolean> {
    if (!this.eingerichtet()) throw new Error("Keine eingebaute Wallet eingerichtet");
    const pruefung = this.pruefe(lamports);
    if (!pruefung.ohneNachfrage && !(await bestaetige({ lamports, ziel, limit: this.limit(), pruefung }))) return false;
    // Nur das Fenster wird gespeichert – aeltere Eintraege fallen heraus.
    await this.s.setItem(LS_SOL_AUSGABEN, JSON.stringify([...this.ausgaben(), { zeit: this.jetzt(), betrag: lamports }]));
    return true;
  }

  /** Signiert die Transaktion fuer die eigene Adresse – synchron, die Kopie wird genullt. */
  signiere(tx: SignierbareTx): void {
    const nachricht = tx.serializeMessage(); // legt auch die Signatur-Plaetze an
    this.mitSchluessel((sk) => {
      const eigene = base58.encode(ed25519.getPublicKey(sk));
      const platz = tx.signatures.find((p) => p.publicKey.toBase58() === eigene);
      if (!platz) throw new Error("Die Transaktion verlangt keine Signatur dieser Wallet");
      tx.addSignature(platz.publicKey, ed25519.sign(nachricht, sk));
    });
  }

  private mitSchluessel<T>(fn: (sk: Uint8Array) => T): T {
    const hex = this.s.getItem(LS_SOL_WALLET) ?? "";
    if (!HEX64.test(hex)) throw new Error("Eingebaute Wallet nicht verfügbar (Tresor gesperrt?)");
    const sk = ausHex(hex);
    try {
      return fn(sk);
    } finally {
      sk.fill(0);
    }
  }
}

// Eigene Hex-Wandlung statt toHex/fromHex: Die gehen ueber Buffer.from, und das
// legt kleine Werte in einen gemeinsamen Pool, den niemand nullt.
function alsHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/** Nur fuer vorher mit HEX64 gepruefte Werte. */
function ausHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
