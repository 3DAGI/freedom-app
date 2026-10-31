/**
 * Bitchat in der App (B-36c2b2, `docs/BITCHAT-ENTWURF.md`), ohne DOM: der Knoten (`BitchatKnoten`) an der Hülle
 * (`bitchat-huelle.ts`). Ein Schritt holt den Stand (Verbindungen und ihre Grenzen), die Kontakte mit ihren Schlüsseln (38083)
 * und alles Empfangene, gibt es in `nimm()` und schickt hinaus, was herauskommt – jeden Wert mit seinem Versatz. Angekündigt
 * wird beim ersten Schritt, bei einer neuen Verbindung und sonst alle `ankuendigenMs`. Umschläge an mich gehen an `post()`.
 * Gestartet wird nur auf Klick (c3) – hier läuft nichts von selbst.
 */
import type { BitchatAusgabe, BitchatKnoten, BitchatKontakt } from "@freedomstack/protocol";
import type { BitchatStand, BitchatWert } from "./shell/bitchat-huelle.js";

export const BITCHAT_LAUF = Object.freeze({
  /** So oft holt die App, was die Hülle empfing, solange Bitchat an ist */
  schrittMs: 500,
  /** So oft kündigt sich das Gerät an (Freedom-Wert: halb so lang, wie ein Kontakt „in der Nähe“ gilt) */
  ankuendigenMs: 30_000,
});

export interface BitchatLaufDeps {
  knoten: BitchatKnoten;
  stand(): Promise<BitchatStand | null>;
  hole(): Promise<BitchatWert[]>;
  sende(id: string, wert: Uint8Array): Promise<boolean>;
  kontakte(): BitchatKontakt[];
  /** Ein Umschlag an mich – Bytes, wie `leseBitchatUmschlag()` sie liefert */
  post(umschlag: Uint8Array): void;
  /** Später senden (Versatz beim Weiterreichen); im Test sofort */
  spaeter(ms: number, f: () => void): void;
  jetzt(): number;
}

export class BitchatLauf {
  private zuletztAngekuendigt = -Infinity;
  private bekannt = new Set<string>();

  constructor(private d: BitchatLaufDeps) {}

  /** Ein Schritt. Ergebnis: ob Bitchat gerade an ist (sonst hält der Aufrufer an). */
  async schritt(): Promise<boolean> {
    const s = await this.d.stand();
    if (s?.stand !== "an") return false;
    const jetzt = this.d.jetzt();
    this.d.knoten.setzeVerbindungen(s.verbindungen);
    this.d.knoten.setzeKontakte(this.d.kontakte());
    const neu = s.verbindungen.some((v) => !this.bekannt.has(v.id));
    this.bekannt = new Set(s.verbindungen.map((v) => v.id));
    if (neu || jetzt - this.zuletztAngekuendigt >= BITCHAT_LAUF.ankuendigenMs) {
      this.zuletztAngekuendigt = jetzt;
      this.raus(this.d.knoten.ankuendigung(jetzt));
    }
    for (const w of await this.d.hole()) {
      const r = this.d.knoten.nimm(w.id, w.wert, jetzt);
      this.raus(r.ausgabe);
      for (const u of r.umschlaege) this.d.post(u);
    }
    return true;
  }

  /** Ein Umschlag an eine Person – nur, wenn ihr Gerät gerade in der Nähe ist; true, wenn er hinausgeht. */
  sende(person: string, umschlag: Uint8Array): boolean {
    const aus = this.d.knoten.sende(person, umschlag, this.d.jetzt());
    if (!aus) return false;
    this.raus(aus);
    return true;
  }

  /** Personen, deren Gerät gerade in der Nähe ist */
  inDerNaehe(): string[] {
    return this.d.knoten.inDerNaehe(this.d.jetzt());
  }

  private raus(aus: readonly BitchatAusgabe[]): void {
    for (const a of aus) {
      const los = () => void this.d.sende(a.id, a.wert).catch(() => false);
      if (a.versatzMs > 0) this.d.spaeter(a.versatzMs, los);
      else los();
    }
  }
}
