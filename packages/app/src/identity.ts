/**
 * Identität: Erzeugung, Sicherung, Wiederherstellung.
 *
 * DAS PROBLEM, DAS DAS LÖST
 * `loadOrCreateIdentity()` erzeugte beim ersten Start still einen Schlüssel und
 * legte ihn als rohes Hex in `localStorage`. Kein Backup-Zwang, keine
 * Merkphrase, kein bech32. Wer seine Browserdaten löschte — versehentlich, beim
 * Gerätewechsel, durch eine aufräumende Erweiterung — verlor Identität,
 * Reputation, Referral-Beziehungen und den Zugriff auf gesperrte
 * Escrow-Beträge. Ohne jede Vorwarnung.
 *
 * Das ist nicht nur ein Sicherheitsproblem. Es ist der wahrscheinlichste Grund,
 * warum jemand ein solches System nach zwei Wochen nicht mehr benutzt: Er hat
 * nichts falsch gemacht und trotzdem alles verloren.
 *
 * WAS HIER GEBAUT IST
 * - Merkphrase nach BIP-39, Ableitung nach NIP-06 (`m/44'/1237'/0'/0/0`).
 *   Damit lässt sich dieselbe Identität in jedem Nostr-Client wiederherstellen,
 *   der den Standard unterstützt — ihr sperrt niemanden ein.
 * - `nsec`/`npub` nach NIP-19, weil das die Form ist, die Nutzer aus anderen
 *   Clients kennen.
 * - Import akzeptiert Merkphrase, `nsec` und rohes Hex. Wer seinen Schlüssel
 *   irgendwo hat, soll ihn benutzen können, ohne das Format zu kennen.
 */
import { bech32 } from "@scure/base";
import { HDKey } from "@scure/bip32";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/** NIP-06: der Ableitungspfad, auf den sich Nostr-Clients geeinigt haben. */
export const NOSTR_DERIVATION_PATH = "m/44'/1237'/0'/0/0";

export interface Identity {
  sk: Uint8Array;
  pk: string;
  nsec: string;
  npub: string;
  /** Nur bei neu erzeugten oder aus Phrase wiederhergestellten Identitäten. */
  mnemonic?: string;
}

// ------------------------------------------------------------- NIP-19

function toWords(bytes: Uint8Array): number[] {
  return bech32.toWords(bytes);
}

export function encodeNsec(sk: Uint8Array): string {
  return bech32.encode("nsec", toWords(sk), 200);
}

export function encodeNpub(pkHex: string): string {
  return bech32.encode("npub", toWords(hexToBytes(pkHex)), 200);
}

export function decodeNsec(nsec: string): Uint8Array {
  const { prefix, words } = bech32.decode(nsec.trim() as `${string}1${string}`, 200);
  if (prefix !== "nsec") throw new Error(`Erwartet wurde ein nsec, gefunden: ${prefix}`);
  const bytes = bech32.fromWords(words);
  if (bytes.length !== 32) throw new Error("nsec hat nicht 32 Bytes");
  return Uint8Array.from(bytes);
}

export function decodeNpub(npub: string): string {
  const { prefix, words } = bech32.decode(npub.trim() as `${string}1${string}`, 200);
  if (prefix !== "npub") throw new Error(`Erwartet wurde ein npub, gefunden: ${prefix}`);
  return bytesToHex(Uint8Array.from(bech32.fromWords(words)));
}

// ------------------------------------------------------- Erzeugen

function fromSecret(sk: Uint8Array, mnemonic?: string): Identity {
  const pk = bytesToHex(schnorr.getPublicKey(sk));
  return { sk, pk, nsec: encodeNsec(sk), npub: encodeNpub(pk), mnemonic };
}

/**
 * Neue Identität mit Merkphrase.
 *
 * 12 Wörter statt 24: Die zusätzliche Sicherheit von 24 Wörtern ist gegenüber
 * jedem realistischen Angreifer bedeutungslos, die zusätzliche Hürde beim
 * Aufschreiben dagegen sehr real — und eine Phrase, die niemand notiert, ist
 * schlechter als eine kürzere, die notiert wird.
 */
export function createIdentity(): Identity {
  const mnemonic = generateMnemonic(wordlist, 128);
  return identityFromMnemonic(mnemonic);
}

export function identityFromMnemonic(mnemonic: string, passphrase = ""): Identity {
  const normalisiert = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  if (!validateMnemonic(normalisiert, wordlist)) {
    throw new Error(
      "Die Merkphrase ist ungültig. Prüfe Reihenfolge und Schreibweise — " +
      "BIP-39 erkennt einzelne Tippfehler an der Prüfsumme.",
    );
  }
  const seed = mnemonicToSeedSync(normalisiert, passphrase);
  const sk = HDKey.fromMasterSeed(seed).derive(NOSTR_DERIVATION_PATH).privateKey;
  if (!sk) throw new Error("Ableitung fehlgeschlagen");
  return fromSecret(sk, normalisiert);
}

/**
 * Import aus beliebigem Format.
 *
 * Ein Nutzer soll seinen Schlüssel einsetzen können, ohne zu wissen, wie das
 * Format heißt. Die Fehlermeldung nennt deshalb die akzeptierten Formen statt
 * nur „ungültig".
 */
