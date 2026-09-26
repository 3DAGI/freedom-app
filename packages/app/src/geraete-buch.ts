/**
 * Geraete im Chat (Schritt 8.6b), ohne DOM.
 *
 * Die App versiegelt jede Chat-Nachricht zusaetzlich an die Geraete des
 * Empfaengers und an die eigenen (Vollmachten 38070 mit „nachrichten“, siehe
 * `geraete-post.ts` im Protokoll). Diese Kopien gehen an den Posteingang der
 * Person – Geraete lesen dort mit. Beim Oeffnen liest die Hauptidentitaet
 * auch fuer ihre Geraete (eigene Kopien), und Absender, die Geraete eines
 * Kontakts sind, erscheinen in dessen Unterhaltung.
 *
 * Vollmachten und Entzuege laedt das Buch je Person hoechstens einmal pro
 * Minute – ein Entzug wirkt also spaetestens nach einer Minute.
 */
import {
  KIND_DEVICE_GRANT, KIND_DEVICE_REVOKE, absenderPerson, alleGeraete, nachrichtenGeraete,
  type AbsenderZuordnung, type NostrEvent, type PrivateDm,
} from "@freedomstack/protocol";

export const GERAETE_FRISCH_MS = 60_000;
/** Mehr moegliche Eigentuemer je Geraet laedt das Buch nicht (fremde Vollmachten kann jeder ausstellen). */
export const MAX_EIGENTUEMER = 8;
const HEX64 = /^[0-9a-f]{64}$/;

type Abfrage = (filter: Record<string, unknown>) => Promise<NostrEvent[]>;

export class GeraeteBuch {
  private readonly personen = new Map<string, { at: number; evs: Promise<NostrEvent[]> }>();
  private readonly besitzer = new Map<string, { at: number; pks: Promise<string[]> }>();

  constructor(private readonly abfrage: Abfrage, private readonly jetzt: () => number = () => Date.now()) {}

  /** Vollmachten und Entzuege, die eine Person ausgestellt hat. */
  vonPerson(person: string): Promise<NostrEvent[]> {
    const alt = this.personen.get(person);
    if (alt && this.jetzt() - alt.at < GERAETE_FRISCH_MS) return alt.evs;
    const evs = this.abfrage({ kinds: [KIND_DEVICE_GRANT, KIND_DEVICE_REVOKE], authors: [person], limit: 200 })
      .then((l) => l.filter((ev) => ev.pubkey === person));
    // Ein Fehler (offline) bleibt nicht im Buch
    evs.catch(() => this.personen.delete(person));
    this.personen.set(person, { at: this.jetzt(), evs });
    return evs;
  }

  /** Nach eigenem Ausstellen oder Entziehen sofort neu laden. */
  vergiss(person: string): void {
    this.personen.delete(person);
  }

  /** Geraete, die von einer Nachricht an diese Person eine eigene Kopie bekommen. */
  async kopienFuer(person: string): Promise<string[]> {
    return nachrichtenGeraete(person, await this.vonPerson(person), Math.floor(this.jetzt() / 1000));
  }

  /** Alle je bevollmaechtigten Geraete – fuer sie liest die Person mit. */
  async alle(person: string): Promise<string[]> {
    return alleGeraete(person, await this.vonPerson(person));
  }

  /** Wer diesen Schluessel als Geraet bevollmaechtigt hat – Kontakte zuerst. */
  private eigentuemer(geraet: string, bevorzugt: (pk: string) => boolean): Promise<string[]> {
    const alt = this.besitzer.get(geraet);
    const pks = alt && this.jetzt() - alt.at < GERAETE_FRISCH_MS ? alt.pks
      : this.abfrage({ kinds: [KIND_DEVICE_GRANT], "#p": [geraet], limit: 50 }).then((l) => [...new Set(l.map((ev) => ev.pubkey))]);
    if (pks !== alt?.pks) {
      pks.catch(() => this.besitzer.delete(geraet));
      this.besitzer.set(geraet, { at: this.jetzt(), pks });
    }
    return pks.then((l) => l.filter((pk) => HEX64.test(pk) && pk !== geraet)
      .sort((a, b) => Number(bevorzugt(b)) - Number(bevorzugt(a))).slice(0, MAX_EIGENTUEMER));
  }

