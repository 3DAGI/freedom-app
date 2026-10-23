/**
 * Funkparameter einer RNode in der App (Sammlung B-32b, Entscheidung RN-W6 A, `docs/RETICULUM-ENTWURF.md`): die gemerkte,
 * bestätigte Wahl und das Verbinden über WebSerial. Regionen, Grenzen und Prüfung stehen seit B-32d1 im Protokoll
 * (`funk-region.ts`) – der Knoten (B-32d2) prüft mit denselben.
 */
import { pruefeFunkParameter, rnodeOptionen, type FunkParameter } from "@freedomstack/protocol";
import type { RNodeWebSerialInterface } from "@reticulum/core/src/interfaces/rnode-webserial.js";

/** Woher die Grenzen je Region stammen – Schlüssel des Textes (beide Sprachen); jede Region aus `FUNK_REGIONEN` hat einen. */
export const FUNK_QUELLE: Readonly<Record<string, string>> = Object.freeze({ "eu-869": "set.rnodeQuelleEu869", "eu-433": "set.rnodeQuelleEu433" });

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
