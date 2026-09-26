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
 *
 * Frische Empfangsadressen (Schritt 4.9c): Beim Einrichten leitet die Wallet
 * zusaetzlich einen Vorrat von `VORRAT_GROESSE` Adressen ab – Phantoms Konten
 * 1, 2, 3 … aus denselben Woertern. Jeder Empfang (Tausch, Trinkgeld) bekommt
 * eine eigene; die Woerter bleiben ungespeichert, deshalb ein Vorrat statt
 * Ableitung bei Bedarf. Ist er aufgebraucht, leitet `vorratErgaenzen` mit den
 * Woertern die naechsten ab. Gezahlt wird von einer einzelnen eigenen Adresse,
 * die den Betrag allein deckt (`waehleAbsender`) – Zusammenlegen wuerde die
 * Adressen auf der Kette wieder verbinden.
 */
import { base58 } from "@scure/base";
import { mnemonicToSeedSync } from "@scure/bip39";
import { ed25519 } from "@noble/curves/ed25519.js";
import { type Ausgabe, type LimitPruefung, MIETE_LEERES_KONTO, deriveSolanaKey, imFenster, pruefeTageslimit } from "@freedomstack/protocol";
import { identityFromMnemonic } from "./identity.js";

/** Schluessel (64 Zeichen Hex) – nur ueber `geheim`. */
export const LS_SOL_WALLET = "freedom.solWallet";
/** Ausgaben der letzten 24 Stunden (JSON) – ebenfalls ueber `geheim`. */
export const LS_SOL_AUSGABEN = "freedom.solWallet.ausgaben";
/** Tageslimit in Lamports – ueber `geheim`, damit es nur mit offenem Tresor aenderbar ist. */
export const LS_SOL_LIMIT = "freedom.solWallet.limit";
/** 0,1 SOL am Tag ohne Nachfrage. */
export const STANDARD_LIMIT = 100_000_000;
/** Frische Empfangsadressen (JSON: vergeben, Schluessel ab Index 1) – ueber `geheim`. */
export const LS_SOL_VORRAT = "freedom.solWallet.vorrat";
/** So viele frische Adressen leitet die Wallet auf einmal ab. */
export const VORRAT_GROESSE = 20;
/** Grundgebuehr einer einfachen Ueberweisung (eine Signatur). */
export const UEBERWEISUNG_GEBUEHR = 5000;

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
  return solSchluesselReihe(phrase, nostrPk, 0, 1)[0];
}

/** Schluessel der Konten `von` … `von + anzahl − 1` (Phantoms Reihenfolge). */
export function solSchluesselReihe(phrase: string, nostrPk: string, von: number, anzahl: number): Uint8Array[] {
  const id = identityFromMnemonic(phrase); // prueft die Pruefsumme und normalisiert
  id.sk.fill(0);
  if (id.pk !== nostrPk) throw new Error("Diese Wörter gehören nicht zu deiner Identität.");
  const seed = mnemonicToSeedSync(id.mnemonic!);
  try {
    return Array.from({ length: anzahl }, (_, i) => {
      const k = deriveSolanaKey(seed, von + i);
      const privat = k.secretKey.slice(0, 32);
      k.secretKey.fill(0);
      return privat;
    });
  } finally {
    seed.fill(0);
  }
}

/**
 * Von welcher eigenen Adresse zahlen? Nur eine, die Betrag und Gebuehr allein
 * deckt und danach leer ist oder mindestens die Mindestmiete behaelt; von
 * mehreren die mit dem kleinsten Guthaben (die grossen bleiben unberuehrt).
 */
export function waehleAbsender(guthaben: Array<{ adresse: string; lamports: number }>, betrag: number): string {
  const passend = guthaben
    .filter(({ lamports }) => {
      const rest = lamports - betrag - UEBERWEISUNG_GEBUEHR;
      // Danach leer oder mindestens mietfrei – sonst lehnt die Kette die Ueberweisung ab.
      return rest === 0 || rest >= MIETE_LEERES_KONTO;
    })
    .sort((a, b) => a.lamports - b.lamports);
  if (passend.length) return passend[0].adresse;
  const summe = guthaben.reduce((s, g) => s + g.lamports, 0);
  throw new Error(summe >= betrag + UEBERWEISUNG_GEBUEHR
    ? `Keine einzelne deiner ${guthaben.length} Adressen deckt den Betrag. Die App legt sie nicht zusammen – das verbände sie auf der Kette.`
    : "Nicht genug SOL in der eingebauten Wallet.");
}

