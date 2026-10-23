/**
 * Funkparameter einer RNode (Sammlung B-32b, Entscheidung RN-W6 A, `docs/RETICULUM-ENTWURF.md`): Eine RNode sendet nur
 * mit dem, was man ihr beim Verbinden gibt – Frequenz, Bandbreite, Spreizfaktor, Kodierrate, Sendeleistung. Anders
 * als bei Meshtastic (7.5) steht die Region nicht im Gerät. Deshalb kommen die Werte aus einer Tabelle je Region mit
 * Quelle; man bestätigt sie vor dem ersten Senden, und Abweichen geht nur innerhalb der Grenzen der Region.
 *
 * Die Grenzen sind die des Rechts, die Vorgaben bleiben deutlich darunter (25 mW, wenig Sendezeit). Die Sendezeit
 * begrenzt zusätzlich die Firmware selbst (`airtimeLimitLong`, „long-term airtime lock“), auf den Wert der Region.
 * Regionen ohne Eintrag gibt es nicht: Dort sendet Freedom über RNode nicht.
 *
 * Seit B-32d1 im Protokoll (RN-W10 A): App und Knoten (B-32d2, `RETICULUM_REGION`) prüfen mit denselben Grenzen und
 * rechnen mit derselben Sendezeit.
 */

/** Was die RNode bekommt (Namen wie in reticulum-js). */
export interface FunkParameter {
  /** Mittenfrequenz in Hz. */
  frequency: number;
  /** Bandbreite in Hz. */
  bandwidth: number;
  spreadingFactor: number;
  codingRate: number;
  /** Sendeleistung am Ausgang der RNode, dBm. */
  txPower: number;
}

export interface FunkRegion {
  kennung: string;
  /** Erlaubter Bereich in Hz – das ganze Signal (Mitte ± halbe Bandbreite) muss darin liegen. */
  von: number;
  bis: number;
  /** Höchste Strahlungsleistung (e.r.p.) in mW. */
  maxErpMw: number;
  /** Höchster Anteil Sendezeit in Prozent. */
  maxSendezeitProzent: number;
  /** Was Freedom vorschlägt. */
  vorgabe: FunkParameter;
}

/**
 * Die Regionen (RN-W6 A). Nur, wofür eine Quelle genannt ist (die App zeigt sie je Region, `FUNK_QUELLE`); die Vorgaben liegen unter den Grenzen (Bandbreite
 * 125 kHz, SF 8, CR 4/5, 14 dBm bzw. 10 dBm am Ausgang). Quellen: Beschluss 2006/771/EG der Kommission
 * (Kurzstreckengeräte), geändert durch Durchführungsbeschluss (EU) 2019/1345, Anhang – Band 869,400–869,650 MHz: 500 mW
 * e.r.p., Sendezeit ≤ 10 %; Band 433,050–434,790 MHz: 10 mW e.r.p. bei Sendezeit ≤ 10 %; ebenso ERC/REC 70-03 Anhang 1
 * und ETSI EN 300 220 (Befund zur Quelle: `docs/RETICULUM-ENTWURF.md`, „Stand B-32b1“).
 */
export const FUNK_REGIONEN: readonly FunkRegion[] = Object.freeze([
  {
    kennung: "eu-869", von: 869_400_000, bis: 869_650_000, maxErpMw: 500, maxSendezeitProzent: 10,
    vorgabe: { frequency: 869_525_000, bandwidth: 125_000, spreadingFactor: 8, codingRate: 5, txPower: 14 },
  },
  {
    kennung: "eu-433", von: 433_050_000, bis: 434_790_000, maxErpMw: 10, maxSendezeitProzent: 10,
    vorgabe: { frequency: 433_775_000, bandwidth: 125_000, spreadingFactor: 8, codingRate: 5, txPower: 10 },
  },
]);

/** Bandbreiten, die eine RNode (SX127x/SX126x) kennt, in Hz. */
export const LORA_BANDBREITEN = Object.freeze([7_800, 10_400, 15_600, 20_800, 31_250, 41_700, 62_500, 125_000, 250_000, 500_000]);

