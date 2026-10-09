/**
 * Agenten auf dem Gerät (11.3c1, Entwurf `docs/AGENTEN-RAUM-ENTWURF.md` P4/P5,
 * Entscheidungen F3 B und F4 A vom 08.10.2026).
 *
 * Ein Agent hat einen eigenen Schlüssel – nie die Identität des Erstellers,
 * sonst spräche er mit dessen Stimme. Persona und Systemanweisung liegen nur
 * hier (F4 A), nie in der Karte. Alles steht nur im Tresor (`freedom.agenten`,
 * nie in der Sicherung, nie im Export).
 *
 * Bezahlt wird je Raum aus einem Budget des Erstellers (F3 B – auch wenn ein
 * anderer fragt): höchstens `monat` im Monat und `tag` am Tag (beides UTC), in
 * der Einheit der Schiene, über die er zahlt (msat über Lightning, Lamports über
 * den Zahlkanal). Kein Agent zahlt je darüber: `reicht()` vor dem Auftrag mit
 * dem Gebot, `buche()` nach der Antwort mit dem Preis. Ist eine Grenze erreicht,
 * sagt er das je Zeitraum einmal im Raum (`meldeEinmal()`).
 */
import { AGENT_GRENZEN, LocalSigner, fromHex, generateKeypair, leseRaumAdresse, toHex } from "@freedomstack/protocol";
import { t } from "./i18n.js";
import type { GeheimSpeicher } from "./vault.js";

export const LS_AGENTEN = "freedom.agenten";
/** Grenzen des Buchs – die Persona geht mit jedem Auftrag versiegelt an den Provider. */
export const AGENTEN_BUCH_GRENZEN = Object.freeze({ persona: 4000, agenten: 20, raeumeJeAgent: 50 });

export type BudgetEinheit = "msat" | "lamports";

export interface RaumBudget {
  /** Offener Raum: Adresse `34700:<gründer>:space:<kennung>`; privat (ab 11.3c3): die Gruppe (64 Hex). */
  raum: string;
  einheit: BudgetEinheit;
  /** Höchstens so viel im Monat (UTC) … */
  monat: number;
  /** … und am Tag (UTC). */
  tag: number;
  /** Verbraucht im Monat `imMonat.zeit` bzw. am Tag `amTag.zeit`. */
  imMonat: { zeit: string; wert: number };
  amTag: { zeit: string; wert: number };
  /** Zeitraum, für den der Agent schon gesagt hat, dass sein Budget erreicht ist. */
  gemeldet?: string;
}

export interface GeraeteAgent {
  pk: string;
  /** Geheimer Schlüssel (Hex) – nur im Tresor. */
  sk: string;
  name: string;
  about?: string;
  persona: string;
  modell?: string;
  raeume: RaumBudget[];
}

export interface AgentDaten {
  name: string;
  about?: string;
  persona: string;
  modell?: string;
}

/** Warum ein Auftrag nicht ins Budget passt. */
export type Engpass = "kein-raum" | "monat" | "tag";

const HEX64 = /^[0-9a-f]{64}$/;
const monatVon = (sek: number): string => new Date(sek * 1000).toISOString().slice(0, 7);
const tagVon = (sek: number): string => new Date(sek * 1000).toISOString().slice(0, 10);
const betrag = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
// Steuerzeichen außer Zeilenumbruch und Tab – die Persona ist mehrzeilig
const STEUER = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const text = (s: unknown, max: number, mehrzeilig = false): s is string =>
  typeof s === "string" && s.trim().length > 0 && [...s].length <= max && !(mehrzeilig ? STEUER : /[\u0000-\u001f\u007f]/).test(s);

/** Ein Raum ist eine Adresse eines offenen Raums oder eine Gruppe. */
export const istRaumZiel = (r: unknown): r is string => typeof r === "string" && (leseRaumAdresse(r) !== null || HEX64.test(r));

function pruefeDaten(d: AgentDaten): void {
  if (!text(d.name, AGENT_GRENZEN.name)) throw new Error(t("agentRaum.ungueltig"));
  if (d.about !== undefined && !text(d.about, AGENT_GRENZEN.about)) throw new Error(t("agentRaum.ungueltig"));
  if (!text(d.persona, AGENTEN_BUCH_GRENZEN.persona, true)) throw new Error(t("agentRaum.ungueltig"));
  if (d.modell !== undefined && !text(d.modell, AGENT_GRENZEN.modell)) throw new Error(t("agentRaum.ungueltig"));
}

