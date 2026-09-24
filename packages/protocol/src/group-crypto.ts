/**
 * Verschlüsselte Kanäle mit Schlüsselwechsel.
 *
 * WARUM DAS AUFGESCHOBEN WAR
 * Die Verschlüsselung selbst ist der einfache Teil. Der Aufwand ist der
 * Wechsel, wenn jemand den Raum verlässt: Ohne neuen Schlüssel liest er
 * weiter mit, und der neue Schlüssel erreicht nur, wer danach online kommt.
 *
 * DER AUFBAU: EPOCHEN
 * Ein Kanal durchläuft Epochen. Jede hat einen eigenen Schlüssel, der für
 * jedes Mitglied einzeln verschlüsselt veröffentlicht wird. Tritt jemand aus
 * oder wird entfernt, beginnt eine neue Epoche — der neue Schlüssel wird nur
 * an die Verbliebenen verteilt.
 *
 * Das ist der Kern von MLS, ohne dessen Baumstruktur. Die kostet bei großen
 * Gruppen deutlich weniger Bandbreite, ist aber ein Projekt für mehrere
 * Wochen. Bei Gruppen bis etwa hundert Mitgliedern ist der einfache Weg
 * praktisch gleichwertig: hundert kleine verschlüsselte Ereignisse je Wechsel.
 *
 * DREI GRENZEN, DIE AUSGESPROCHEN GEHÖREN
 *
 * 1. **Wer austritt, behält die Vergangenheit.** Er hat die alten Schlüssel
 *    gesehen und kann alles lesen, was er damals lesen durfte. Rückwirkende
 *    Vertraulichkeit gibt es nicht — auch MLS bietet sie nicht.
 * 2. **Der Wechsel erreicht nur Anwesende.** Wer offline ist, bekommt den
 *    neuen Schlüssel erst beim nächsten Verbinden. Bis dahin sieht er die
 *    neuen Nachrichten nicht.
 * 3. **Die Mitgliederliste ist öffentlich.** Sie muss es sein, damit jeder
 *    weiß, für wen zu verschlüsseln ist. Wer in einem Raum ist, lässt sich
 *    also feststellen — nur nicht, was dort gesagt wird.
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag } from "./event.js";
import { encryptDM, decryptDM } from "./dm.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Schlüssel einer Epoche, für ein Mitglied verschlüsselt. */
export const KIND_EPOCH_KEY = 38075;
/** Nachricht in einem verschlüsselten Kanal. */
export const KIND_ENCRYPTED_CHANNEL_MSG = 38076;

export interface EpochKeyGrant {
  channelId: string;
  epoch: number;
  /** Wer verteilt hat. */
  issuerPubkey: string;
  /** Für wen. */
  memberPubkey: string;
  /** Der Epochenschlüssel, mit NIP-44 an das Mitglied verschlüsselt. */
  encryptedKey: string;
  createdAt: number;
}

/** Neuen Epochenschlüssel erzeugen. */
export function generateEpochKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Kennung eines Schlüssels — für die Zuordnung, ohne ihn preiszugeben. */
export function epochKeyId(key: Uint8Array): string {
  return bytesToHex(sha256(key)).slice(0, 16);
}

/**
 * Epochenschlüssel an ein Mitglied verteilen.
 *
 * Ein Ereignis je Mitglied. Bei hundert Mitgliedern hundert Ereignisse — das
 * klingt viel und ist es nicht: Sie sind winzig und fallen nur beim Wechsel
 * an, nicht bei jeder Nachricht.
 */
export async function buildEpochKeyGrant(
  channelId: string,
  epoch: number,
  epochKey: Uint8Array,
  issuerSk: Uint8Array,
  issuerPk: string,
  memberPk: string,
  createdAt?: number,
): Promise<UnsignedEvent> {
  const chiffre = await encryptDM(bytesToHex(epochKey), issuerSk, memberPk);
  return buildEvent(
    issuerPk,
    KIND_EPOCH_KEY,
    [
      ["d", `epoch:${channelId}:${epoch}:${memberPk}`],
      ["h", channelId],
      ["epoch", String(epoch)],
      ["p", memberPk],
      ["key_id", epochKeyId(epochKey)],
    ],
    chiffre,
    createdAt,
  );
}