/**
 * Höchste Leistung am Ausgang in dBm: die e.r.p.-Grenze, abgerundet. Das gilt für eine Antenne ohne Gewinn
 * gegenüber dem Dipol (0 dBd) – mit Gewinn muss die Leistung um ihn kleiner sein; das sagt der Text vor dem Senden.
 */
export function maxSendeleistungDbm(r: FunkRegion): number {
  return Math.floor(10 * Math.log10(r.maxErpMw));
}

export const FUNK_FAELLE = ["region", "frequenz", "bandbreite", "spreizfaktor", "kodierrate", "leistung", "form"] as const; // kein UI-Text
export type FunkFall = (typeof FUNK_FAELLE)[number];

/** Prüft Parameter gegen die Grenzen der Region – alle Werte ganze Zahlen, das Signal ganz im Band. */
export function pruefeFunkParameter(regionKennung: string, p: FunkParameter): { ok: true; region: FunkRegion } | { ok: false; fall: FunkFall } {
  const r = FUNK_REGIONEN.find((x) => x.kennung === regionKennung);
  if (!r) return { ok: false, fall: "region" };
  const ganz = (v: unknown): v is number => Number.isSafeInteger(v);
  if (![p.frequency, p.bandwidth, p.spreadingFactor, p.codingRate, p.txPower].every(ganz)) return { ok: false, fall: "form" };
  if (!LORA_BANDBREITEN.includes(p.bandwidth)) return { ok: false, fall: "bandbreite" };
  if (p.frequency - p.bandwidth / 2 < r.von || p.frequency + p.bandwidth / 2 > r.bis) return { ok: false, fall: "frequenz" };
  if (p.spreadingFactor < 7 || p.spreadingFactor > 12) return { ok: false, fall: "spreizfaktor" };
  if (p.codingRate < 5 || p.codingRate > 8) return { ok: false, fall: "kodierrate" };
  if (p.txPower < 0 || p.txPower > maxSendeleistungDbm(r)) return { ok: false, fall: "leistung" };
  return { ok: true, region: r };
}

/** Die Optionen für die RNode-Schnittstelle von reticulum-js – mit der Sendezeit-Sperre der Region in der Firmware. */
export function rnodeOptionen(w: { region: string; parameter: FunkParameter }): FunkParameter & { airtimeLimitLong: number } {
  const geprueft = pruefeFunkParameter(w.region, w.parameter);
  if (!geprueft.ok) throw new RangeError("Funkparameter"); // kein UI-Text
  const p = w.parameter;
  return {
    frequency: p.frequency, bandwidth: p.bandwidth, spreadingFactor: p.spreadingFactor, codingRate: p.codingRate, txPower: p.txPower,
    airtimeLimitLong: geprueft.region.maxSendezeitProzent,
  };
}

/**
 * Sendezeit eines Pakets mit `bytes` Byte über eine RNode, in Sekunden – Formel von Semtech (explizite Kopfzeile, CRC
 * an), Präambel wie die Firmware (mindestens 18 Symbole, sonst 24 ms). Die Firmware teilt Pakete über 254 Byte in zwei
 * Rahmen mit je einem Byte Kopf.
 */
export function rnodeSendezeit(p: FunkParameter, bytes: number): number {
  const symbol = 2 ** p.spreadingFactor / p.bandwidth;
  const de = symbol > 0.016 ? 1 : 0;
  const praeambel = Math.max(18, Math.ceil(0.024 / symbol));
  const rahmen = (n: number): number => {
    const nutz = 8 + Math.max(Math.ceil((8 * n - 4 * p.spreadingFactor + 28 + 16) / (4 * (p.spreadingFactor - 2 * de))) * p.codingRate, 0);
    return (praeambel + 4.25 + nutz) * symbol;
  };
  const mitKopf = bytes + 1;
  return mitKopf <= 255 ? rahmen(mitKopf) : rahmen(255) + rahmen(mitKopf - 254 + 1);
}
