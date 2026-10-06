/**
 * Eigene Messung der Provider (Freedom-Prüfung P2a, E7, `docs/FREEDOM-PRUEFUNG.md` 3.1).
 *
 * Je Provider die letzten 100 Anfragen: Erfolg und Zeit bis zur Antwort. Die
 * Messung bleibt auf dem Gerät – nur im Tresor (`freedom.messungen`), nie in
 * der Sicherung, nie auf einem Relay. Gezählt werden nur Fehler des Providers
 * (keine Antwort in der Frist, kaputtes Ergebnis); Ablehnungen nicht – sie
 * sind oft Fehler des Nutzers (Gebot zu niedrig, Kanal leer) –, Abbrüche auch nicht.
 */
import { type MessStand, type Messpunkt, PRUEF_GRENZEN, fasseMessungZusammen, merkeMesspunkt } from "@freedomstack/protocol";

export const LS_MESSUNGEN = "freedom.messungen";
/** Höchstens so viele Provider – die zuletzt gemessenen bleiben. */
export const MESS_PROVIDER_MAX = 200;

export interface MessSpeicher {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void | Promise<void>;
}

const HEX64 = /^[0-9a-f]{64}$/;
const ZEIT_MAX = 10_000_000_000;

function lesePunkt(x: unknown): Messpunkt | null {
  const p = x as { zeit?: unknown; ok?: unknown; ms?: unknown; einig?: unknown } | null;
  if (!p || typeof p.ok !== "boolean" || !Number.isSafeInteger(p.zeit) || (p.zeit as number) < 0 || (p.zeit as number) > ZEIT_MAX) return null;
  if (p.ms !== undefined && (!Number.isSafeInteger(p.ms) || (p.ms as number) < 0)) return null;
  if (p.einig !== undefined && typeof p.einig !== "boolean") return null;
  return { zeit: p.zeit as number, ok: p.ok, ...(p.ms !== undefined ? { ms: p.ms as number } : {}), ...(p.einig !== undefined ? { einig: p.einig } : {}) };
}

export class MessBuch {
  constructor(private speicher: MessSpeicher) {}

  /** Alle Messpunkte je Provider – streng gelesen, Kaputtes fällt weg. */
  alle(): Map<string, Messpunkt[]> {
    const m = new Map<string, Messpunkt[]>();
    try {
      const roh = JSON.parse(this.speicher.getItem(LS_MESSUNGEN) ?? "{}") as unknown;
      if (!roh || typeof roh !== "object" || Array.isArray(roh)) return m;
      for (const [pk, punkte] of Object.entries(roh as Record<string, unknown>)) {
        if (!HEX64.test(pk) || !Array.isArray(punkte)) continue;
        const gut = punkte.map(lesePunkt).filter((p): p is Messpunkt => p !== null).slice(-PRUEF_GRENZEN.fenster);
        if (gut.length > 0) m.set(pk, gut);
      }
    } catch {
      /* kaputt – neu beginnen */
    }
    return m;
  }

  /** Einen Punkt anhängen; nur die letzten 100 je Provider, höchstens `MESS_PROVIDER_MAX` Provider. */
  async merke(pk: string, punkt: Messpunkt): Promise<void> {
    if (!HEX64.test(pk) || !lesePunkt(punkt)) return;
    const m = this.alle();
    const neu = merkeMesspunkt(m.get(pk) ?? [], punkt);
    m.delete(pk);
    m.set(pk, neu);
    const zuletzt = (pkt: Messpunkt[]) => pkt[pkt.length - 1]?.zeit ?? 0;
    const behalten = [...m.entries()].sort((a, b) => zuletzt(b[1]) - zuletzt(a[1])).slice(0, MESS_PROVIDER_MAX);
    await this.speicher.setItem(LS_MESSUNGEN, JSON.stringify(Object.fromEntries(behalten)));
  }

  /** Stand je Provider (Stufe, Ausfall jetzt, Median) – für die Auswahl. */
  staende(jetzt: number): Map<string, MessStand> {
    return new Map([...this.alle()].map(([pk, p]) => [pk, fasseMessungZusammen(p, jetzt)]));
  }
}

/**
 * Was ein Lauf über mehrere Provider (Failover, Hedging) ergibt: Wer antwortete,
 * zählt als Erfolg mit seiner Zeit – mit kaputtem Ergebnis als Fehler; wer seine
 * Frist verpasste und nicht doch noch antwortete, als Fehler. Wer noch in der
 * Frist war, als ein anderer antwortete, zählt nicht.
 */
export function ergebnisDesLaufs(
  gesendetMs: ReadonlyMap<string, number>,
  zuLangsam: ReadonlySet<string>,
  antwort: { pk: string; kaputt?: boolean } | null,
  jetztMs: number,
): Array<[string, Messpunkt]> {
  const zeit = Math.floor(jetztMs / 1000);
  const out: Array<[string, Messpunkt]> = [];
  if (antwort && gesendetMs.has(antwort.pk)) {
    out.push([antwort.pk, antwort.kaputt ? { zeit, ok: false } : { zeit, ok: true, ms: Math.max(0, jetztMs - gesendetMs.get(antwort.pk)!) }]);
  }
  for (const pk of zuLangsam) if (pk !== antwort?.pk && gesendetMs.has(pk)) out.push([pk, { zeit, ok: false }]);
  return out;
}
