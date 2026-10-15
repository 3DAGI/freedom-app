/**
 * Abonnierte Modellkataloge des Knotens (Schritt E9-4, V3 A aus
 * `docs/E9-ENTWURF.md`, freigegeben 08.10.2026, F5: kein voreingestellter).
 *
 * Der Betreiber nennt die Kataloge (38080), denen sein Knoten folgt:
 * `MODELL_KATALOGE=38080:<kurator>:<kennung>,…`. Nennt ein Eintrag darin das
 * Manifest eines Modells (viertes Feld), lädt der Knoten das Modell auch nach
 * diesem Manifest – nur genau dieser Id, nie nach einem anderen desselben
 * Autors (`katalogFreigaben()` → `vertrautesManifest()`). Das eigene Manifest
 * geht weiter vor. Eine Liste vertrauter Schlüssel daneben gibt es nicht.
 *
 * Die Kataloge fragt der Knoten bei seinen Relays nach dem Kurator – die Relays
 * sehen damit, welchen Kuratoren er folgt (die App holt dagegen alle, 5.7).
 * Gelesen wird nur gültig Signiertes, je Adresse der neueste.
 */
import {
  KIND_MODELL_KATALOG, type ModellKatalog, type NostrEvent, katalogFreigaben, leseKatalogAdresse, neuesteKataloge, verifyEvent,
} from "@freedomstack/protocol";

/** Höchstens so viele Kataloge – wie die Abos in der App (`ABOS_MAX`). */
export const KATALOGE_MAX = 20;
/** So lange gelten geholte Kataloge, bevor der Knoten sie neu fragt. */
export const KATALOGE_FRISCH_MS = 10 * 60_000;

/** `MODELL_KATALOGE` lesen: Adressen `38080:<kurator>:<kennung>`, durch Komma getrennt. Ungültig → Grund, kein Start. */
export function katalogeAusUmgebung(env: Record<string, string | undefined>): { adressen: string[]; grund?: string } {
  const roh = (env.MODELL_KATALOGE ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (roh.some((a) => leseKatalogAdresse(a) === null)) return { adressen: [], grund: "MODELL_KATALOGE enthält keine Katalog-Adresse (38080:<kurator>:<kennung>)" };
  const adressen = [...new Set(roh)];
  if (adressen.length > KATALOGE_MAX) return { adressen: [], grund: `MODELL_KATALOGE: höchstens ${KATALOGE_MAX} Kataloge` };
  return { adressen };
}

type Frage = (filter: { kinds: number[]; authors: string[]; limit: number }) => Promise<NostrEvent[]>;

/** Die abonnierten Kataloge holen: nur gültig signierte, je Adresse der neueste, nur abonnierte. */
export async function holeKataloge(frage: Frage, adressen: readonly string[]): Promise<ModellKatalog[]> {
  if (adressen.length === 0) return [];
  const kuratoren = [...new Set(adressen.map((a) => leseKatalogAdresse(a)!.kurator))];
  const evs = (await frage({ kinds: [KIND_MODELL_KATALOG], authors: kuratoren, limit: 50 * kuratoren.length })).filter((ev) => verifyEvent(ev));
  const alle = neuesteKataloge(evs);
  return adressen.map((a) => alle.get(a)).filter((k): k is ModellKatalog => k !== undefined);
}

/**
 * Freigaben je Modell aus den abonnierten Katalogen – geholt höchstens alle
 * `KATALOGE_FRISCH_MS`. Antworten die Relays nicht, gibt es keine Freigaben
 * (dann zählt nur das eigene Manifest), nie die alten von gestern.
 */
export class KatalogFreigaben {
  private stand?: { zeit: number; kataloge: ModellKatalog[] };
  constructor(private frage: Frage, readonly adressen: readonly string[], private jetzt = () => Date.now()) {}

  async kataloge(): Promise<ModellKatalog[]> {
    if (this.adressen.length === 0) return [];
    if (this.stand && this.jetzt() - this.stand.zeit < KATALOGE_FRISCH_MS) return this.stand.kataloge;
    try {
      const kataloge = await holeKataloge(this.frage, this.adressen);
      this.stand = { zeit: this.jetzt(), kataloge };
      return kataloge;
    } catch {
      this.stand = undefined;
      return [];
    }
  }

  async fuer(modell: string): Promise<Set<string>> {
    return katalogFreigaben(await this.kataloge(), modell);
  }
}
