/**
 * Netz-Kapazitaet: dezentrale Gratis-Schwelle (wie Bitcoin-Blockgroesse —
 * ein Protokoll-Parameter, den jeder Client selbst aus Netz-Events berechnet).
 *
 * Formel:
 *   netzKapazitaet = SUMME(storage.capacityBytes aller aktiven Seeder-Caps)
 *   gratisLimit    = min(GRATIS_HARTES_MAX, netzKapazitaet * GRATIS_FAKTOR)
 *
 * Fruh (nur 1 bootstrap-seeder): kleines limit. Waechst automatisch mit dem
 * netz — ohne dass jemand eine zentraleinstellung aendert.
 */
import { NostrEvent } from "./event.js";

/** Harte obergrenze (auch bei riesigem netz): 1GB pro upload. */
export const FREE_HARD_MAX_BYTES = 1024 * 1024 * 1024;
/** Anteil der netz-kapazitaet, der als gratis-limit dient: 0.5%. */
export const FREE_CAPACITY_FACTOR = 0.005;
/** Minimum wenn nur 1 seeder aktiv ist: 50MB. */
export const FREE_MIN_BYTES = 50 * 1024 * 1024;
/** Caps juenger als 7 tage gelten als aktiv. */
const CAP_ACTIVE_SECS = 7 * 24 * 3600;

export interface StorageCap {
  pubkey: string;
  capacityBytes: number;
  priceMsatPerMB: number;
  bootstrap: boolean;
  createdAt: number;
}

/** Extrahiert storage-caps aus provider-capabilities-events. */
export function extractStorageCaps(events: NostrEvent[]): StorageCap[] {
  const caps: StorageCap[] = [];
  for (const ev of events) {
    const tag = ev.tags.find((t) => t[0] === "storage");
    if (!tag) continue;
    caps.push({
      pubkey: ev.pubkey,
      capacityBytes: Number(tag[1] ?? "0"),
      priceMsatPerMB: Number(tag[2] ?? "1"),
      bootstrap: tag[3] === "1",
      createdAt: ev.created_at,
    });
  }
  return caps;
}

export interface NetworkCapacity {
  totalBytes: number;
  activeSeeders: number;
  freeUploadLimitBytes: number;
}

/** Berechnet netz-kapazitaet + aktuelle gratis-schwelle. */
export function computeNetworkCapacity(events: NostrEvent[], nowSecs = Math.floor(Date.now() / 1000)): NetworkCapacity {
  const caps = extractStorageCaps(events).filter((c) => nowSecs - c.createdAt < CAP_ACTIVE_SECS && c.capacityBytes > 0);
  const totalBytes = caps.reduce((sum, c) => sum + c.capacityBytes, 0);
  let freeUploadLimitBytes = Math.floor(totalBytes * FREE_CAPACITY_FACTOR);
  if (caps.length > 0) freeUploadLimitBytes = Math.max(freeUploadLimitBytes, FREE_MIN_BYTES);
  freeUploadLimitBytes = Math.min(freeUploadLimitBytes, FREE_HARD_MAX_BYTES);
  return { totalBytes, activeSeeders: caps.length, freeUploadLimitBytes };
}