export function parseEpochKeyGrant(ev: NostrEvent): EpochKeyGrant {
  if (ev.kind !== KIND_EPOCH_KEY) throw new Error(`kein Epochenschlüssel: kind ${ev.kind}`);
  const channelId = getTag(ev, "h");
  const epoch = Number(getTag(ev, "epoch") ?? "NaN");
  const member = getTag(ev, "p");
  if (!channelId || !member || !Number.isFinite(epoch)) {
    throw new Error("Epochenschlüssel unvollständig");
  }
  return {
    channelId, epoch, issuerPubkey: ev.pubkey, memberPubkey: member,
    encryptedKey: ev.content, createdAt: ev.created_at,
  };
}

export interface EpochKeyResult {
  ok: boolean;
  key?: Uint8Array;
  epoch?: number;
  message: string;
}

/** Eigenen Epochenschlüssel auspacken. */
export async function openEpochKey(
  ev: NostrEvent,
  memberSk: Uint8Array,
): Promise<EpochKeyResult> {
  let g: EpochKeyGrant;
  try {
    g = parseEpochKeyGrant(ev);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  try {
    const hex = await decryptDM(g.encryptedKey, memberSk, g.issuerPubkey);
    const key = Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    if (key.length !== 32) return { ok: false, message: "Schlüssel hat falsche Länge." };

    const erwartet = getTag(ev, "key_id");
    if (erwartet && epochKeyId(key) !== erwartet) {
      // Der Verteiler hat etwas anderes geschickt, als er angekündigt hat.
      return { ok: false, message: "Schlüssel passt nicht zur angekündigten Kennung." };
    }
    return { ok: true, key, epoch: g.epoch, message: `Epoche ${g.epoch} entschlüsselt.` };
  } catch {
    return { ok: false, message: "Nicht für dich verschlüsselt." };
  }
}

export interface Keyring {
  channelId: string;
  /** Epoche → Schlüssel. Alte bleiben, damit die Vergangenheit lesbar ist. */
  keys: Map<number, Uint8Array>;
  currentEpoch: number;
}

/**
 * Schlüsselbund aus allen eigenen Zuteilungen aufbauen.
 *
 * Alte Schlüssel werden behalten. Sie wegzuwerfen würde die eigene
 * Vergangenheit unlesbar machen — und gegen einen Angreifer, der das Gerät
 * hat, nichts helfen, denn er hätte die Nachrichten dann auch im Klartext
 * nicht mehr, aber der Nutzer eben auch nicht.
 */
export async function buildKeyring(
  channelId: string,
  events: NostrEvent[],
  memberSk: Uint8Array,
): Promise<Keyring> {
  const keys = new Map<number, Uint8Array>();
  let hoechste = -1;

  for (const ev of events) {
    if (ev.kind !== KIND_EPOCH_KEY) continue;
    if (getTag(ev, "h") !== channelId) continue;
    const r = await openEpochKey(ev, memberSk);
    if (!r.ok || r.epoch === undefined || !r.key) continue;
    // Bei mehreren Zuteilungen für dieselbe Epoche gewinnt die erste —
    // eine spätere könnte von jemandem stammen, der die Gruppe übernehmen will.
    if (!keys.has(r.epoch)) keys.set(r.epoch, r.key);
    if (r.epoch > hoechste) hoechste = r.epoch;
  }

  return { channelId, keys, currentEpoch: hoechste };
}

export interface EncryptedMessage {
  channelId: string;
  epoch: number;
  authorPubkey: string;
  ciphertext: string;
  createdAt: number;
}

/**
 * Nachricht in einem verschlüsselten Kanal.
 *
 * Verschlüsselt wird mit dem Epochenschlüssel als beidseitigem Schlüssel —
 * alle Mitglieder haben denselben, also brauchen sie keinen Schlüsselaustausch
 * je Paar.
 */
export async function buildEncryptedMessage(
  channelId: string,
  epoch: number,
  epochKey: Uint8Array,
  authorSk: Uint8Array,
  authorPk: string,
  plaintext: string,
  createdAt?: number,
): Promise<UnsignedEvent> {
  const { schnorr } = await import("@noble/curves/secp256k1.js");
  const gruppenPk = bytesToHex(schnorr.getPublicKey(epochKey));
  const chiffre = await encryptDM(plaintext, epochKey, gruppenPk);
  void authorSk;

  return buildEvent(
    authorPk,
    KIND_ENCRYPTED_CHANNEL_MSG,
    [["h", channelId], ["epoch", String(epoch)], ["key_id", epochKeyId(epochKey)]],
    chiffre,
    createdAt,
  );
}

export interface DecryptResult {
  ok: boolean;
  plaintext?: string;
  epoch?: number;
  message: string;
}

export async function decryptChannelMessage(
  ev: NostrEvent,
  ring: Keyring,
): Promise<DecryptResult> {
  if (ev.kind !== KIND_ENCRYPTED_CHANNEL_MSG) {
    return { ok: false, message: "Keine verschlüsselte Kanalnachricht." };
  }
  const epoch = Number(getTag(ev, "epoch") ?? "NaN");
  if (!Number.isFinite(epoch)) return { ok: false, message: "Nachricht ohne Epoche." };

  const key = ring.keys.get(epoch);
  if (!key) {
    // Der wichtigste Fall für die Anzeige: Der Nutzer war damals nicht dabei.
    return {
      ok: false, epoch,
      message: epoch < ring.currentEpoch
        ? "Aus einer Zeit vor deinem Beitritt — nicht lesbar."
        : "Schlüssel für diese Epoche fehlt. Verbinde dich, um ihn zu erhalten.",
    };
  }

  try {
    const { schnorr } = await import("@noble/curves/secp256k1.js");
    const gruppenPk = bytesToHex(schnorr.getPublicKey(key));
    return {
      ok: true, epoch,
      plaintext: await decryptDM(ev.content, key, gruppenPk),
      message: "Entschlüsselt.",
    };
  } catch {
    return { ok: false, epoch, message: "Nachricht beschädigt oder mit fremdem Schlüssel." };
  }
}

export interface RotationPlan {
  newEpoch: number;
  /** An wen der neue Schlüssel geht. */
  recipients: string[];
  /** Wer ausgeschlossen wird. */
  excluded: string[];
  eventCount: number;
  message: string;
}

/**
 * Schlüsselwechsel planen.
 *
 * Gibt ausdrücklich mit aus, wie viele Ereignisse das kostet — bei großen
 * Gruppen ist das die Zahl, die entscheidet, ob ein Wechsel praktikabel ist.
 */
export function planRotation(
  currentEpoch: number,
  currentMembers: string[],
  removed: string[],
): RotationPlan {
  const raus = new Set(removed);
  const bleiben = currentMembers.filter((m) => !raus.has(m));

  return {
    newEpoch: currentEpoch + 1,
    recipients: bleiben,
    excluded: [...raus],
    eventCount: bleiben.length,
    message:
      removed.length === 0
        ? `Epoche ${currentEpoch + 1}: planmäßiger Wechsel, ${bleiben.length} Zuteilungen.`
        : `Epoche ${currentEpoch + 1}: ${removed.length} ausgeschlossen, ` +
          `${bleiben.length} Zuteilungen. Die Ausgeschlossenen lesen ab jetzt nicht mehr mit — ` +
          `was sie vorher gesehen haben, behalten sie.`,
  };
}

/**
 * Was Verschlüsselung in diesem Kanal leistet.
 *
 * Alle drei Grenzen stehen drin. Ein Nutzer, der glaubt, ein Austritt lösche
 * die Vergangenheit, schreibt anders, als er sollte.
 */
export function encryptionInfo(memberCount: number, epoch: number): string {
  return [
    `Verschlüsselt, Epoche ${epoch}, ${memberCount} Mitglieder.`,
    "Relays sehen nur, dass etwas geschrieben wurde — nicht was.",
    "",
    "Drei Grenzen:",
    "  · Wer austritt, behält alles, was er vorher gelesen hat.",
    "    Rückwirkende Vertraulichkeit gibt es nicht.",
    "  · Nach einem Wechsel bekommt den neuen Schlüssel nur, wer sich",
    "    verbindet. Wer offline bleibt, sieht neue Nachrichten nicht.",
    "  · Die Mitgliederliste ist öffentlich — sie muss es sein, damit",
    "    jeder weiß, für wen zu verschlüsseln ist. Wer hier ist, lässt",
    "    sich feststellen; was gesagt wird, nicht.",
  ].join("\n");
}
