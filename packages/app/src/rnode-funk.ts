/**
 * Funkparameter einer RNode (Sammlung B-32b, Entscheidung RN-W6 A, `docs/RETICULUM-ENTWURF.md`): Eine RNode sendet nur
 * mit dem, was die App ihr beim Verbinden gibt – Frequenz, Bandbreite, Spreizfaktor, Kodierrate, Sendeleistung. Anders
 * als bei Meshtastic (7.5) steht die Region nicht im Gerät. Deshalb kommen die Werte aus einer Tabelle je Region mit
 * Quelle; man bestätigt sie vor dem ersten Senden, und Abweichen geht nur innerhalb der Grenzen der Region.
 *
 * Die Grenzen sind die des Rechts, die Vorgaben bleiben deutlich darunter (25 mW, wenig Sendezeit). Die Sendezeit
 * begrenzt zusätzlich die Firmware selbst (`airtimeLimitLong`, „long-term airtime lock“), auf den Wert der Region.
 * Regionen ohne Eintrag gibt es nicht: Dort sendet die App über RNode nicht.
 */
import type { RNodeWebSerialInterface } from "@reticulum/core/src/interfaces/rnode-webserial.js";

/** Was die App der RNode gibt (Namen wie in `@reticulum/core`). */
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
  /** Was die App vorschlägt. */
  vorgabe: FunkParameter;
  /** Woher die Grenzen stammen – Schlüssel des Textes (in beiden Sprachen). */
  quelle: string;
}

/**
 * Die Regionen (RN-W6 A). Nur, wofür eine Quelle genannt ist; die Vorgaben liegen unter den Grenzen (Bandbreite
 * 125 kHz, SF 8, CR 4/5, 14 dBm bzw. 10 dBm am Ausgang). Quellen: Beschluss 2006/771/EG der Kommission
 * (Kurzstreckengeräte), geändert durch Durchführungsbeschluss (EU) 2019/1345, Anhang – Band 869,400–869,650 MHz: 500 mW
 * e.r.p., Sendezeit ≤ 10 %; Band 433,050–434,790 MHz: 10 mW e.r.p. bei Sendezeit ≤ 10 %; ebenso ERC/REC 70-03 Anhang 1
 * und ETSI EN 300 220 (Befund zur Quelle: `docs/RETICULUM-ENTWURF.md`, „Stand B-32b1“).
 */
