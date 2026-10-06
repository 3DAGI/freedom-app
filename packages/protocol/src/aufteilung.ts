/**
 * Gebührenmodell A+ (Entscheidung 4.0 vom 26.09.2026, Schritt 5.1).
 *
 * Eine KI-Zahlung wird beim Zahlen fest aufgeteilt – kein Topf, niemand
 * verwahrt fremdes Geld:
 *
 *   94 %  Provider
 *   2,0 % Entwicklung (selbstverwahrte Adressen des Projekts)
 *   0,5 % Prüfbudget – bleibt beim Kunden und bezahlt seine Prüfrunden
 *         (Entscheidung 05.10.2026, P5b; vorher 2,5 % Entwicklung)
 *   1,5 % Relays, über die der Auftrag lief (höchstens drei, zu gleichen Teilen)
 *   0,5 % Werber des Kunden
 *   0,5 % Werber des Providers
 *   1 %   Hosting (App-Spiegel, von dem die App geladen wurde)
 *
 * Regeln (`docs/GEBUEHREN-ENTSCHEIDUNG.md`):
 * - Die App des Kunden zahlt jeden Anteil direkt an seinen Empfänger; der
 *   Provider stellt nur seinen Anteil in Rechnung.
 * - Nicht zuordenbar heißt: an den Provider – fehlt ein Empfänger mit einer
 *   Adresse für die Schiene der Zahlung, bleibt der Anteil beim Provider.
 *   Nie ein Topf, nie die Entwicklung.
 * - Fest voreingestellt: DIESE WERTE SIND PROTOKOLL-INVARIANTEN (CI prüft sie).
 *   Alle Anteile außer dem Provider zusammen höchstens 10 % – das prüft der
 *   Provider an der Deklaration im (versiegelten) Auftrag.
 * - Rundung: jeder Anteil wird abgerundet, der Rest bleibt beim Provider. Beide
 *   Seiten rechnen mit denselben Funktionen, so stimmt der Rechnungsbetrag.
 *
 * Ehrlich bleibt: Bei Lightning zahlt die App die Anteile – ein veränderter
 * Fork könnte sie weglassen. Bei SOL erzwingt es erst das Programm des
 * Zahlkanals (4.3); bis dahin gehen SOL-Aufträge ganz an den Provider.
 */

/** Anteil des Providers in ppm der Zahlung. */
export const PROVIDER_PPM = 940_000;

/** Die übrigen Anteile in ppm der Zahlung – nur diese, in dieser Reihenfolge. */
export const ANTEILE_PPM = {
  entwicklung: 20_000,
  pruefung: 5_000,
  relays: 15_000,
  "werber-kunde": 5_000,
  "werber-provider": 5_000,
  hosting: 10_000,
} as const;

export type Anteil = keyof typeof ANTEILE_PPM;
export const ANTEILE = Object.keys(ANTEILE_PPM) as Anteil[];

/** Obergrenze aller Anteile außer dem Provider (10 %). */
export const MAX_ANTEILE_PPM = 100_000;
/** Höchstens so viele Relays teilen sich ihren Anteil. */
export const MAX_RELAYS = 3;
/** Tag im (versiegelten) Auftrag: welche Anteile die App des Kunden selbst zahlt. */
export const TAG_AUFTEILUNG = "aufteilung";
/**
 * Fassung dieser Tabelle (P5b): Ein Knoten nennt sie im Angebot (`aufteilung`).
 * Erst ab Fassung 2 kennt er den Anteil `pruefung` und rechnet die Entwicklung
 * mit 2,0 % – ältere Knoten lehnen unbekannte Anteile ab und rechneten mit 2,5 %.
 */
export const AUFTEILUNG_FASSUNG = 2;
/** Anteile, die ein Knoten erst ab Fassung 2 so rechnet wie die App. */
const AB_FASSUNG_2: readonly Anteil[] = ["entwicklung", "pruefung"];

// Selbstprüfung beim Import – widersprüchliche Werte fallen sofort auf.
{
  const summe = PROVIDER_PPM + ANTEILE.reduce((s, a) => s + ANTEILE_PPM[a], 0);
  if (summe !== 1_000_000) throw new Error(`aufteilung: Anteile ergeben ${summe} ppm statt 1.000.000`);
  if (1_000_000 - PROVIDER_PPM > MAX_ANTEILE_PPM) throw new Error("aufteilung: Anteile über der Obergrenze");
}

export type Schiene = "lightning" | "solana";

/** Wohin ein Anteil geht: eine Lightning-Adresse und/oder eine SOL-Adresse. */
export interface Zahlziel {
  lud16?: string;
  sol?: string;
}

