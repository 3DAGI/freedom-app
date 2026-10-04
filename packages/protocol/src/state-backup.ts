/**
 * Zustandssicherung.
 *
 * Die Merkphrase sichert die *Identität*. Unterhaltungen,
 * Raum-Mitgliedschaften, eigene Namen und Lesestände liegen im Browser. Wer
 * seine Daten löscht, behält den Schlüssel und verliert alles andere — und
 * weiß dann nicht einmal mehr, in welchen Räumen er war. Das ist der erste
 * Datenverlust, den ein echter Nutzer erleben wird, und er ist vermeidbar.
 *
 * Die Sicherung ist eine **Garantie** — verschlüsselt, vom eigenen Schlüssel
 * abgeleitet, wiederherstellbar. Ablaufende Nachrichten (NIP-40, eine **Bitte**
 * an die Relays) stehen seit 2.5 in `private-dm.ts` (`dmAbgelaufen`); der
 * allgemeine Ablauf, der hier stand, fiel mit B-21.
 */
import { NostrEvent, UnsignedEvent, buildEvent } from "./event.js";
import { encryptDM, decryptDM } from "./dm.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { schnorr } from "@noble/curves/secp256k1.js";
import { ProtokollFehler } from "./fehler.js";

/** Verschlüsselte Zustandssicherung. */
export const KIND_STATE_BACKUP = 30078;

// --------------------------------------------------------- Sicherung

export interface BackupPayload {
  version: 1;
  createdAt: number;
  /** Unterhaltungen, Räume, eigene Namen, Lesestände. */
  data: Record<string, unknown>;
}

export interface BackupKeypair {
  sk: Uint8Array;
  pk: string;
}

/**
 * Schlüsselpaar für die Sicherung — ABGELEITET, nicht das Identitätspaar.
 *
 * Denselben Schlüssel zum Signieren und Verschlüsseln zu verwenden ist ein
 * Fehler, den man nicht rückgängig machen kann: Wer die Sicherung entschlüsseln
 * kann, könnte sonst auch in fremdem Namen unterschreiben. Die Ableitung
 * kostet nichts und trennt beides sauber — dieselbe Merkphrase, anderer Zweck.
 */
export function deriveBackupKey(identitySecret: Uint8Array): BackupKeypair {
  const sk = hkdf(sha256, identitySecret, new TextEncoder().encode("freedom-backup-v1"),
    new TextEncoder().encode("state-encryption"), 32);
  return { sk, pk: bytesToHex(schnorr.getPublicKey(sk)) };
}

export interface BackupResult {
  event: UnsignedEvent;
  /** Größe der verschlüsselten Nutzlast. */
  sizeBytes: number;
  message: string;
}

/**
 * Zustand verschlüsseln und als Ereignis verpacken.
 *
 * Adressierbar (kind 30078 mit festem `d`), damit eine neue Sicherung die
 * alte ersetzt statt sich anzuhäufen. Sonst läge nach einem Jahr täglicher
 * Sicherungen ein Berg auf den Relays, aus dem niemand die richtige findet.
 */
export async function buildStateBackup(
  pubkey: string,
  backupKey: BackupKeypair,
  data: Record<string, unknown>,
  createdAt?: number,
): Promise<BackupResult> {
  const at = createdAt ?? Math.floor(Date.now() / 1000);
  const payload: BackupPayload = { version: 1, createdAt: at, data };
  const klartext = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(klartext).length;
  if (bytes > SICHERUNG_MAX_BYTES) {
    throw new ProtokollFehler(
      "sicherung-gross",
      `Sicherung zu groß (${Math.round(bytes / 1024)} KB, höchstens ${SICHERUNG_MAX_BYTES / 1000} KB) – nichts gesendet.`,
      { kb: Math.round(bytes / 1024), max: SICHERUNG_MAX_BYTES / 1000 },
    );
  }

  // An sich selbst verschlüsseln: Absender und Empfänger sind dasselbe
  // abgeleitete Paar.
  const chiffre = await encryptDM(klartext, backupKey.sk, backupKey.pk);

  return {
    event: buildEvent(pubkey, KIND_STATE_BACKUP,
      [["d", "freedom-state"], ["v", "1"]], chiffre, at),
    sizeBytes: chiffre.length,
    message:
      `${Math.round(chiffre.length / 1024)} KB verschlüsselt. ` +
      `Wiederherstellbar allein mit deiner Merkphrase.`,
  };
}