export const FUNK_REGIONEN: readonly FunkRegion[] = Object.freeze([
  {
    kennung: "eu-869", von: 869_400_000, bis: 869_650_000, maxErpMw: 500, maxSendezeitProzent: 10, quelle: "set.rnodeQuelleEu869",
    vorgabe: { frequency: 869_525_000, bandwidth: 125_000, spreadingFactor: 8, codingRate: 5, txPower: 14 },
  },
  {
    kennung: "eu-433", von: 433_050_000, bis: 434_790_000, maxErpMw: 10, maxSendezeitProzent: 10, quelle: "set.rnodeQuelleEu433",
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

/**
 * Eigene Werte aus dem Dialog (B-32b4): Frequenz in MHz (Punkt oder Komma, höchstens 6 Nachkommastellen), sonst ganze
 * Zahlen – oder null. Ob die Werte erlaubt sind, sagt erst `pruefeFunkParameter()`.
 */
export function leseFunkEingabe(w: { frequenz?: unknown; bandbreite?: unknown; sf?: unknown; cr?: unknown; leistung?: unknown }): FunkParameter | null {
  const f = /^(\d{1,4})(?:[.,](\d{1,6}))?$/.exec(String(w.frequenz ?? "").trim());
  const zahl = (v: unknown, muster: RegExp): number | null => (muster.test(String(v ?? "").trim()) ? Number(String(v).trim()) : null);
  const bandwidth = zahl(w.bandbreite, /^\d{1,6}$/), spreadingFactor = zahl(w.sf, /^\d{1,2}$/), codingRate = zahl(w.cr, /^\d$/);
  const txPower = zahl(w.leistung, /^-?\d{1,2}$/);
  if (!f || bandwidth === null || spreadingFactor === null || codingRate === null || txPower === null) return null;
  return { frequency: Number(f[1]) * 1e6 + Number((f[2] ?? "").padEnd(6, "0")), bandwidth, spreadingFactor, codingRate, txPower };
}

/** Was die App sich merkt: Region, Parameter und wann man sie bestätigt hat (Unix-Sekunden). */
export interface FunkWahl {
  region: string;
  parameter: FunkParameter;
  bestaetigt: number;
}

export const LS_RETICULUM_FUNK = "freedom.reticulum.funk";

/** Die gemerkte Wahl streng lesen – nur bestätigt und innerhalb der Grenzen, sonst null. */
export function leseFunkWahl(text: string | null): FunkWahl | null {
  if (!text) return null;
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof roh !== "object" || roh === null) return null;
  const { region, parameter, bestaetigt } = roh as Record<string, unknown>;
  if (typeof region !== "string" || typeof parameter !== "object" || parameter === null) return null;
  if (!Number.isSafeInteger(bestaetigt) || (bestaetigt as number) <= 0) return null;
  const q = parameter as Record<string, unknown>;
  const p = { frequency: q.frequency, bandwidth: q.bandwidth, spreadingFactor: q.spreadingFactor, codingRate: q.codingRate, txPower: q.txPower } as FunkParameter;
  if (!pruefeFunkParameter(region, p).ok) return null;
  return { region, parameter: p, bestaetigt: bestaetigt as number };
}

/** Eine Wahl zum Merken – nur, was die Prüfung besteht. */
export function funkWahlText(w: FunkWahl): string {
  if (!pruefeFunkParameter(w.region, w.parameter).ok || !Number.isSafeInteger(w.bestaetigt) || w.bestaetigt <= 0) {
    throw new RangeError("Funkparameter"); // kein UI-Text
  }
  const p = w.parameter;
  return JSON.stringify({
    region: w.region, bestaetigt: w.bestaetigt,
    parameter: { frequency: p.frequency, bandwidth: p.bandwidth, spreadingFactor: p.spreadingFactor, codingRate: p.codingRate, txPower: p.txPower },
  });
}

/** Die Optionen für `RNodeWebSerialInterface` – mit der Sendezeit-Sperre der Region in der Firmware. */
export function rnodeOptionen(w: FunkWahl): FunkParameter & { airtimeLimitLong: number } {
  const geprueft = pruefeFunkParameter(w.region, w.parameter);
  if (!geprueft.ok) throw new RangeError("Funkparameter"); // kein UI-Text
  const p = w.parameter;
  return {
    frequency: p.frequency, bandwidth: p.bandwidth, spreadingFactor: p.spreadingFactor, codingRate: p.codingRate, txPower: p.txPower,
    airtimeLimitLong: geprueft.region.maxSendezeitProzent,
  };
}

/** Was `navigator.serial` liefert – nur das, was die RNode-Schnittstelle braucht. */
export interface RNodePort {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

/**
 * Eine RNode über WebSerial verbinden: nur mit bestätigter Wahl innerhalb der Grenzen (sonst `RangeError`). Die
 * Schnittstelle prüft selbst, dass die Firmware die Werte genau so zurückmeldet – sonst bricht sie ab.
 */
export async function verbindeRNode(
  port: RNodePort, wahl: FunkWahl, o: { postOpenDelayMs?: number; detectTimeout?: number } = {},
): Promise<RNodeWebSerialInterface> {
  const optionen = rnodeOptionen(wahl);
  const { RNodeWebSerialInterface } = await import("@reticulum/core/src/interfaces/rnode-webserial.js");
  const rnode = new RNodeWebSerialInterface({
    ...optionen, serialPort: port, name: "freedom-rnode", autoReconnect: false,
    postOpenDelayMs: o.postOpenDelayMs ?? 2000, detectTimeout: o.detectTimeout ?? 15,
  });
  await rnode.connect();
  return rnode;
}
