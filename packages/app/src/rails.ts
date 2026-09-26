/**
 * Die beiden Zahlschienen der App (Schritt 4.1) – Lightning und Solana hinter
 * `PaymentRail` aus dem Protokoll. Die Wallets kommen als Quellen herein
 * (NWC, WebLN, eingebundene Solana-Wallet), damit die Schienen ohne Browser
 * pruefbar sind und jede Geldfunktion nur noch die Schiene fragt.
 */
import { bech32 } from "@scure/base";
import {
  type Angebot, type Beleg, type PaymentRail, type Zahlanfrage, preimageMatches, pruefeAnfrage,
} from "@freedomstack/protocol";

// ------------------------------------------------------------ bolt11

/** Betrag einer bolt11-Rechnung in msat (aus dem Praefix), null = ohne Betrag oder kaputt. */
export function bolt11BetragMsat(bolt11: string): number | null {
  const m = /^ln(?:bc|tb|bcrt|tbs)(\d+)?([munp])?1/i.exec(bolt11);
  if (!m || !m[1]) return null;
  const zahl = Number(m[1]);
  // 1 BTC = 1e11 msat; Multiplikatoren nach BOLT 11
  const faktor: Record<string, number> = { m: 1e8, u: 1e5, n: 1e2, p: 0.1 };
  const msat = m[2] ? zahl * faktor[m[2].toLowerCase()] : zahl * 1e11;
  return Number.isSafeInteger(msat) ? msat : null;
}

/** Payment-Hash (hex) aus einer bolt11-Rechnung – Feld „p“; null, wenn nicht lesbar. */
export function bolt11ZahlungsHash(bolt11: string): string | null {
  try {
    const { words } = bech32.decode(bolt11.toLowerCase() as `${string}1${string}`, false);
    const ende = words.length - 104; // Signatur: 520 Bit
    for (let i = 7; i + 3 <= ende;) { // 7 Woerter Zeitstempel
      const tag = words[i];
      const laenge = words[i + 1] * 32 + words[i + 2];
      i += 3;
      if (tag === 1 && laenge === 52) {
        return Array.from(bech32.fromWords(words.slice(i, i + laenge)), (b) => b.toString(16).padStart(2, "0")).join("");
      }
      i += laenge;
    }
  } catch { /* kaputte Rechnung */ }
  return null;
}

// ------------------------------------------------------------ Lightning

export interface LightningQuellen {
  /** NWC-Verbindung, falls eingerichtet. */
  nwc?: () => { payInvoice(bolt11: string): Promise<{ preimage: string }>; getBalance(): Promise<number> } | null;
  /** WebLN-Erweiterung, falls vorhanden. */
  webln?: () => { enable(): Promise<void>; sendPayment(bolt11: string): Promise<{ preimage: string }> } | undefined;
  /** Fuer Lightning-Adressen (LNURL-pay). */
  holen?: typeof fetch;
  jetzt?: () => number;
  /** Netz da (7.3)? Ohne Angabe: ja. */
  online?: () => boolean;
}

export class LightningRail implements PaymentRail {
  readonly id = "lightning" as const;
  constructor(private q: LightningQuellen) {}

  async verfuegbar(): Promise<boolean> {
    return !!(this.q.nwc?.() || this.q.webln?.());
  }

  online(): boolean {
    return this.q.online?.() ?? true;
  }

  async quote(a: Zahlanfrage): Promise<Angebot> {
    pruefeAnfrage(this.id, a);
    // Die Routing-Gebuehr kennt erst die Wallet beim Zahlen.
    return { rail: this.id, betrag: a.betrag };
  }

  async pay(a: Zahlanfrage): Promise<Beleg> {
    pruefeAnfrage(this.id, a);
    const rechnung = a.ziel.includes("@") ? await this.rechnungVonAdresse(a.ziel, a.betrag.wert, a.notiz) : a.ziel;
    const verlangt = bolt11BetragMsat(rechnung);
    if (verlangt !== null && verlangt !== a.betrag.wert) {
      throw new Error(`Rechnung über ${verlangt} msat, gewollt ${a.betrag.wert} msat – nicht gezahlt`);
    }
    const nwc = this.q.nwc?.();
    let preimage: string;
    if (nwc) {
      preimage = (await nwc.payInvoice(rechnung)).preimage;
    } else {
      const w = this.q.webln?.();
      if (!w) throw new Error("Keine Lightning-Wallet verbunden – im Wallet-Tab per NWC verbinden.");
      await w.enable();
      preimage = (await w.sendPayment(rechnung)).preimage;
    }
    return { rail: this.id, ziel: a.ziel, betrag: a.betrag, ref: preimage, rechnung, zeit: this.jetzt() };
  }

  /** Beleg pruefen: passt das Preimage zum Payment-Hash der bezahlten Rechnung? */
  async verify(b: Beleg): Promise<boolean> {
    if (b.rail !== this.id || !/^[0-9a-f]{64}$/i.test(b.ref)) return false;
    const hash = bolt11ZahlungsHash(b.rechnung ?? b.ziel);
    return hash !== null && preimageMatches(b.ref, hash);
  }

  async balance() {
    const nwc = this.q.nwc?.();
    if (!nwc) throw new Error("Guthaben nur über NWC abfragbar");
    return { einheit: "msat" as const, wert: await nwc.getBalance() };
  }