function leseBudget(o: unknown): RaumBudget | null {
  const b = o as Partial<RaumBudget> | null;
  if (!b || typeof b !== "object" || !istRaumZiel(b.raum)) return null;
  if (b.einheit !== "msat" && b.einheit !== "lamports") return null;
  if (!betrag(b.monat) || !betrag(b.tag) || b.tag === 0 || b.tag > b.monat) return null;
  const zeit = (z: unknown, laenge: number): z is { zeit: string; wert: number } => {
    const v = z as { zeit?: unknown; wert?: unknown } | null;
    return !!v && typeof v.zeit === "string" && v.zeit.length === laenge && betrag(v.wert);
  };
  if (!zeit(b.imMonat, 7) || !zeit(b.amTag, 10)) return null;
  return {
    raum: b.raum, einheit: b.einheit, monat: b.monat, tag: b.tag,
    imMonat: { zeit: b.imMonat.zeit, wert: b.imMonat.wert }, amTag: { zeit: b.amTag.zeit, wert: b.amTag.wert },
    ...(typeof b.gemeldet === "string" && b.gemeldet.length <= 16 ? { gemeldet: b.gemeldet } : {}),
  };
}

function leseAgent(o: unknown): GeraeteAgent | null {
  const a = o as Partial<GeraeteAgent> | null;
  if (!a || typeof a !== "object" || typeof a.pk !== "string" || typeof a.sk !== "string" || !HEX64.test(a.sk)) return null;
  // Der Schlüssel muss zum Namen passen – sonst signierte der Agent als ein anderer
  if (new LocalSigner(fromHex(a.sk)).publicKey() !== a.pk) return null;
  try {
    pruefeDaten({ name: a.name as string, about: a.about, persona: a.persona as string, modell: a.modell });
  } catch {
    return null;
  }
  const raeume = Array.isArray(a.raeume) ? a.raeume.map(leseBudget) : [];
  if (raeume.some((r) => r === null) || raeume.length > AGENTEN_BUCH_GRENZEN.raeumeJeAgent) return null;
  return {
    pk: a.pk, sk: a.sk, name: a.name!, persona: a.persona!, raeume: raeume as RaumBudget[],
    ...(a.about !== undefined ? { about: a.about } : {}),
    ...(a.modell !== undefined ? { modell: a.modell } : {}),
  };
}

/** Das Buch streng lesen – Kaputtes fällt weg, doppelte Agenten zählen einmal. */
export function leseAgentenBuch(roh: string | null): GeraeteAgent[] {
  if (!roh) return [];
  try {
    const liste = JSON.parse(roh) as unknown;
    if (!Array.isArray(liste)) return [];
    const out: GeraeteAgent[] = [];
    for (const o of liste.slice(0, AGENTEN_BUCH_GRENZEN.agenten)) {
      const a = leseAgent(o);
      if (a && !out.some((x) => x.pk === a.pk)) out.push(a);
    }
    return out;
  } catch {
    return [];
  }
}

/** Verbrauch im laufenden Monat und Tag – ein vergangener Zeitraum zählt nicht mehr. */
function aktuell(b: RaumBudget, jetzt: number): { imMonat: number; amTag: number } {
  return {
    imMonat: b.imMonat.zeit === monatVon(jetzt) ? b.imMonat.wert : 0,
    amTag: b.amTag.zeit === tagVon(jetzt) ? b.amTag.wert : 0,
  };
}

/** Die Agenten dieses Geräts – gelesen und geschrieben nur über `geheim`. */
export class AgentenBuch {
  constructor(
    private readonly speicher: Pick<GeheimSpeicher, "getItem" | "setItem">,
    private readonly uhr: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  alle(): GeraeteAgent[] {
    return leseAgentenBuch(this.speicher.getItem(LS_AGENTEN));
  }

  agent(pk: string): GeraeteAgent | undefined {
    return this.alle().find((a) => a.pk === pk);
  }

  async #schreibe(alle: GeraeteAgent[]): Promise<void> {
    await this.speicher.setItem(LS_AGENTEN, JSON.stringify(alle));
  }

