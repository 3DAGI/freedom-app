/**
 * Reticulum-Adressen mit Kontakten (B-32c1, `docs/RETICULUM-ENTWURF.md` V4, W2 A), ohne DOM.
 *
 * Versand (`FunkAdressVersand`): nur mit Zustimmung (`freedom.reticulum.teilen`), als Person (nie als Gerät), im
 * Abruftakt je Schlag höchstens ein Umschlag (`baueFunkAdresseUmschlaege()`). Jeder Kontakt bekommt die Adresse einmal,
 * neue Kontakte später auch; ändert sich die Adresse, bekommen sie alle neu.
 * Empfang (`FunkAdressBuch`): nur von Kontakten, je Kontakt die neueste.
 * Alles in `geheim`: Zustimmung, Verteilung und Buch verraten, dass und mit wem man funkt.
 */
import { baueFunkAdresseUmschlaege, type FunkAdresseVonKontakt, type NostrEvent, type Signer } from "@freedomstack/protocol";

export const LS_FUNK_TEILEN = "freedom.reticulum.teilen";
export const LS_FUNK_VERTEILT = "freedom.reticulum.verteilt";
export const LS_FUNK_KONTAKTE = "freedom.reticulum.kontakte";
/** Wer die Adresse noch nicht hat, prüft der Versand jeden 60. Schlag (etwa alle 30 Minuten) – und gleich nach der Zustimmung. */
export const FUNK_PRUEFEN_JEDEN = 60;
/** Nicht zustellbar (kein Posteingang, kein Relay): einen Tag Pause für diesen Kontakt. */
export const FUNK_PAUSE_SECS = 86_400;
/** Höchstens so viele Adressen im Buch – die ältesten gehen zuerst. */
export const FUNK_KONTAKTE_MAX = 200;

const HEX64 = /^[0-9a-f]{64}$/;
const LXMF = /^[0-9a-f]{32}$/;

export interface FunkSpeicher {
  getItem(k: string): string | null;
  setItem(k: string, w: string): Promise<void> | void;
}

/** An wen die Adresse schon ging – je Adresse. */
export interface FunkVerteilt {
  adresse: string;
  an: string[];
}

function lies(speicher: FunkSpeicher, k: string): unknown {
  try {
    return JSON.parse(speicher.getItem(k) ?? "null");
  } catch {
    return null;
  }
}

export interface FunkAdressVersandDeps {
  zustimmung(): boolean;
  /** Null, wenn die App nicht als die Person sprechen kann (Gerät, gesperrt). */
  signer(): Signer | null;
  kontakte(): string[];
  /** Die eigene LXMF-Adresse (32 Zeichen Hex) – erst gefragt, wenn es etwas zu senden gibt. */
  adresse(): Promise<string | null>;
  /** An den Posteingang des Kontakts; true, wenn ein Relay ihn angenommen hat. */
  sende(wrap: NostrEvent, an: string): Promise<boolean>;
  speicher: FunkSpeicher;
  jetzt(): number;
}

/** Versand im Abruftakt: je Schlag höchstens ein Umschlag. */
export class FunkAdressVersand {
  private schlange: string[] = [];
  private schlag = 0;
  private fehl = new Map<string, number>();

  constructor(private d: FunkAdressVersandDeps) {}

  verteilt(): FunkVerteilt | null {
    const v = lies(this.d.speicher, LS_FUNK_VERTEILT) as Partial<FunkVerteilt> | null;
    return v && typeof v.adresse === "string" && LXMF.test(v.adresse) && Array.isArray(v.an) && v.an.every((k) => typeof k === "string")
      ? { adresse: v.adresse, an: v.an }
      : null;
  }

  /** Gleich beim nächsten Schlag prüfen – nach der Zustimmung soll niemand eine halbe Stunde warten. */
  bald(): void {
    this.schlag = 0;
  }

  /** Ein Schlag. Ergebnis: an wen gerade gesendet wurde, sonst null. */
  async takt(): Promise<string | null> {
    if (!this.d.zustimmung()) {
      this.schlange = [];
      return null;
    }
    const signer = this.d.signer();
    if (!signer) return null;
    const jetzt = this.d.jetzt();
    if (this.schlange.length === 0) {
      if (this.schlag++ % FUNK_PRUEFEN_JEDEN !== 0) return null;
      const adresse = await this.d.adresse();
      if (!adresse || !LXMF.test(adresse)) return null;
      let v = this.verteilt();
      if (v?.adresse !== adresse) {
        v = { adresse, an: [] };
        await this.d.speicher.setItem(LS_FUNK_VERTEILT, JSON.stringify(v));
      }
      const haben = new Set(v.an);
      this.schlange = [...new Set(this.d.kontakte())]
        .filter((k) => HEX64.test(k) && !haben.has(k) && jetzt - (this.fehl.get(k) ?? -Infinity) >= FUNK_PAUSE_SECS);
      if (this.schlange.length === 0) return null;
    }
    const an = this.schlange.shift()!;
    const v = this.verteilt();
    if (!v) return null;
    const [wrap] = await baueFunkAdresseUmschlaege({ von: signer, an: [an], adresse: v.adresse, nowSecs: jetzt });
    if (!wrap || !(await this.d.sende(wrap, an).catch(() => false))) {
      this.fehl.set(an, jetzt);
      return null;
    }
    await this.d.speicher.setItem(LS_FUNK_VERTEILT, JSON.stringify({ adresse: v.adresse, an: [...new Set([...v.an, an])] }));
    return an;
  }
}

/** Die Adressen der Kontakte – je Kontakt die neueste, nur in `geheim`. */
export class FunkAdressBuch {
  constructor(private speicher: FunkSpeicher) {}

  private alle(): Map<string, { adresse: string; zeit: number }> {
    const roh = lies(this.speicher, LS_FUNK_KONTAKTE);
    const m = new Map<string, { adresse: string; zeit: number }>();
    if (typeof roh !== "object" || roh === null || Array.isArray(roh)) return m;
    for (const [pk, e] of Object.entries(roh as Record<string, { adresse?: unknown; zeit?: unknown }>)) {
      if (HEX64.test(pk) && typeof e?.adresse === "string" && LXMF.test(e.adresse) && Number.isSafeInteger(e.zeit)) {
        m.set(pk, { adresse: e.adresse, zeit: e.zeit as number });
      }
    }
    return m;
  }

  /** Eine empfangene Adresse merken – nur, wenn sie neuer ist als die gemerkte. */
  async nimm(r: FunkAdresseVonKontakt): Promise<boolean> {
    if (!HEX64.test(r.von) || !LXMF.test(r.adresse) || !Number.isSafeInteger(r.zeit)) return false;
    const m = this.alle();
    const alt = m.get(r.von);
    if (alt && alt.zeit >= r.zeit) return false;
    m.set(r.von, { adresse: r.adresse, zeit: r.zeit });
    const behalten = [...m.entries()].sort((a, b) => b[1].zeit - a[1].zeit).slice(0, FUNK_KONTAKTE_MAX);
    await this.speicher.setItem(LS_FUNK_KONTAKTE, JSON.stringify(Object.fromEntries(behalten)));
    return true;
  }

  /** Die Adresse eines Kontakts – nur, wenn er noch Kontakt ist. */
  adresseVon(pk: string, kontakte: ReadonlySet<string>): string | null {
    return kontakte.has(pk) ? this.alle().get(pk)?.adresse ?? null : null;
  }

  /** Von wie vielen Kontakten eine Adresse da ist. */
  zahl(kontakte: ReadonlySet<string>): number {
    return [...this.alle().keys()].filter((k) => kontakte.has(k)).length;
  }
}
