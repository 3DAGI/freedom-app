/**
 * Kasse der Gebührenanteile (Schritt 5.1.3, Modell A+), ohne DOM.
 *
 * Die App zahlt jeden Anteil einer KI-Zahlung selbst an seinen Empfänger
 * (`teileAuf()`). Lightning-Anteile unter 100 sats je Empfänger sammelt sie
 * hier und zahlt sie gebündelt – bis dahin bleibt das Geld beim Kunden,
 * niemand sonst hält es (GEBUEHREN-ENTSCHEIDUNG, Regel 3).
 *
 * - Zweistufig: erst die Rechnung (bewegt kein Geld), dann zahlen. Scheitert
 *   das Zahlen, ist unklar, ob das Geld ging – der Betrag steht dann unter
 *   „unklar“ und wird nie ein zweites Mal automatisch gezahlt.
 * - Nur ganze sats; der Rest bleibt stehen.
 * - Der Stand liegt über `geheim` (mit Tresor verschlüsselt): Er verrät, wie
 *   viel und über wen jemand die KI nutzt. Nicht in der Sicherung – geht er
 *   verloren, bleibt das Geld beim Kunden.
 */
import { ANTEILE, defaultToolPrice, teileAuf, type Anteil, type Empfaenger, type Posten } from "@freedomstack/protocol";

export const LS_ANTEILE = "freedom.anteile";
/** Ab so viel je Empfänger zahlt die App (100 sats). */
export const BUENDEL_MSAT = 100_000;

export interface Offen { ziel: string; msat: number; anteile: Anteil[] }
export interface Unklar { ziel: string; msat: number; anteile: Anteil[]; rechnung: string; at: number }
export interface KassenStand { offen: Offen[]; unklar: Unklar[] }

export interface KassenSpeicher {
  getItem(k: string): string | null;
  setItem(k: string, v: string): Promise<void> | void;
}

export interface KassenZahlung {
  /** Rechnung über genau diesen Betrag (LNURL) – bewegt kein Geld. */
  rechnung(ziel: string, msat: number): Promise<string>;
  /** Die Rechnung zahlen (über die Zahlschiene, die den Betrag prüft). */
  zahle(rechnung: string, msat: number): Promise<unknown>;
}

/**
 * Was die App für eine Antwort höchstens zahlt: das Gebot, dazu je Werkzeug
 * der Preis, den auch der Knoten rechnet. Gratis-Tarif (Gebot 0): nichts.
 */
export function hoechstMsat(gebotSats: number, werkzeuge: ReadonlyArray<{ kind: number }>): number {
  if (!Number.isFinite(gebotSats) || gebotSats <= 0) return 0;
  return Math.floor(gebotSats * 1000) + werkzeuge.reduce((s, w) => s + (defaultToolPrice(w.kind)?.satsPerCall ?? 0) * 1000, 0);
}

/**
 * Eine Antwort abrechnen: höchstens `hoechstMsat` (Gebot plus Werkzeuge), mit
 * den Empfängern, die beim Senden deklariert wurden – so rechnet die App
 * denselben Anteil des Providers wie sein Knoten (`providerAnteilMsat`).
 * Ohne gemerkte Anfrage kennt die App weder Preis noch Deklaration: nichts.
 */
export function rechneAb(
  amountMsat: number,
  anfrage: { empfaenger: Empfaenger; hoechstMsat: number } | undefined,
): { providerMsat: number; posten: Posten[]; gekappt: boolean } {
  if (!anfrage || !Number.isSafeInteger(amountMsat) || amountMsat <= 0) return { providerMsat: 0, posten: [], gekappt: false };
  const gekappt = amountMsat > anfrage.hoechstMsat;
  return { ...teileAuf(gekappt ? anfrage.hoechstMsat : amountMsat, anfrage.empfaenger, "lightning"), gekappt };
}

const betrag = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const text = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 2000;

export class AnteilsKasse {
  private laeuft = false;

  constructor(private readonly p: { speicher: KassenSpeicher; jetzt?: () => number }) {}