  async #aendere(pk: string, f: (a: GeraeteAgent) => GeraeteAgent | null): Promise<void> {
    const alle = this.alle();
    const i = alle.findIndex((a) => a.pk === pk);
    if (i < 0) throw new Error(t("agentRaum.unbekannt"));
    const neu = f(alle[i]!);
    if (neu) alle[i] = neu;
    else alle.splice(i, 1);
    await this.#schreibe(alle);
  }

  /** Einen Agenten anlegen – mit frischem Schlüssel, der das Gerät nie verlässt. */
  async legeAn(d: AgentDaten): Promise<GeraeteAgent> {
    pruefeDaten(d);
    const alle = this.alle();
    if (alle.length >= AGENTEN_BUCH_GRENZEN.agenten) throw new Error(t("agentRaum.zuViele", { n: AGENTEN_BUCH_GRENZEN.agenten }));
    const kp = generateKeypair();
    const agent: GeraeteAgent = {
      pk: kp.pk, sk: toHex(kp.sk), name: d.name, persona: d.persona, raeume: [],
      ...(d.about !== undefined ? { about: d.about } : {}),
      ...(d.modell !== undefined ? { modell: d.modell } : {}),
    };
    kp.sk.fill(0);
    await this.#schreibe([...alle, agent]);
    return agent;
  }

  /** Mit diesem Schlüssel signiert der Agent – nur er, nie die Identität. */
  signer(pk: string): LocalSigner | null {
    const a = this.agent(pk);
    return a ? new LocalSigner(fromHex(a.sk)) : null;
  }

  /** Budget für einen Raum setzen; gleiche Einheit behält den Verbrauch, eine andere beginnt neu. */
  async setzeBudget(pk: string, raum: string, b: { einheit: BudgetEinheit; monat: number; tag: number }): Promise<void> {
    if (!istRaumZiel(raum) || (b.einheit !== "msat" && b.einheit !== "lamports")) throw new Error(t("agentRaum.ungueltig"));
    if (!betrag(b.monat) || !betrag(b.tag) || b.tag === 0 || b.tag > b.monat) throw new Error(t("agentRaum.ungueltig"));
    const jetzt = this.uhr();
    await this.#aendere(pk, (a) => {
      const bisher = a.raeume.find((r) => r.raum === raum);
      const leer = { imMonat: { zeit: monatVon(jetzt), wert: 0 }, amTag: { zeit: tagVon(jetzt), wert: 0 } };
      const neu: RaumBudget = { raum, einheit: b.einheit, monat: b.monat, tag: b.tag, ...(bisher?.einheit === b.einheit ? { imMonat: bisher.imMonat, amTag: bisher.amTag } : leer) };
      const raeume = [...a.raeume.filter((r) => r.raum !== raum), neu];
      if (raeume.length > AGENTEN_BUCH_GRENZEN.raeumeJeAgent) throw new Error(t("agentRaum.zuVieleRaeume", { n: AGENTEN_BUCH_GRENZEN.raeumeJeAgent }));
      return { ...a, raeume };
    });
  }

  async entferneRaum(pk: string, raum: string): Promise<void> {
    await this.#aendere(pk, (a) => ({ ...a, raeume: a.raeume.filter((r) => r.raum !== raum) }));
  }

  /** Den Agenten ganz entfernen – sein Schlüssel ist danach weg. */
  async entferne(pk: string): Promise<void> {
    await this.#aendere(pk, () => null);
  }

  budget(pk: string, raum: string): RaumBudget | undefined {
    return this.agent(pk)?.raeume.find((r) => r.raum === raum);
  }

  /** Passt ein Auftrag mit höchstens `hoechst` (in der Einheit des Budgets) noch hinein? */
  reicht(pk: string, raum: string, hoechst: number): { ja: true } | { ja: false; grund: Engpass } {
    const b = this.budget(pk, raum);
    if (!b || !betrag(hoechst)) return { ja: false, grund: "kein-raum" };
    const v = aktuell(b, this.uhr());
    if (v.imMonat + hoechst > b.monat) return { ja: false, grund: "monat" };
    if (v.amTag + hoechst > b.tag) return { ja: false, grund: "tag" };
    return { ja: true };
  }

  /** Was eine Antwort kostete, verbuchen – im laufenden Monat und Tag. */
  async buche(pk: string, raum: string, preis: number): Promise<void> {
    if (!betrag(preis)) throw new Error(t("agentRaum.ungueltig"));
    const jetzt = this.uhr();
    await this.#aendere(pk, (a) => ({
      ...a,
      raeume: a.raeume.map((r) => {
        if (r.raum !== raum) return r;
        const v = aktuell(r, jetzt);
        return { ...r, imMonat: { zeit: monatVon(jetzt), wert: v.imMonat + preis }, amTag: { zeit: tagVon(jetzt), wert: v.amTag + preis } };
      }),
    }));
  }

  /**
   * Budget erreicht: true nur beim ersten Mal je Zeitraum (Monat bzw. Tag) –
   * dann sagt der Agent es im Raum, danach schweigt er.
   */
  async meldeEinmal(pk: string, raum: string, grund: "monat" | "tag"): Promise<boolean> {
    const jetzt = this.uhr();
    const zeitraum = grund === "monat" ? `m:${monatVon(jetzt)}` : `t:${tagVon(jetzt)}`;
    if (this.budget(pk, raum)?.gemeldet === zeitraum) return false;
    await this.#aendere(pk, (a) => ({ ...a, raeume: a.raeume.map((r) => (r.raum === raum ? { ...r, gemeldet: zeitraum } : r)) }));
    return true;
  }

  /** Agenten mit mindestens einem offenen Raum – nur sie stehen in der öffentlichen Liste des Besitzers (F1 A). */
  inOffenenRaeumen(): string[] {
    return this.alle().filter((a) => a.raeume.some((r) => leseRaumAdresse(r.raum) !== null)).map((a) => a.pk);
  }
}
