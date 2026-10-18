/**
 * Posteingang nach einer Pause mit dem eigenen Knoten abgleichen (B-35c, Entscheidung NG2 A vom 18.10.2026): Nur die
 * App darf sich als Empfänger ihrer Umschläge anmelden – der Knoten kennt den Schlüssel nicht. Nach einer Pause holt
 * sie, was an ihren Posteingängen liegt und dem Knoten fehlt, und legt es auch beim Knoten ab. Was fehlt, findet
 * Negentropy (NIP-77, `WebSocketRelay.abgleiche()`), ohne alle Umschläge zu laden – geladen wird nur das Fehlende.
 *
 * Ohne DOM und ohne Netz: die Wege gibt der Aufrufer (`shell/posteingang-knoten.ts`).
 */
import { NegFehler, NegSpeicher, type NostrEvent, type RelayFilter } from "@freedomstack/protocol";

export const POSTEINGANG_ABGLEICH = Object.freeze({
  /** Ab so langer Stille (Sekunden, Seite verborgen) gleicht die App ab – sonst bringt das Abo (A-15a) alles. */
  pauseSek: 10 * 60,
  /** Umschläge sind bis zu zwei Tage zurückdatiert (NIP-59) – so weit vor die letzte Runde zurück. */
  rueckSek: 2 * 24 * 3600,
  /** Ohne frühere Runde höchstens so weit zurück. */
  ersteSek: 30 * 24 * 3600,
  /** Ids je Abfrage beim Holen. */
  jeAbfrage: 100,
  /** Höchstens so viele Umschläge je Runde holen (der Flutschutz des Knotens nimmt 600 je Minute). */
  hoechstens: 500,
  /** So viele Umschläge fragt die App beim Knoten höchstens (wie die Relay-Rolle antwortet). */
  vomKnoten: 5000,
});

export interface AbgleichWege {
  /** REQ an genau diese Relays – nur gültig Signiertes. */
  frage(filter: RelayFilter, urls: readonly string[]): Promise<NostrEvent[]>;
  /** NIP-77 mit einem Relay; Fehler als `NegFehler`. */
  gleicheAb(url: string, filter: RelayFilter, speicher: NegSpeicher): Promise<{ habe: string[]; brauche: string[] }>;
  /** An genau ein Relay ablegen – wie viele nahmen an. */
  lege(ev: NostrEvent, url: string): Promise<number>;
}

export interface AbgleichErgebnis {
  /** Umschläge vom Knoten und von den Posteingängen – zum Öffnen. */
  umschlaege: NostrEvent[];
  /** Von den Posteingängen geholt, was dem Knoten fehlte … */
  geholt: number;
  /** … und davon beim Knoten abgelegt. */
  abgelegt: number;
  /** Posteingänge ohne Abgleich (kein NIP-77, keine Anmeldung, keine Antwort) – nur mit Kennung. */
  ohne: { url: string; fall: string }[];
  /** Alles Geholte liegt jetzt beim Knoten – erst dann gilt die Runde. */
  vollstaendig: boolean;
}

/** Seit wann: vor die letzte Runde um die Rückdatierung zurück, ohne Runde höchstens `ersteSek`. */
export function abgleichSeit(letzteRunde: number | null, jetzt: number): number {
  const fruehestens = jetzt - POSTEINGANG_ABGLEICH.ersteSek;
  return letzteRunde === null ? fruehestens : Math.max(fruehestens, letzteRunde - POSTEINGANG_ABGLEICH.rueckSek);
}

const HEX64 = /^[0-9a-f]{64}$/;
const an = (ev: NostrEvent, ich: string, seit: number): boolean =>
  ev.kind === 1059 && ev.created_at >= seit && ev.tags.some((t) => t[0] === "p" && t[1] === ich);

/**
 * Eine Runde: die Umschläge beim Knoten als eigener Stand, Negentropy mit jedem anderen Posteingang, das Fehlende in
 * Stücken holen und beim Knoten ablegen. Ein Posteingang ohne NIP-77 bleibt aus (`ohne`) – nie alles laden.
 */
export async function gleichePosteingangAb(
  ich: string, knotenUrl: string, posteingaenge: readonly string[], seit: number, wege: AbgleichWege,
): Promise<AbgleichErgebnis> {
  const filter: RelayFilter = { kinds: [1059], "#p": [ich], since: seit };
  const bekannt = new Set<string>();
  const beimKnoten: NostrEvent[] = [];
  for (const ev of await wege.frage({ ...filter, limit: POSTEINGANG_ABGLEICH.vomKnoten }, [knotenUrl])) {
    if (!an(ev, ich, seit) || bekannt.has(ev.id)) continue;
    bekannt.add(ev.id);
    beimKnoten.push(ev);
  }
  const speicher = new NegSpeicher();
  for (const ev of beimKnoten) speicher.einfuegen(ev.created_at, ev.id);
  const stand = speicher.versiegeln();

  const neu: NostrEvent[] = [];
  const ohne: AbgleichErgebnis["ohne"] = [];
  for (const url of [...new Set(posteingaenge)].filter((u) => u !== knotenUrl)) {
    let brauche: string[];
    try {
      brauche = (await wege.gleicheAb(url, filter, stand)).brauche;
    } catch (e) {
      ohne.push({ url, fall: e instanceof NegFehler ? e.fall : "neg.fehler" });
      continue;
    }
    const offen = [...new Set(brauche)].filter((id) => HEX64.test(id) && !bekannt.has(id))
      .slice(0, Math.max(0, POSTEINGANG_ABGLEICH.hoechstens - neu.length));
    for (let i = 0; i < offen.length; i += POSTEINGANG_ABGLEICH.jeAbfrage) {
      const stueck = offen.slice(i, i + POSTEINGANG_ABGLEICH.jeAbfrage);
      const gesucht = new Set(stueck);
      for (const ev of await wege.frage({ ids: stueck }, [url])) {
        if (!gesucht.has(ev.id) || !an(ev, ich, seit) || bekannt.has(ev.id)) continue;
        bekannt.add(ev.id);
        neu.push(ev);
      }
    }
  }

  let abgelegt = 0;
  for (const ev of neu) if ((await wege.lege(ev, knotenUrl).catch(() => 0)) > 0) abgelegt++;
  return { umschlaege: [...beimKnoten, ...neu], geholt: neu.length, abgelegt, ohne, vollstaendig: abgelegt === neu.length };
}