  /** Der gespeicherte Stand – Unlesbares fällt weg, statt die Kasse zu sperren. */
  stand(): KassenStand {
    let roh: { offen?: unknown; unklar?: unknown } = {};
    try { roh = JSON.parse(this.p.speicher.getItem(LS_ANTEILE) ?? "{}") ?? {}; } catch { /* leer */ }
    const anteile = (x: unknown) => Array.isArray(x) && x.every((a) => (ANTEILE as unknown[]).includes(a));
    const offen = (Array.isArray(roh.offen) ? roh.offen : []).filter((o): o is Offen =>
      text(o?.ziel) && betrag(o?.msat) && anteile(o?.anteile));
    const unklar = (Array.isArray(roh.unklar) ? roh.unklar : []).filter((u): u is Unklar =>
      text(u?.ziel) && betrag(u?.msat) && anteile(u?.anteile) && text(u?.rechnung) && betrag(u?.at));
    return { offen, unklar };
  }

  /** Posten einer Antwort anschreiben – je Empfänger eine Summe. */
  async verbuche(posten: readonly Posten[]): Promise<void> {
    if (posten.length === 0) return;
    const s = this.stand();
    for (const p of posten) {
      if (!text(p.ziel) || !betrag(p.msat) || p.msat === 0) continue;
      const o = s.offen.find((x) => x.ziel === p.ziel);
      if (o) {
        o.msat += p.msat;
        if (!o.anteile.includes(p.anteil)) o.anteile.push(p.anteil);
      } else {
        s.offen.push({ ziel: p.ziel, msat: p.msat, anteile: [p.anteil] });
      }
    }
    await this.speichere(s);
  }

  /**
   * Jeden Empfänger ab 100 sats bezahlen (ganze sats). Nie zwei Läufe
   * zugleich; eine Zahlung mit unklarem Ausgang bleibt stehen, bis der Nutzer
   * in seiner Wallet nachsieht.
   */
  async zahleFaellige(z: KassenZahlung): Promise<{ gezahltMsat: number; unklarMsat: number }> {
    const ergebnis = { gezahltMsat: 0, unklarMsat: 0 };
    if (this.laeuft) return ergebnis;
    this.laeuft = true;
    try {
      for (const o of this.stand().offen.filter((x) => x.msat >= BUENDEL_MSAT)) {
        const msat = o.msat - (o.msat % 1000);
        let rechnung: string;
        try {
          rechnung = await z.rechnung(o.ziel, msat);
        } catch {
          continue; // nichts gezahlt – beim nächsten Mal
        }
        // Vor dem Zahlen abbuchen und merken: So zahlt ein Abbruch nie doppelt.
        const s = this.stand();
        const jetzt = s.offen.find((x) => x.ziel === o.ziel);
        if (!jetzt || jetzt.msat < msat) continue;
        jetzt.msat -= msat;
        s.unklar.push({ ziel: o.ziel, msat, anteile: jetzt.anteile, rechnung, at: this.jetzt() });
        await this.speichere(s);
        try {
          await z.zahle(rechnung, msat);
        } catch {
          ergebnis.unklarMsat += msat;
          continue;
        }
        const nachher = this.stand();
        nachher.unklar = nachher.unklar.filter((u) => u.rechnung !== rechnung);
        await this.speichere(nachher);
        ergebnis.gezahltMsat += msat;
      }
    } finally {
      this.laeuft = false;
    }
    return ergebnis;
  }

  /** Eine unklare Zahlung erledigen: gezahlt (weg) oder nicht (zurück in die Kasse). */
  async klaere(rechnung: string, gezahlt: boolean): Promise<void> {
    const s = this.stand();
    const u = s.unklar.find((x) => x.rechnung === rechnung);
    if (!u) return;
    s.unklar = s.unklar.filter((x) => x !== u);
    if (!gezahlt) {
      const o = s.offen.find((x) => x.ziel === u.ziel);
      if (o) {
        o.msat += u.msat;
        for (const a of u.anteile) if (!o.anteile.includes(a)) o.anteile.push(a);
      } else {
        s.offen.push({ ziel: u.ziel, msat: u.msat, anteile: u.anteile });
      }
    }
    await this.speichere(s);
  }

  private async speichere(s: KassenStand): Promise<void> {
    s.offen = s.offen.filter((o) => o.msat > 0);
    await this.p.speicher.setItem(LS_ANTEILE, JSON.stringify(s));
  }

  private jetzt(): number {
    return this.p.jetzt?.() ?? Math.floor(Date.now() / 1000);
  }
}