export interface RestoreResult {
  ok: boolean;
  data?: Record<string, unknown>;
  backedUpAt?: number;
  /** Warum nicht (seit 8.16g2b2, damit die App den Satz in ihrer Sprache bildet). */
  fehler?: "kein-ereignis" | "version" | "unlesbar";
  /** Bei „version“: die unbekannte Version. */
  version?: unknown;
  message: string;
}

/**
 * Sicherung wiederherstellen.
 *
 * Wirft nicht: Eine kaputte oder fremde Sicherung ist kein Grund, den
 * Anmeldevorgang abzubrechen. Der Nutzer soll hineinkommen, auch wenn die
 * Sicherung unbrauchbar ist.
 */
export async function restoreStateBackup(
  ev: NostrEvent,
  backupKey: BackupKeypair,
): Promise<RestoreResult> {
  if (ev.kind !== KIND_STATE_BACKUP) {
    return { ok: false, fehler: "kein-ereignis", message: "Kein Sicherungs-Ereignis." };
  }
  try {
    const klartext = await decryptDM(ev.content, backupKey.sk, backupKey.pk);
    const p = JSON.parse(klartext) as BackupPayload;
    if (p.version !== 1) {
      return { ok: false, fehler: "version", version: p.version, message: `Unbekannte Sicherungsversion ${p.version}.` };
    }
    return {
      ok: true,
      data: p.data,
      backedUpAt: p.createdAt,
      message: `Wiederhergestellt, Stand ${new Date(p.createdAt * 1000).toISOString().slice(0, 16).replace("T", " ")}.`,
    };
  } catch {
    return {
      ok: false,
      fehler: "unlesbar",
      message:
        "Sicherung nicht lesbar. Entweder gehört sie zu einer anderen " +
        "Merkphrase, oder sie ist beschädigt. Du kommst trotzdem hinein — " +
        "nur ohne deine alten Unterhaltungen.",
    };
  }
}

// ------------------------------------------- Was gesichert wird (8.12)

/**
 * Nur diese Eintraege kommen in die Sicherung – eine feste Liste, kein
 * Praefix: Bis 8.12 nahm die App jeden `freedom.*`-Eintrag mit und filterte nur
 * Namen auf `.sk`/`.identity`/`.secret` – der Schluessel heisst aber
 * `freedom.nsec` und ging mit. Ein neuer Eintrag ist erst gesichert, wenn er
 * hier steht; vergessen heisst „nicht gesichert“, nicht „Geheimnis auf Relays“.
 */
export const SICHERUNG_EINTRAEGE: readonly string[] = [
  "freedom.chats",              // Unterhaltungen (Liste, Namen, Ablauf je Unterhaltung)
  "freedom.spaces",             // Raeume
  "freedom.lastRead",           // Lesestaende
  "freedom.petnames",           // eigene Namen
  "freedom.profile",            // Profil-Entwurf
  "freedom.profil.lnOeffentlich", // Lightning-Adresse im Profil öffentlich? (6.3)
  "freedom.lang",
  "freedom.relays",
  "freedom.relays.eigene",
  "freedom.kontakteSichern",
  "freedom.standardSchiene",
  "freedom.mandate",            // zuerst gesehene Mandate der Kontakte (8.6a)
  "freedom.kataloge",           // abonnierte Modellkataloge (5.7)
  "freedom.referrer",           // eigener Werber – ihm gehen 0,5 % jeder KI-Zahlung (5.1.3b)
  "freedom.referrer.ln",        // seine Lightning-Adresse aus dem Werbelink
  "freedom.referrer.sol",       // seine SOL-Adresse aus dem Werbelink (12.2)
  "freedom.werben.adresse",     // eigene Adresse der App für den Werbelink (11.2a)
  "freedom.werben.name",        // eigener kurzer Name (NIP-05) für den Werbelink, samt Schlüssel (11.2b)
  "freedom.ruf.teilen",         // Zustimmung: Ruf mit Kontakten teilen (5.5c)
  "freedom.kontakte.geprueft",  // geprüfte Kontakte (Sicherheitscode, B-4) – im Tresor
];
/** Moderation je Community (`freedom.mod.<id>`): nur „an“/„aus“. */
const SICHERUNG_PRAEFIXE = ["freedom.mod."];

