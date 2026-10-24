/**
 * Bitchat über Bluetooth in der Android-Hülle (B-36b3b, `docs/BITCHAT-ENTWURF.md`): der Weg zu den Kommandos
 * `bitchat_*` der Hülle (`packages/launcher/src/bitchat.rs` → `android/FreedomBitchat.kt`). Nur unter Android – im
 * Browser und auf dem Desktop gibt es kein Bluetooth der Hülle, alles liefert dann `null`, `false` oder nichts.
 * Was die Hülle sagt, liest die App streng; jeder Wert ist ein ganzes Bitchat-Paket (`bitchatFuerVerbindung()`).
 */
import { type HuellenAufruf, huellenArt, huellenAufruf } from "./oberflaeche-huelle.js";

export const BITCHAT_STAENDE = ["an", "bereit", "erlaubnis", "ausgeschaltet", "kein-bluetooth"] as const; // kein UI-Text
export const BITCHAT_WERBUNG = ["an", "aus", "fehler", "nicht-moeglich"] as const; // kein UI-Text
export type BitchatStandArt = (typeof BITCHAT_STAENDE)[number];

/** Eine Verbindung, über die man senden kann: Kennung der Hülle und wie viele Bytes ein Wert höchstens hat. */
export interface BitchatVerbindung {
  id: string;
  grenze: number;
}

export interface BitchatStand {
  stand: BitchatStandArt;
  werbung: (typeof BITCHAT_WERBUNG)[number];
  verbindungen: BitchatVerbindung[];
}

/** Was die Hülle empfing: je Wert die Verbindung und die Bytes (ein ganzes Paket, noch ungeprüft). */
export interface BitchatWert {
  id: string;
  wert: Uint8Array;
}

/** Größter Wert je Schreiben oder Meldung (ATT) – mehr nimmt die Hülle nicht an. */
export const BITCHAT_WERT_MAX = 512;
const KENNUNG = /^[pz][0-9]{1,9}$/;

/** Der Weg zur Hülle – nur unter Android, sonst `null`. */
export function bitchatAufruf(w: unknown = globalThis): HuellenAufruf | null {
  return huellenArt(w) === "android" ? huellenAufruf(w) : null;
}

/** Der Stand aus `bitchat_stand` (JSON aus Kotlin), streng gelesen – sonst `null`. */
export function leseBitchatStand(x: unknown): BitchatStand | null {
  let s: unknown;
  try {
    s = typeof x === "string" ? JSON.parse(x) : null;
  } catch {
    return null;
  }
  if (typeof s !== "object" || s === null) return null;
  const o = s as Record<string, unknown>;
  const stand = BITCHAT_STAENDE.find((a) => a === o.stand);
  const werbung = BITCHAT_WERBUNG.find((a) => a === o.werbung);
  if (!stand || !werbung || !Array.isArray(o.verbindungen) || o.verbindungen.length > 64) return null;
  const verbindungen: BitchatVerbindung[] = [];
  for (const v of o.verbindungen as unknown[]) {
    const { id, grenze } = (v ?? {}) as Record<string, unknown>;
    if (typeof id !== "string" || !KENNUNG.test(id)) return null;
    if (!Number.isSafeInteger(grenze) || (grenze as number) < 20 || (grenze as number) > BITCHAT_WERT_MAX) return null;
    verbindungen.push({ id, grenze: grenze as number });
  }
  return { stand, werbung, verbindungen };
}

/** Die Bytes aus `bitchat_holen`: je Wert Länge der Kennung, Kennung, Länge (2 Byte, groß), Wert – sonst `null`. */
export function leseBitchatWerte(d: Uint8Array): BitchatWert[] | null {
  const aus: BitchatWert[] = [];
  let i = 0;
  while (i < d.length) {
    const n = d[i++];
    if (i + n + 2 > d.length) return null;
    const id = String.fromCharCode(...d.subarray(i, i + n));
    i += n;
    const laenge = (d[i] << 8) | d[i + 1];
    i += 2;
    if (!KENNUNG.test(id) || laenge === 0 || laenge > BITCHAT_WERT_MAX || i + laenge > d.length) return null;
    aus.push({ id, wert: d.slice(i, i + laenge) });
    i += laenge;
  }
  return aus;
}

export async function bitchatStand(aufruf: HuellenAufruf | null = bitchatAufruf()): Promise<BitchatStand | null> {
  if (!aufruf) return null;
  try {
    return leseBitchatStand(await aufruf("bitchat_stand"));
  } catch {
    return null;
  }
}

/** Startet Bluetooth – nur auf Klick: Android fragt dann nach den Rechten (`erlaubnis`). */
export async function bitchatStarten(aufruf: HuellenAufruf | null = bitchatAufruf()): Promise<BitchatStandArt | null> {
  if (!aufruf) return null;
  try {
    const s = await aufruf("bitchat_starten");
    return BITCHAT_STAENDE.find((a) => a === s) ?? null;
  } catch {
    return null;
  }
}

export async function bitchatStoppen(aufruf: HuellenAufruf | null = bitchatAufruf()): Promise<void> {
  try {
    await aufruf?.("bitchat_stoppen");
  } catch {
    // war nicht an
  }
}

/** Ein ganzes Paket an eine Verbindung – `false`, wenn Form oder Hülle es nicht annehmen. */
export async function bitchatSenden(id: string, wert: Uint8Array, aufruf: HuellenAufruf | null = bitchatAufruf()): Promise<boolean> {
  if (!aufruf || !KENNUNG.test(id) || wert.length === 0 || wert.length > BITCHAT_WERT_MAX) return false;
  try {
    return (await aufruf("bitchat_senden", { id, wert: Array.from(wert) })) === true;
  } catch {
    return false;
  }
}

/** Alles Empfangene seit dem letzten Abholen; Unlesbares der Hülle zählt als nichts. */
export async function bitchatHolen(aufruf: HuellenAufruf | null = bitchatAufruf()): Promise<BitchatWert[]> {
  if (!aufruf) return [];
  try {
    const d = await aufruf("bitchat_holen");
    const bytes = d instanceof ArrayBuffer ? new Uint8Array(d) : d instanceof Uint8Array ? d : null;
    return (bytes && leseBitchatWerte(bytes)) ?? [];
  } catch {
    return [];
  }
}
