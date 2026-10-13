/**
 * Verbindungen zu Relays außerhalb des Pools (A-16, Nutzertest 08.10.2026, Befund N-1): Mit Tresor und MLS
 * öffnete die App je rund 140 WebSockets in 45 Minuten – `frageAn()` baute je Abfrage und Adresse eine neue
 * Verbindung auf und schloss sie danach, auch für Relays, die der Pool ohnehin offen hielt.
 *
 * Relays des Pools fragt die App seit A-16 über dessen Verbindung (`OutboxPool.queryAn()`/`subscribeAn()`/
 * `publishAn()`). Für die übrigen – Posteingänge von Kontakten, Relays einer MLS-Gruppe, Schreib-Relays nach
 * NIP-65 – hält dieser Baustein Verbindungen eine Weile offen und gibt sie wieder aus:
 * - je Art (die Identität, für die angemeldet wird) und Adresse höchstens eine;
 * - nach `ruheMs` ohne Gebrauch geschlossen, nie während sie gebraucht wird;
 * - höchstens `max` zugleich – darüber geht die am längsten ungenutzte, nie eine gebrauchte.
 *
 * Scheitert eine Verbindung (A-26), merkt sich der Baustein die Adresse `aussetzenMs` lang, nur im
 * Speicher: So lange plant der Outbox-Plan das Relay nicht ein (`ausgesetzt()`). Keine Rangliste.
 */
export const NEBEN_GRENZEN = Object.freeze({ max: 8, ruheMs: 120_000, aussetzenMs: 15 * 60_000 });

interface Schliessbar {
  close(): void;
}

interface Eintrag<V> {
  v: V;
  nutzer: number;
  zuletzt: number;
  uhr?: unknown;
}

export class Nebenverbindungen<V extends Schliessbar> {
  private readonly offen = new Map<string, Eintrag<V>>();
  /** Adresse → Zeitpunkt des letzten Fehlschlags (A-26). */
  private readonly fehler = new Map<string, number>();
  private readonly max: number;
  private readonly aussetzenMs: number;
  private readonly ruheMs: number;
  private readonly planen: (fn: () => void, ms: number) => unknown;
  private readonly abbrechen: (h: unknown) => void;
  private readonly jetzt: () => number;

  constructor(
    private readonly neu: (url: string) => V,
    o: { max?: number; ruheMs?: number; aussetzenMs?: number; planen?: (fn: () => void, ms: number) => unknown; abbrechen?: (h: unknown) => void; jetzt?: () => number } = {},
  ) {
    this.max = o.max ?? NEBEN_GRENZEN.max;
    this.aussetzenMs = o.aussetzenMs ?? NEBEN_GRENZEN.aussetzenMs;
    this.ruheMs = o.ruheMs ?? NEBEN_GRENZEN.ruheMs;
    this.planen = o.planen ?? ((fn, ms) => setTimeout(fn, ms));
    this.abbrechen = o.abbrechen ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.jetzt = o.jetzt ?? Date.now;
  }

  /** Wie viele gerade offen sind. */
  get anzahl(): number {
    return this.offen.size;
  }

  /** Eine Verbindung holen – die offene oder eine neue; danach mit `gib()` zurück. */
  hole(url: string, art = ""): V {
    const k = `${art}\u0000${url}`;
    let e = this.offen.get(k);
    if (!e) {
      e = { v: this.neu(url), nutzer: 0, zuletzt: 0 };
      this.offen.set(k, e);
    }
    if (e.uhr !== undefined) this.abbrechen(e.uhr);
    e.uhr = undefined;
    e.nutzer++;
    e.zuletzt = this.jetzt();
    this.raeumeAuf();
    return e.v;
  }

  /** Zurückgeben: ungebraucht schließt sie nach der Ruhezeit. */
  gib(url: string, art = ""): void {
    const k = `${art}\u0000${url}`;
    const e = this.offen.get(k);
    if (!e || e.nutzer === 0) return;
    e.nutzer--;
    e.zuletzt = this.jetzt();
    if (e.nutzer > 0) return;
    e.uhr = this.planen(() => {
      if (this.offen.get(k) === e && e.nutzer === 0) this.schliesse(k);
    }, this.ruheMs);
  }

  /** Holen, benutzen, zurückgeben – auch wenn `fn` wirft. Wirft `fn`, ist die Adresse eine Weile ausgesetzt. */
  async mit<T>(url: string, art: string, fn: (v: V) => Promise<T>): Promise<T> {
    const v = this.hole(url, art);
    try {
      const r = await fn(v);
      this.fehler.delete(url);
      return r;
    } catch (e) {
      this.fehler.set(url, this.jetzt());
      throw e;
    } finally {
      this.gib(url, art);
    }
  }

  /** Adressen, die in den letzten `aussetzenMs` scheiterten – ältere sind vergessen. */
  ausgesetzt(): Set<string> {
    const jetzt = this.jetzt();
    for (const [url, zeit] of this.fehler) if (jetzt - zeit >= this.aussetzenMs) this.fehler.delete(url);
    return new Set(this.fehler.keys());
  }

  /** Über `max`: die am längsten ungenutzten schließen – nie eine, die gerade gebraucht wird. */
  private raeumeAuf(): void {
    const frei = [...this.offen.entries()].filter(([, e]) => e.nutzer === 0).sort((a, b) => a[1].zuletzt - b[1].zuletzt);
    for (const [k] of frei) {
      if (this.offen.size <= this.max) return;
      this.schliesse(k);
    }
  }

  private schliesse(k: string): void {
    const e = this.offen.get(k);
    if (!e) return;
    if (e.uhr !== undefined) this.abbrechen(e.uhr);
    this.offen.delete(k);
    try {
      e.v.close();
    } catch { /* schon zu */ }
  }
}