/**
 * Was NIE in die Sicherung darf – auch nicht aus einer alten Sicherung
 * zurueck: Schluessel und Zugaenge, Geld-Geheimnisse, fremde Anteile, und
 * Schluessel von Gruppen (MLS, Epochen). Gruppenschluessel bewusst nicht:
 * Forward Secrecy hiesse sonst nur „bis zur naechsten Sicherung“ – ein neues
 * Geraet tritt Raeumen neu bei. Repos nur auf diesem Geraet (B-2) ebenso nie:
 * Die Sicherung geht auf Relays.
 */
export const SICHERUNG_NIE = [
  /^freedom\.nsec$/, /^freedom\.bunker$/, /^freedom\.nwc\./, /^freedom\.swap\./, /^freedom\.htlc\./,
  /^freedom\.solWallet/, /^freedom\.pending\./, /^freedom\.vault/, /^freedom\.suche\./, /^freedom\.nachfolge/,
  /^freedom\.notfall\./, /^freedom\.(mls|gruppe|epoch)/, /^freedom\.merkphrase$/, /^freedom\.reklamationen$/, /^freedom\.coverage\.eintrag$/,
  /^freedom\.kanaele$/, /^freedom\.quittungen$/, /^freedom\.messungen$/, /^freedom\.ruf\.(kontakte|gesendet)$/, /^freedom\.repos\.lokal$/, /^freedom\.knoten\.kopplung$/,
];

/** Hoechstens so gross (NIP-44 fasst 65.535 Byte Klartext). */
export const SICHERUNG_MAX_BYTES = 60_000;

function gehoertDazu(k: string): boolean {
  if (SICHERUNG_NIE.some((r) => r.test(k))) return false;
  return SICHERUNG_EINTRAEGE.includes(k) || SICHERUNG_PRAEFIXE.some((p) => k.startsWith(p));
}

/** Die zu sichernden Eintraege; `lese` holt einen Wert (localStorage oder Tresor). */
export function waehleSicherung(schluessel: readonly string[], lese: (k: string) => string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of new Set([...SICHERUNG_EINTRAEGE, ...schluessel])) {
    if (!gehoertDazu(k)) continue;
    const v = lese(k);
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** Aus einer (auch alten oder fremden) Sicherung nur zurueckholen, was dazugehoert. */
export function filtereWiederherstellung(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) if (typeof v === "string" && gehoertDazu(k)) out[k] = v;
  return out;
}

/** Die neueste Sicherung aus mehreren Ereignissen. */
export function latestBackup(events: NostrEvent[]): NostrEvent | null {
  let neueste: NostrEvent | null = null;
  for (const ev of events) {
    if (ev.kind !== KIND_STATE_BACKUP) continue;
    if (!neueste || ev.created_at > neueste.created_at) neueste = ev;
  }
  return neueste;
}

/** Prüfsumme, um festzustellen, ob sich seit der letzten Sicherung etwas geändert hat. */
export function stateFingerprint(data: Record<string, unknown>): string {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(data)))).slice(0, 16);
}

export function backupInfo(sizeBytes: number, lastAt?: number): string {
  const alter = lastAt ? Math.floor((Date.now() / 1000 - lastAt) / 86400) : null;
  const stand = lastAt
    ? `Letzte Sicherung vor ${alter} Tag(en), ${Math.round(sizeBytes / 1024)} KB.`
    : "Noch keine Sicherung.";
  // Kurz halten: Was gesichert wird, wer es lesen kann, was man zum Zurueckholen braucht.
  return `${stand} Unterhaltungen, Räume und Namen, verschlüsselt — auch kein Relay kann sie lesen. ` +
    "Deine Merkphrase allein genügt zur Wiederherstellung. Nie darin: dein Schlüssel, Wallet-Zugänge, " +
    "laufende Tauschvorgänge und Gruppenschlüssel – ein neues Gerät tritt Räumen neu bei.";
}
