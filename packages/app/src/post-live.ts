/**
 * Post sofort (A-15a, Nutzertest 08.10.2026, Befund C-12): Neue Direktnachrichten erschienen erst mit dem
 * Abgleich des Posteingangs – höchstens einmal je Minute, gemessen 89 s. Solange die App offen ist, hält sie
 * deshalb ein Abo an den eigenen Schlüssel und öffnet, was dort neu ankommt, sofort – mit derselben Kette wie
 * der Abgleich (`oeffneUmschlag()`), je Umschlag nur einmal.
 *
 * - Kein `since`: Chat-Umschläge sind bis zu zwei Tage zurückdatiert (NIP-59, `MAX_TIME_JITTER_SECS`) – ein
 *   Abo „ab jetzt“ sähe sie nie (darum kommen sie über das Abo für Anrufe nicht an, B-13e). `limit: 1`: Was
 *   schon liegt, holt der Abgleich; das Abo ist nur für Neues.
 * - Anrufe nicht: die hat ihr eigenes Abo (`vielleichtAnruf()`), sonst liefe ein Angebot zweimal durch.
 * - Höchstens `POST_LIVE_JE_MINUTE` Umschläge je Minute öffnet das Abo selbst – wer den Schlüssel mit
 *   Umschlägen flutet, bekommt nicht je Umschlag eine Entschlüsselung (mit Bunker je eine Anfrage); der Rest
 *   kommt wie bisher mit dem Abgleich.
 */
import { vielleichtAnruf } from "./anruf-ablauf.js";

export const POST_LIVE_JE_MINUTE = 30;

/** Filter des Abos – ohne `since` (zurückdatiert), nur Neues (`limit: 1`). */
export function postFilter(ich: string): { kinds: number[]; "#p": string[]; limit: number } {
  return { kinds: [1059], "#p": [ich], limit: 1 };
}

type Umschlag = { id: string; kind: number; created_at: number; tags: string[][] };

/** Entscheidet je Umschlag aus dem Abo, ob die App ihn gleich öffnet. */
export class LivePost {
  private minute = -1;
  private zahl = 0;

  constructor(private readonly uhrMs: () => number = () => Date.now()) {}

  /** Gleich öffnen? Nicht schon Geöffnetes, keine Anrufe, nicht über der Grenze je Minute. */
  nimm(w: Umschlag, bekannt: (id: string) => boolean): boolean {
    const ms = this.uhrMs();
    if (w.kind !== 1059 || bekannt(w.id) || vielleichtAnruf(w, Math.floor(ms / 1000))) return false;
    const m = Math.floor(ms / 60_000);
    if (m !== this.minute) {
      this.minute = m;
      this.zahl = 0;
    }
    if (this.zahl >= POST_LIVE_JE_MINUTE) return false;
    this.zahl++;
    return true;
  }
}

/**
 * Einen Abgleich nachziehen (A-15b, MLS in der offenen Unterhaltung): nie zwei Läufe zugleich – die
 * MLS-Engine weist einen zweiten Aufruf ab („MLS beschäftigt“). Was während eines Laufs anstößt, gibt
 * genau einen weiteren, frühestens `abstandMs` danach; so bremst sich auch ein Relay, das Abo-Treffer flutet.
 */
export class Nachziehen {
  private laeuft = false;
  private nochmal = false;

  constructor(
    private readonly lauf: () => Promise<void>,
    private readonly abstandMs = 2_000,
    private readonly planen: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms); },
  ) {}

  anstossen(): void {
    if (this.laeuft) {
      this.nochmal = true;
      return;
    }
    this.laeuft = true;
    void this.lauf().catch(() => undefined).finally(() => {
      if (!this.nochmal) {
        this.laeuft = false;
        return;
      }
      this.planen(() => {
        // Was bis hier anstieß – auch in der Pause –, deckt der Lauf, der jetzt beginnt
        this.laeuft = false;
        this.nochmal = false;
        this.anstossen();
      }, this.abstandMs);
    });
  }
}
