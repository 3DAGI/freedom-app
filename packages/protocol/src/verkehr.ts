/**
 * Verkehrsmuster (Schritt 6.4): Wann die App etwas sendet oder abfragt, verrät
 * mehr als der Inhalt. Gehen die Kopien einer Direktnachricht (an den
 * Empfänger, an sich selbst, an Geräte) im selben Augenblick hinaus, sieht
 * ein Relay, wer mit wem schreibt – obwohl jeder Umschlag einen eigenen
 * Wegwerf-Schlüssel trägt. Fragt die App im festen Takt ab, erkennt man sie am
 * Takt.
 *
 * Deshalb: jede Kopie mit eigener Zufallsverzögerung, Abfragen gebündelt in
 * einem Takt mit zufälligem Abstand. Zufall aus der Kryptografie –
 * `Math.random` ist vorhersagbar. Ein Mixnetz ist nur bewertet (docs/MIXNET.md).
 */

/** Gleichverteilt in [0, 1) aus `crypto.getRandomValues`. */
export function sichererZufall(): number {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
}

/** Zufällige Verzögerung in [0, maxMs] (ganze Millisekunden); 0 bei maxMs ≤ 0. */
export function zufallsVerzoegerung(maxMs: number, zufall: () => number = sichererZufall): number {
  if (!Number.isFinite(maxMs) || maxMs <= 0) return 0;
  return Math.floor(zufall() * (maxMs + 1));
}

/** Abstand mit Zufall: basis ± anteil · basis. */
export function mitZufall(basisMs: number, anteil = 0.5, zufall: () => number = sichererZufall): number {
  const a = Math.min(Math.max(anteil, 0), 1);
  return Math.round(basisMs * (1 - a + 2 * a * zufall()));
}

export interface TaktOptionen {
  /** Zufallsanteil des Abstands (Standard 0,5: basis/2 bis 1,5 · basis). */
  anteil?: number;
  zufall?: () => number;
  /** Zeitgeber (Tests). */
  planen?: (fn: () => void, ms: number) => unknown;
  abbrechen?: (h: unknown) => void;
}

/**
 * Wiederkehrende Abrufe in einem Takt mit zufälligem Abstand, gebündelt: Was
 * angemeldet ist, läuft im selben Schlag – statt vieler fester Zeitgeber, deren
 * Raster die App verrät. `jedenNten` streckt einen Abruf auf jeden n-ten Schlag.
 */
export class AbrufTakt {
  private abrufe: { name: string; fn: () => unknown; jedenNten: number }[] = [];
  private schlag = 0;
  private handle: unknown = null;
  private readonly o: Required<TaktOptionen>;

  constructor(private basisMs: number, o: TaktOptionen = {}) {
    this.o = {
      anteil: o.anteil ?? 0.5,
      zufall: o.zufall ?? sichererZufall,
      planen: o.planen ?? ((fn, ms) => setTimeout(fn, ms)),
      abbrechen: o.abbrechen ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
    };
  }

  melde(name: string, fn: () => unknown, jedenNten = 1): void {
    this.abrufe.push({ name, fn, jedenNten: Math.max(1, Math.floor(jedenNten)) });
  }

  /** Nächsten Schlag planen – je Schlag ein neuer Zufallsabstand. */
  start(): void {
    if (this.handle !== null) return;
    this.handle = this.o.planen(() => this.schlage(), mitZufall(this.basisMs, this.o.anteil, this.o.zufall));
  }

  stop(): void {
    if (this.handle !== null) this.o.abbrechen(this.handle);
    this.handle = null;
  }

  /** Ein Schlag: alle fälligen Abrufe zusammen, Fehler einzeln geschluckt. */
  schlage(): string[] {
    this.handle = null;
    this.schlag++;
    const faellig = this.abrufe.filter((a) => this.schlag % a.jedenNten === 0);
    for (const a of faellig) {
      try {
        void Promise.resolve(a.fn()).catch(() => {});
      } catch { /* nächster Schlag */ }
    }
    this.start();
    return faellig.map((a) => a.name);
  }
}