export function importIdentity(input: string, passphrase = ""): Identity {
  const s = input.trim();
  if (!s) throw new Error("Nichts eingegeben.");

  if (s.split(/\s+/).length >= 12) return identityFromMnemonic(s, passphrase);
  if (s.toLowerCase().startsWith("nsec1")) return fromSecret(decodeNsec(s));
  if (/^[0-9a-fA-F]{64}$/.test(s)) return fromSecret(hexToBytes(s.toLowerCase()));

  if (s.toLowerCase().startsWith("npub1")) {
    throw new Error(
      "Das ist ein öffentlicher Schlüssel (npub) — damit lässt sich nicht signieren. " +
      "Nötig ist die Merkphrase oder der nsec.",
    );
  }
  throw new Error(
    "Unbekanntes Format. Akzeptiert werden: 12-Wort-Merkphrase, nsec1… oder " +
    "64 Zeichen Hex.",
  );
}

/** Rekonstruiert eine Identität aus dem gespeicherten Hex (Altbestand). */
export function identityFromHex(hex: string): Identity {
  return fromSecret(hexToBytes(hex));
}

// ------------------------------------------------------- Sicherung

export interface BackupCheck {
  hasKey: boolean;
  /** Hat der Nutzer die Sicherung bestätigt? */
  confirmed: boolean;
  /** Kann diese Identität überhaupt per Phrase wiederhergestellt werden? */
  recoverable: boolean;
  /** Was der Nutzer wissen muss. */
  warning?: string;
}

const LS_KEY = "freedom.nsec";
const LS_CONFIRMED = "freedom.backup.confirmed";
const LS_HAS_MNEMONIC = "freedom.backup.mnemonic";

export function backupStatus(): BackupCheck {
  const hasKey = !!localStorage.getItem(LS_KEY);
  const confirmed = localStorage.getItem(LS_CONFIRMED) === "1";
  const recoverable = localStorage.getItem(LS_HAS_MNEMONIC) === "1";

  if (!hasKey) return { hasKey, confirmed, recoverable };
  if (!recoverable) {
    return {
      hasKey, confirmed, recoverable,
      warning:
        "Diese Identität stammt aus einer älteren Version und hat keine " +
        "Merkphrase. Sichere den nsec — er ist der einzige Weg zurück.",
    };
  }
  if (!confirmed) {
    return {
      hasKey, confirmed, recoverable,
      warning:
        "Die Merkphrase ist noch nicht bestätigt. Ohne Sicherung sind bei " +
        "Verlust der Browserdaten Reputation und gesperrte Beträge weg.",
    };
  }
  return { hasKey, confirmed, recoverable };
}

export function markBackupConfirmed(): void {
  localStorage.setItem(LS_CONFIRMED, "1");
}

export function markHasMnemonic(): void {
  localStorage.setItem(LS_HAS_MNEMONIC, "1");
}

/**
 * Prüft eine Bestätigungsabfrage.
 *
 * Der Nutzer tippt einzelne Wörter der Phrase nach — das ist die einzige
 * Methode, die belegt, dass er sie tatsächlich notiert hat. Ein Häkchen
 * „ich habe gesichert" belegt nur, dass er das Häkchen gefunden hat.
 */
export function verifyMnemonicChallenge(
  mnemonic: string,
  positions: number[],
  answers: string[],
): { ok: boolean; wrong: number[] } {
  const words = mnemonic.trim().toLowerCase().split(/\s+/);
  const wrong: number[] = [];
  positions.forEach((pos, i) => {
    if (words[pos] !== (answers[i] ?? "").trim().toLowerCase()) wrong.push(pos);
  });
  return { ok: wrong.length === 0, wrong };
}

/** Wählt Positionen für die Abfrage — verteilt, nicht nur am Anfang. */
export function pickChallengePositions(wordCount: number, count = 3): number[] {
  const alle = Array.from({ length: wordCount }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < count && alle.length > 0; i++) {
    const idx = Math.floor(Math.random() * alle.length);
    out.push(alle.splice(idx, 1)[0]);
  }
  return out.sort((a, b) => a - b);
}

export interface BackupFile {
  format: "freedomstack-identity";
  version: 1;
  npub: string;
  nsec: string;
  mnemonic?: string;
  createdAt: string;
  warning: string;
}

/**
 * Sicherungsdatei.
 *
 * Enthält den Schlüssel im Klartext — deshalb steht die Warnung IM Dokument,
 * nicht nur im Dialog davor. Wer die Datei in einem Jahr wiederfindet, hat den
 * Dialog längst vergessen.
 */
export function buildBackupFile(id: Identity): string {
  const f: BackupFile = {
    format: "freedomstack-identity",
    version: 1,
    npub: id.npub,
    nsec: id.nsec,
    mnemonic: id.mnemonic,
    createdAt: new Date().toISOString(),
    warning:
      "Wer diese Datei hat, ist du: Nachrichten, Reputation, Guthaben. Nicht " +
      "in eine Cloud legen, nicht per Messenger senden, nicht ausdrucken lassen.",
  };
  return JSON.stringify(f, null, 2);
}

export function parseBackupFile(json: string): Identity {
  const f = JSON.parse(json) as Partial<BackupFile>;
  if (f.format !== "freedomstack-identity") {
    throw new Error("Das ist keine FreedomStack-Sicherungsdatei.");
  }
  if (f.mnemonic) return identityFromMnemonic(f.mnemonic);
  if (f.nsec) return fromSecret(decodeNsec(f.nsec));
  throw new Error("Die Sicherungsdatei enthält weder Merkphrase noch nsec.");
}