export class EingebauteSolWallet {
  constructor(
    private s: WalletSpeicher,
    private jetzt: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  /** Einrichten: Schluessel und Vorrat frischer Adressen ableiten und speichern. Liefert die Adresse. */
  async einrichten(phrase: string, nostrPk: string): Promise<string> {
    const [privat, ...vorrat] = solSchluesselReihe(phrase, nostrPk, 0, 1 + VORRAT_GROESSE);
    try {
      await this.s.setItem(LS_SOL_WALLET, alsHex(privat));
      await this.s.setItem(LS_SOL_VORRAT, JSON.stringify({ vergeben: 0, schluessel: vorrat.map(alsHex) }));
      return base58.encode(ed25519.getPublicKey(privat));
    } finally {
      privat.fill(0);
      for (const k of vorrat) k.fill(0);
    }
  }

  /**
   * Vorrat mit den Woertern um `VORRAT_GROESSE` Adressen verlaengern – fuer
   * Wallets von vor 4.9c oder einen aufgebrauchten Vorrat. Die Woerter muessen
   * dieselbe Wallet ergeben.
   */
  async vorratErgaenzen(phrase: string, nostrPk: string): Promise<number> {
    const v = this.vorrat();
    const [haupt, ...neu] = solSchluesselReihe(phrase, nostrPk, 0, 1 + v.schluessel.length + VORRAT_GROESSE);
    try {
      if (alsHex(haupt) !== this.s.getItem(LS_SOL_WALLET)) throw new Error("Diese Wörter ergeben eine andere Wallet.");
      await this.s.setItem(LS_SOL_VORRAT, JSON.stringify({ vergeben: v.vergeben, schluessel: neu.map(alsHex) }));
      return neu.length - v.vergeben;
    } finally {
      haupt.fill(0);
      for (const k of neu) k.fill(0);
    }
  }

  /** Wie viele frische Adressen noch unvergeben sind. */
  vorratFrei(): number {
    const v = this.vorrat();
    return v.schluessel.length - v.vergeben;
  }

  /**
   * Die naechste frische Empfangsadresse. Vergeben wird sie, bevor sie
   * herausgeht – auch wenn der Empfang danach ausbleibt, kommt sie nicht zweimal.
   */
  async frischeAdresse(): Promise<string> {
    const v = this.vorrat();
    if (v.vergeben >= v.schluessel.length) throw new Error("Keine frische Adresse mehr – gib deine 12 Wörter ein, um neue abzuleiten.");
    await this.s.setItem(LS_SOL_VORRAT, JSON.stringify({ vergeben: v.vergeben + 1, schluessel: v.schluessel }));
    return adresseVon(v.schluessel[v.vergeben]);
  }

  /** Hauptadresse und alle vergebenen frischen Adressen – dort kann Guthaben liegen. */
  eigeneAdressen(): string[] {
    const haupt = this.adresse();
    if (!haupt) return [];
    const v = this.vorrat();
    return [haupt, ...v.schluessel.slice(0, v.vergeben).map(adresseVon)];
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
    for (const k of [LS_SOL_WALLET, LS_SOL_AUSGABEN, LS_SOL_LIMIT, LS_SOL_VORRAT]) await this.s.removeItem(k);
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

  /**
   * Signiert die Transaktion fuer jede eigene Adresse, die sie verlangt
   * (Hauptadresse und vergebene frische) – synchron, die Kopien werden genullt.
   */
  signiere(tx: SignierbareTx): void {
    const nachricht = tx.serializeMessage(); // legt auch die Signatur-Plaetze an
    const v = this.vorrat();
    const schluessel = [this.s.getItem(LS_SOL_WALLET) ?? "", ...v.schluessel.slice(0, v.vergeben)];
    let signiert = 0;
    for (const hex of schluessel) {
      this.mitSchluessel((sk) => {
        const eigene = base58.encode(ed25519.getPublicKey(sk));
        const platz = tx.signatures.find((p) => p.publicKey.toBase58() === eigene);
        if (!platz) return;
        tx.addSignature(platz.publicKey, ed25519.sign(nachricht, sk));
        signiert++;
      }, hex);
    }
    if (!signiert) throw new Error("Die Transaktion verlangt keine Signatur dieser Wallet");
  }

  private vorrat(): { vergeben: number; schluessel: string[] } {
    try {
      const v = JSON.parse(this.s.getItem(LS_SOL_VORRAT) ?? "null") as { vergeben?: unknown; schluessel?: unknown } | null;
      const schluessel = Array.isArray(v?.schluessel) ? v.schluessel.filter((k): k is string => typeof k === "string" && HEX64.test(k)) : [];
      const vergeben = Number(v?.vergeben);
      return { schluessel, vergeben: Number.isSafeInteger(vergeben) && vergeben >= 0 ? Math.min(vergeben, schluessel.length) : 0 };
    } catch {
      return { vergeben: 0, schluessel: [] };
    }
  }

  private mitSchluessel<T>(fn: (sk: Uint8Array) => T, hexVorgabe?: string): T {
    const hex = hexVorgabe ?? this.s.getItem(LS_SOL_WALLET) ?? "";
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

/** Adresse zu einem gespeicherten Schluessel (Hex); die Kopie wird genullt. */
function adresseVon(hex: string): string {
  const sk = ausHex(hex);
  try {
    return base58.encode(ed25519.getPublicKey(sk));
  } finally {
    sk.fill(0);
  }
}

/** Nur fuer vorher mit HEX64 gepruefte Werte. */
function ausHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