  /** LNURL-pay: Lightning-Adresse -> Rechnung ueber genau diesen Betrag. */
  private async rechnungVonAdresse(adresse: string, msat: number, notiz?: string): Promise<string> {
    const holen = this.q.holen ?? fetch;
    const [name, host] = adresse.split("@");
    const r = await holen(`https://${host}/.well-known/lnurlp/${encodeURIComponent(name)}`);
    if (!r.ok) throw new Error(`Lightning-Adresse nicht erreichbar (HTTP ${r.status})`);
    const d = (await r.json()) as { callback?: string; minSendable?: number; maxSendable?: number; tag?: string; commentAllowed?: number };
    if (d.tag !== "payRequest" || typeof d.callback !== "string" || !d.callback.startsWith("https://")) {
      throw new Error("Lightning-Adresse liefert keine gültige Zahlungsanfrage");
    }
    if ((d.minSendable !== undefined && msat < d.minSendable) || (d.maxSendable !== undefined && msat > d.maxSendable)) {
      throw new Error(`Betrag außerhalb ${d.minSendable ?? 0}–${d.maxSendable ?? "∞"} msat`);
    }
    const cb = new URL(d.callback);
    cb.searchParams.set("amount", String(msat));
    if (notiz && d.commentAllowed) cb.searchParams.set("comment", notiz.slice(0, d.commentAllowed));
    const rr = await holen(cb.toString());
    const dd = (await rr.json()) as { pr?: string };
    if (typeof dd.pr !== "string") throw new Error("Lightning-Adresse lieferte keine Rechnung");
    return dd.pr;
  }

  private jetzt(): number {
    return this.q.jetzt?.() ?? Math.floor(Date.now() / 1000);
  }
}

// ------------------------------------------------------------ Solana

export interface SolanaWalletZugang {
  adresse: string;
  signiereUndSende(tx: unknown): Promise<string>;
  /**
   * Freigabe vor dem Bauen (4.2a): Die eingebaute Wallet prueft hier ihr
   * Tageslimit und fragt darueber nach. Externe Wallets fragen selbst.
   */
  freigabe?(lamports: number, ziel: string): Promise<boolean>;
  /**
   * Von welcher eigenen Adresse zahlen (4.9c)? Die eingebaute Wallet hat
   * mehrere (frische Empfangsadressen) und waehlt eine, die den Betrag allein
   * deckt. Ohne diese Funktion zahlt `adresse`.
   */
  absender?(lamports: number): Promise<string>;
}

export interface SolanaQuellen {
  /**
   * Die verbundene Wallet (injiziert oder eingebaut, 4.2): ihre Adresse und
   * „signieren und senden“ – ob die Wallet selbst sendet oder die App die
   * signierte Transaktion abschickt, entscheidet die Fabrik (zahlschienen.ts).
   */
  wallet: () => SolanaWalletZugang | undefined;
  /** Baut die Ueberweisung (sol-transfer.ts). */
  baueUeberweisung: (von: string, an: string, lamports: number) => Promise<unknown>;
  /** Prueft eine Signatur auf der Kette – ohne sie gilt ein Beleg als nicht pruefbar (4.8). */
  pruefeUeberweisung?: (signatur: string, an: string, lamports: number) => Promise<boolean>;
  guthaben?: (adresse: string) => Promise<number>;
  jetzt?: () => number;
  /** Netz da (7.3)? Ohne Angabe: ja. */
  online?: () => boolean;
}

export class SolanaRail implements PaymentRail {
  readonly id = "solana" as const;
  constructor(private q: SolanaQuellen) {}

  async verfuegbar(): Promise<boolean> {
    return !!this.q.wallet()?.adresse;
  }

  online(): boolean {
    return this.q.online?.() ?? true;
  }

  async quote(a: Zahlanfrage): Promise<Angebot> {
    pruefeAnfrage(this.id, a);
    // Grundgebuehr einer einfachen Ueberweisung: 5000 Lamports je Signatur.
    return { rail: this.id, betrag: a.betrag, gebuehr: { einheit: "lamports", wert: 5000 } };
  }

  async pay(a: Zahlanfrage): Promise<Beleg> {
    pruefeAnfrage(this.id, a);
    const w = this.q.wallet();
    const von = w?.adresse;
    if (!w || !von) throw new Error("Keine Solana-Wallet verbunden – im Wallet-Tab verbinden.");
    if (von === a.ziel) throw new Error("Überweisung an sich selbst");
    const absender = w.absender ? await w.absender(a.betrag.wert) : von;
    if (absender === a.ziel) throw new Error("Überweisung an sich selbst");
    if (w.freigabe && !(await w.freigabe(a.betrag.wert, a.ziel))) throw new Error("Zahlung nicht freigegeben – nichts gesendet.");
    const tx = await this.q.baueUeberweisung(absender, a.ziel, a.betrag.wert);
    const signature = await w.signiereUndSende(tx);
    if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) throw new Error("Wallet lieferte keine gültige Signatur");
    return { rail: this.id, ziel: a.ziel, betrag: a.betrag, ref: signature, zeit: this.q.jetzt?.() ?? Math.floor(Date.now() / 1000) };
  }

  async verify(b: Beleg): Promise<boolean> {
    if (b.rail !== this.id || !this.q.pruefeUeberweisung) return false;
    return this.q.pruefeUeberweisung(b.ref, b.ziel, b.betrag.wert);
  }

  async balance() {
    const adr = this.q.wallet()?.adresse;
    if (!adr || !this.q.guthaben) throw new Error("Guthaben nicht abfragbar");
    return { einheit: "lamports" as const, wert: await this.q.guthaben(adr) };
  }
}