/**
 * Selbstverwahrte Adressen der Entwicklung – ändern nur mit signiertem Release.
 * MENSCH (vor 5.1 live): Lightning-Adresse über einen eigenen Knoten, SOL an
 * eine Mehrfachsignatur (5.9). Bis dahin leer: Der Anteil ist nicht
 * zuordenbar und bleibt beim Provider – nie eine Adresse bei einem Verwahrer.
 */
export const ENTWICKLUNG: Readonly<Zahlziel> = Object.freeze({});

/** Die bekannten Empfänger eines Auftrags – was fehlt, bleibt beim Provider. */
export interface Empfaenger {
  /** Fassung der Aufteilung, die der Knoten im Angebot nennt – ohne Angabe 1. */
  fassung?: number;
  entwicklung?: Zahlziel;
  /** Prüfbudget beim Kunden (P5b) – kein Empfänger, die App behält den Anteil. */
  pruefung?: boolean;
  relays?: readonly Zahlziel[];
  "werber-kunde"?: Zahlziel;
  "werber-provider"?: Zahlziel;
  hosting?: Zahlziel;
}

export interface Posten {
  anteil: Anteil;
  msat: number;
  /** Adresse auf der Schiene der Zahlung. */
  ziel: string;
}

const LUD16 = /^[a-z0-9._+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const LOKAL = /(^|\.)(localhost|local|onion)$|^(127|10|0)\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./i;

/**
 * Die Adresse eines Ziels auf dieser Schiene – oder undefined. Lightning nur
 * als Lightning-Adresse (`name@domain`, kein lokaler Host), SOL nur als
 * Base58-Adresse. Die Zahlung selbst prüft den Betrag der Rechnung (4.8).
 */
export function adresseFuer(z: Zahlziel | undefined, schiene: Schiene): string | undefined {
  if (!z) return undefined;
  if (schiene === "lightning") {
    const a = z.lud16?.trim();
    if (!a || a.length > 320 || !LUD16.test(a) || LOKAL.test(a.split("@")[1]!)) return undefined;
    return a.toLowerCase();
  }
  const s = z.sol?.trim();
  return s && SOL.test(s) ? s : undefined;
}

const anteilMsat = (betragMsat: number, a: Anteil) => Math.floor((betragMsat * ANTEILE_PPM[a]) / 1_000_000);

/**
 * Welche Anteile die App des Kunden selbst zahlt: die, für die es auf dieser
 * Schiene einen Empfänger gibt. Auf SOL vorerst keine (erst mit 4.3). Das
 * Prüfbudget behält die App, wenn es gewählt ist. Entwicklung und Prüfbudget
 * nur bei Knoten ab Fassung 2 – ältere rechnen anders, dann bleibt beides beim
 * Provider (nicht zuordenbar).
 */
export function zahlbareAnteile(e: Empfaenger, schiene: Schiene): Anteil[] {
  if (schiene === "solana") return [];
  const neu = (e.fassung ?? 1) >= AUFTEILUNG_FASSUNG;
  return ANTEILE.filter((a) => (neu || !AB_FASSUNG_2.includes(a)) && (
    a === "pruefung" ? e.pruefung === true
    : a === "relays" ? (e.relays ?? []).some((r) => adresseFuer(r, schiene))
    : adresseFuer(e[a], schiene) !== undefined));
}

/**
 * Den Betrag eines Auftrags aufteilen. `posten` zahlt die App des Kunden
 * direkt, `pruefbudgetMsat` behält sie als Prüfbudget; `providerMsat` stellt
 * der Provider in Rechnung. Summe = Betrag.
 */
export function teileAuf(betragMsat: number, e: Empfaenger, schiene: Schiene): { providerMsat: number; posten: Posten[]; pruefbudgetMsat: number } {
  if (!Number.isSafeInteger(betragMsat) || betragMsat < 0) throw new Error("aufteilung: Betrag ungültig");
  const posten: Posten[] = [];
  let pruefbudgetMsat = 0;
  for (const a of zahlbareAnteile(e, schiene)) {
    const msat = anteilMsat(betragMsat, a);
    if (a === "pruefung") {
      pruefbudgetMsat = msat;
      continue;
    }
    if (a !== "relays") {
      if (msat > 0) posten.push({ anteil: a, msat, ziel: adresseFuer(e[a], schiene)! });
      continue;
    }
    // Relays: die ersten mit Adresse, ohne Doppelte, zu gleichen Teilen; der Rest an den ersten
    const ziele = [...new Set((e.relays ?? []).map((r) => adresseFuer(r, schiene)).filter((x): x is string => !!x))].slice(0, MAX_RELAYS);
    const je = Math.floor(msat / ziele.length);
    ziele.forEach((ziel, i) => {
      const m = je + (i === 0 ? msat - je * ziele.length : 0);
      if (m > 0) posten.push({ anteil: "relays", msat: m, ziel });
    });
  }
  const anteile = [...new Set(posten.map((p) => p.anteil)), ...(pruefbudgetMsat > 0 ? ["pruefung" as const] : [])];
  return { providerMsat: providerAnteilMsat(betragMsat, anteile), posten, pruefbudgetMsat };
}

/**
 * Empfänger eines Zahlkanals (4.3d): die Anteile mit SOL-Adresse, je mit ihrem
 * Satz in ppm – beim Einlösen teilt das Programm auf (docs/ZAHLKANAL.md).
 * Relays wie in `teileAuf()`: höchstens drei, zu gleichen Teilen, der Rest an
 * den ersten. Eine Adresse, die mehrere Anteile bekommt, steht einmal da (mit
 * der Summe); `ausser` (Provider, Kunde) bekommt keinen – was fehlt, bleibt
 * beim Provider. Das Prüfbudget hat keinen Empfänger im Kanal (SOL folgt mit
 * P5d) und bleibt beim Provider.
 */
export function kanalEmpfaenger(e: Empfaenger, ausser: readonly string[] = []): Array<{ adresse: string; ppm: number }> {
  const ppm = new Map<string, number>();
  const plus = (adresse: string, n: number) => {
    if (n > 0 && !ausser.includes(adresse)) ppm.set(adresse, (ppm.get(adresse) ?? 0) + n);
  };
  for (const a of ANTEILE) {
    if (a === "pruefung") continue;
    if (a !== "relays") {
      const ziel = adresseFuer(e[a], "solana");
      if (ziel) plus(ziel, ANTEILE_PPM[a]);
      continue;
    }
    const ziele = [...new Set((e.relays ?? []).map((r) => adresseFuer(r, "solana")).filter((x): x is string => !!x))].slice(0, MAX_RELAYS);
    const je = Math.floor(ANTEILE_PPM.relays / Math.max(ziele.length, 1));
    ziele.forEach((ziel, i) => plus(ziel, je + (i === 0 ? ANTEILE_PPM.relays - je * ziele.length : 0)));
  }
  return [...ppm].map(([adresse, n]) => ({ adresse, ppm: n }));
}

/** Was der Provider in Rechnung stellt, wenn die App diese Anteile selbst zahlt. */
export function providerAnteilMsat(betragMsat: number, anteile: readonly Anteil[]): number {
  return betragMsat - [...new Set(anteile)].reduce((s, a) => s + anteilMsat(betragMsat, a), 0);
}

/** Deklaration für den (versiegelten) Auftrag: welche Anteile die App selbst zahlt. */
export function aufteilungTag(anteile: readonly Anteil[]): string[] {
  return [TAG_AUFTEILUNG, ...ANTEILE.filter((a) => anteile.includes(a))];
}

export type AufteilungsPruefung =
  | { ok: true; anteile: Anteil[]; einbehaltenPpm: number }
  | { ok: false; grund: string };

/**
 * Die Deklaration eines Auftrags prüfen (Provider). Ohne Tag: nichts
 * einbehalten – der Provider stellt den ganzen Betrag in Rechnung. Mit Tag:
 * nur bekannte Anteile, jeder einmal, zusammen höchstens 10 %; den Werber des
 * Providers nur, wenn das Angebot einen nennt.
 */
export function pruefeAufteilung(tags: readonly string[][], p: { hatWerber: boolean }): AufteilungsPruefung {
  const alle = tags.filter((t) => t[0] === TAG_AUFTEILUNG);
  if (alle.length === 0) return { ok: true, anteile: [], einbehaltenPpm: 0 };
  if (alle.length > 1) return { ok: false, grund: "Aufteilung mehrfach deklariert" };
  const werte = alle[0]!.slice(1);
  const anteile: Anteil[] = [];
  for (const w of werte) {
    if (!(ANTEILE as string[]).includes(w)) return { ok: false, grund: "unbekannter Anteil in der Aufteilung" };
    if (anteile.includes(w as Anteil)) return { ok: false, grund: "Anteil doppelt deklariert" };
    anteile.push(w as Anteil);
  }
  if (anteile.includes("werber-provider") && !p.hatWerber) return { ok: false, grund: "Werber des Providers deklariert, aber keiner genannt" };
  const einbehaltenPpm = anteile.reduce((s, a) => s + ANTEILE_PPM[a], 0);
  if (einbehaltenPpm > MAX_ANTEILE_PPM) return { ok: false, grund: "Anteile über 10 %" };
  return { ok: true, anteile, einbehaltenPpm };
}