  /** Fuer wen spricht dieser Absender? */
  async zuordnen(absender: string, zeit: number, bevorzugt: (pk: string) => boolean): Promise<AbsenderZuordnung> {
    const eigentuemer = await this.eigentuemer(absender, bevorzugt);
    if (eigentuemer.length === 0) return { person: absender, gueltig: true, grund: "eigener Schlüssel" };
    const evs = (await Promise.all(eigentuemer.map((p) => this.vonPerson(p)))).flat();
    return absenderPerson(absender, zeit, evs, { nowSecs: Math.floor(this.jetzt() / 1000), bevorzugt });
  }
}

export interface DmZuordnung {
  /** In dieser Unterhaltung erscheint die Nachricht. */
  partner: string;
  /** Als Autor zeigen (und fuer ⚡): die Person, fuer die ein gueltiges Geraet schrieb – sonst der Absender. */
  autor: string;
  /** Als eigene Nachricht zeigen: vom Hauptschluessel oder einem gueltigen eigenen Geraet. */
  vonMir: boolean;
  /** Hinweis an der Nachricht – fester Text mit Geraetenamen (Fremddaten: im HTML escapen). */
  hinweis?: string;
  warnung?: boolean;
}

const ZEIT_UNBELEGT = "Gerät inzwischen entzogen, Zeitpunkt nicht belegt";

/**
 * Eine geoeffnete Nachricht zuordnen. `dm` kommt aus `openPrivateDm(…, {
 * auchFuer: buch.alle(ich) })`: Kopien eigener Geraete haben dort schon den
 * Kontakt als Partner. `ich` ist die Person; als Geraet (8.6c) ist `selbst`
 * der eigene Geraeteschluessel.
 */
export async function ordneDmZu(
  dm: PrivateDm, ich: string, buch: GeraeteBuch, istKontakt: (pk: string) => boolean, selbst: string = ich,
): Promise<DmZuordnung> {
  if (dm.from === ich || dm.from === selbst) return { partner: dm.partner, autor: ich, vonMir: true };
  if ((await buch.alle(ich)).includes(dm.from)) {
    const z = absenderPerson(dm.from, dm.createdAt, await buch.vonPerson(ich), { bevorzugt: (pk) => pk === ich });
    const name = z.geraet?.label ?? "?";
    if (z.gueltig && z.person === ich) {
      return z.geraet?.entzogen
        ? { partner: dm.partner, autor: ich, vonMir: true, hinweis: `von deinem Gerät „${name}“ – ${ZEIT_UNBELEGT}`, warnung: true }
        : { partner: dm.partner, autor: ich, vonMir: true, hinweis: `von deinem Gerät „${name}“` };
    }
    return { partner: dm.partner, autor: dm.from, vonMir: false, hinweis: `⚠ von deinem Gerät „${name}“ nach dem Entzug – nicht von dir`, warnung: true };
  }
  const z = await buch.zuordnen(dm.from, dm.createdAt, istKontakt);
  const fremd = { partner: dm.partner, autor: dm.from, vonMir: false };
  if (!z.geraet) return z.gueltig ? fremd : { ...fremd, hinweis: `⚠ ${z.grund}`, warnung: true };
  const name = z.geraet.label;
  if (!z.gueltig) return { ...fremd, hinweis: `⚠ als Gerät „${name}“ bevollmächtigt, aber: ${z.grund}`, warnung: true };
  return z.geraet.entzogen
    ? { partner: z.person, autor: z.person, vonMir: false, hinweis: `über Gerät „${name}“ – ${ZEIT_UNBELEGT}`, warnung: true }
    : { partner: z.person, autor: z.person, vonMir: false, hinweis: `über Gerät „${name}“` };
}
