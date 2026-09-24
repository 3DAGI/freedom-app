/**
 * Mesh-Transport: Nachrichten und Zahlungen ohne Internet.
 *
 * WAS BISHER FEHLTE
 * `mesh.ts` beschreibt, WAS transportiert wird (Paket, Belohnung, Quittung) —
 * aber nicht, WIE. Über eine Funkstrecke passt kein Nostr-Event: LoRa trägt je
 * nach Einstellung 200 bis 250 Byte Nutzlast pro Paket, ein signiertes Event
 * hat 500 bis 2000. Ohne Zerlegung und Wiederzusammenbau ist der ganze
 * Mesh-Zweig eine Absichtserklärung.
 *
 * WAS HIER PASSIERT
 * - **Kompakte Rahmen** statt JSON. JSON über eine 200-Byte-Strecke
 *   verschwendet die Hälfte für Anführungszeichen und Feldnamen.
 * - **Zerlegung und Wiederzusammenbau** mit Fehlerprüfung: Ein Fragment, das
 *   ankommt, gehört nachweisbar zu seiner Nachricht.
 * - **Store-and-Forward** mit Sprungbegrenzung und Dublettenerkennung —
 *   ohne beides fluten sich Funkknoten gegenseitig lahm.
 * - **Vorrang**: Bei 200 Byte pro Sekunde entscheidet die Reihenfolge, ob eine
 *   Nachricht in Minuten oder Stunden ankommt.
 *
 * WAS ÜBER MESH GEHT — UND WAS NICHT
 *   ✓ Nostr-Events: signiertes JSON, beliebig zerlegbar.
 *   ✓ Solana-Transaktionen: maximal 1.232 Byte, brauchen keine Interaktivität.
 *     Mit Durable Nonce läuft auch der Blockhash nicht ab, während das Paket
 *     unterwegs ist.
 *   ✓ Ecash-Token: kurze Zeichenketten, offline übergebbar.
 *   ✗ Lightning-Zahlungen. Sie brauchen mehrere Runden Hin und Her — das
 *     überlebt eine Funkstrecke mit Sekunden Latenz nicht.
 *   ✗ KI-Inferenz. Ein Prompt passt vielleicht noch durch; eine Antwort mit
 *     500 Tokens braucht bei LoRa-Datenraten Stunden. Das gehört nicht
 *     versprochen.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Nutzlast je Funkpaket. Konservativ — gilt auch bei ungünstigen Einstellungen. */
export const LORA_MTU = 200;

/** Größe des Rahmenkopfs in Byte. */
export const FRAME_HEADER_BYTES = 12;

export const MAX_PAYLOAD_PER_FRAME = LORA_MTU - FRAME_HEADER_BYTES;

/** Was transportiert wird — bestimmt Vorrang und Behandlung beim Empfang. */
export enum MeshKind {
  /** Nostr-Event (Nachricht, Quittung, Ankündigung). */
  NostrEvent = 1,
  /** Signierte Solana-Transaktion zum Einreichen. */
  SolanaTx = 2,
  /** Ecash-Token als Zeichenkette. */
  Ecash = 3,
  /** Nur Text — für den Fall, dass kein Client auf der Gegenseite läuft. */
  PlainText = 4,
}

/**
 * Vorrang. Kleiner ist wichtiger.
 *
 * Bei 200 Byte pro Sekunde ist die Reihenfolge keine Feinheit: Eine
 * Notfallnachricht hinter einem Bilddownload bedeutet Stunden.
 */
export enum MeshPriority {
  Notfall = 0,
  Zahlung = 1,
  Nachricht = 2,
  Hintergrund = 3,
}

export interface MeshFrame {
  /** Erste 4 Byte des SHA-256 der Gesamtnachricht — identifiziert sie. */
  msgId: string;
  kind: MeshKind;
  priority: MeshPriority;
  /** Nummer dieses Fragments, 0-basiert. */
  index: number;
  /** Gesamtzahl der Fragments. */
  total: number;
  /** Verbleibende Sprünge. Bei 0 wird nicht weitergereicht. */
  ttl: number;
  data: Uint8Array;
}

const MAX_TTL = 7;

/** Kennung einer Nachricht: kurz genug für den Rahmen, lang genug gegen Kollisionen. */
export function messageId(payload: Uint8Array): string {
  return bytesToHex(sha256(payload)).slice(0, 8);
}

/**
 * Zerlegt eine Nachricht in funkbare Rahmen.
 *
 * Der Kopf ist bewusst binär und knapp: Jedes Byte im Kopf ist ein Byte
 * weniger Nutzlast, und bei 200 Byte gesamt fällt das ins Gewicht.
 */
export function fragment(
  payload: Uint8Array,
  kind: MeshKind,
  priority: MeshPriority = MeshPriority.Nachricht,
  ttl = MAX_TTL,
): Uint8Array[] {
  if (payload.length === 0) throw new Error("Leere Nachricht");
  const id = messageId(payload);
  const total = Math.ceil(payload.length / MAX_PAYLOAD_PER_FRAME);
  if (total > 255) {
    throw new Error(
      `Nachricht zu groß für Funk: ${payload.length} Byte ergäben ${total} Pakete. ` +
      `Über Mesh gehen bis ~${255 * MAX_PAYLOAD_PER_FRAME} Byte.`,
    );
  }

  const frames: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    const teil = payload.subarray(i * MAX_PAYLOAD_PER_FRAME, (i + 1) * MAX_PAYLOAD_PER_FRAME);
    const f = new Uint8Array(FRAME_HEADER_BYTES + teil.length);
    // Kopf: 4 Byte msgId, kind, priority, index, total, ttl, 3 Byte Reserve
    for (let b = 0; b < 4; b++) f[b] = parseInt(id.substr(b * 2, 2), 16);
    f[4] = kind;
    f[5] = priority;
    f[6] = i;
    f[7] = total;
    f[8] = Math.min(ttl, MAX_TTL);
    f.set(teil, FRAME_HEADER_BYTES);
    frames.push(f);
  }
  return frames;
}

export function parseFrame(raw: Uint8Array): MeshFrame {
  if (raw.length < FRAME_HEADER_BYTES) throw new Error("Rahmen zu kurz");
  const msgId = bytesToHex(raw.subarray(0, 4));
  const kind = raw[4] as MeshKind;
  if (!(kind in MeshKind)) throw new Error(`unbekannte Paketart ${raw[4]}`);
  const total = raw[7];
  const index = raw[6];
  if (total === 0 || index >= total) throw new Error("Fragment-Angaben widersprüchlich");
  return {
    msgId,
    kind,
    priority: raw[5] as MeshPriority,
    index,
    total,
    ttl: raw[8],
    data: raw.subarray(FRAME_HEADER_BYTES),
  };
}

/** Verringert die Sprungzahl eines Rahmens. Gibt null zurück, wenn er austrudelt. */
export function decrementTtl(raw: Uint8Array): Uint8Array | null {
  if (raw.length < FRAME_HEADER_BYTES) return null;
  if (raw[8] <= 1) return null;
  const kopie = raw.slice();
  kopie[8] -= 1;
  return kopie;
}

export interface Reassembly {
  msgId: string;
  kind: MeshKind;
  priority: MeshPriority;
  received: number;
  total: number;
  /** Welche Fragments noch fehlen — für gezieltes Nachfordern. */
  missing: number[];
  complete: boolean;
  payload?: Uint8Array;
}

/**
 * Sammelt Fragments und setzt sie zusammen.
 *
 * Prüft am Ende die Kennung gegen den Inhalt: Ein Fragment aus einer anderen
 * Nachricht, das zufällig dieselbe Kennung trägt, würde sonst stillschweigend
 * eine falsche Nachricht ergeben — und die wäre signiert nicht mehr gültig,
 * aber der Nutzer sähe nur „Fehler".
 */
export class Reassembler {
  private teile = new Map<string, { frames: Map<number, Uint8Array>; frame: MeshFrame; seenAt: number }>();

  constructor(private maxAgeSeconds = 3600, private maxMessages = 200) {}

  add(raw: Uint8Array, nowSecs = Math.floor(Date.now() / 1000)): Reassembly | null {
    let f: MeshFrame;
    try {
      f = parseFrame(raw);
    } catch {
      return null;
    }

    let e = this.teile.get(f.msgId);
    if (!e) {
      e = { frames: new Map(), frame: f, seenAt: nowSecs };
      this.teile.set(f.msgId, e);
      // NACH dem Einfuegen aufraeumen: davor koennte die Sammlung um eins
      // ueber die Obergrenze wachsen, und genau darauf zielt ein Angreifer,
      // der Fragments zu nie vervollstaendigten Nachrichten streut.
      this.prune(nowSecs);
    }
    // Widersprüchliche Gesamtzahl: entweder Übertragungsfehler oder zwei
    // Nachrichten mit derselben Kennung. Beides darf nicht zusammenlaufen.
    if (e.frame.total !== f.total) return null;
    e.frames.set(f.index, f.data);

    const missing: number[] = [];
    for (let i = 0; i < f.total; i++) if (!e.frames.has(i)) missing.push(i);

    const status: Reassembly = {
      msgId: f.msgId,
      kind: f.kind,
      priority: f.priority,
      received: e.frames.size,
      total: f.total,
      missing,
      complete: missing.length === 0,
    };
    if (!status.complete) return status;

    const gesamt = [...e.frames.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const laenge = gesamt.reduce((s, x) => s + x.length, 0);
    const payload = new Uint8Array(laenge);
    let off = 0;
    for (const t of gesamt) {
      payload.set(t, off);
      off += t.length;
    }

    // Die Kennung ist der Hash des Inhalts — sie muss zum Zusammengebauten passen.
    if (messageId(payload) !== f.msgId) {
      this.teile.delete(f.msgId);
      return { ...status, complete: false, missing: [-1] };
    }

    this.teile.delete(f.msgId);
    return { ...status, payload };
  }

  /** Unvollständige Nachrichten verwerfen, die zu alt sind. */
  prune(nowSecs = Math.floor(Date.now() / 1000)): number {
    let entfernt = 0;
    for (const [id, e] of this.teile) {
      if (nowSecs - e.seenAt > this.maxAgeSeconds) {
        this.teile.delete(id);
        entfernt++;
      }
    }
    // Harte Obergrenze: Ein Angreifer könnte sonst mit Fragments zu Nachrichten,
    // die er nie vervollständigt, den Speicher füllen.
    while (this.teile.size > this.maxMessages) {
      const aeltester = [...this.teile.entries()].sort((a, b) => a[1].seenAt - b[1].seenAt)[0];
      this.teile.delete(aeltester[0]);
      entfernt++;
    }
    return entfernt;
  }

  get pending(): number {
    return this.teile.size;
  }
}

/**
 * Weiterleitung: was gebe ich weiter, was nicht.
 *
 * Ohne Dublettenerkennung wird aus jeder Nachricht eine Lawine — jeder Knoten
 * sendet an alle, die wieder an alle. Bei Funk mit gemeinsamem Kanal legt das
 * das gesamte Netz still, und zwar innerhalb von Sekunden.
 */
export class ForwardingCache {
  private gesehen = new Map<string, number>();

  constructor(private maxAgeSeconds = 600, private maxEntries = 5000) {}

  /** Soll dieser Rahmen weitergereicht werden? */
  shouldForward(raw: Uint8Array, nowSecs = Math.floor(Date.now() / 1000)): boolean {
    let f: MeshFrame;
    try {
      f = parseFrame(raw);
    } catch {
      return false;
    }
    if (f.ttl <= 1) return false;

    const key = `${f.msgId}:${f.index}`;
    const zuletzt = this.gesehen.get(key);
    if (zuletzt !== undefined && nowSecs - zuletzt < this.maxAgeSeconds) return false;

    this.gesehen.set(key, nowSecs);
    if (this.gesehen.size > this.maxEntries) this.prune(nowSecs);
    return true;
  }

  prune(nowSecs = Math.floor(Date.now() / 1000)): number {
    let entfernt = 0;
    for (const [k, t] of this.gesehen) {
      if (nowSecs - t > this.maxAgeSeconds) {
        this.gesehen.delete(k);
        entfernt++;
      }
    }
    while (this.gesehen.size > this.maxEntries) {
      const aeltester = [...this.gesehen.entries()].sort((a, b) => a[1] - b[1])[0];
      this.gesehen.delete(aeltester[0]);
      entfernt++;
    }
    return entfernt;
  }

  get size(): number {
    return this.gesehen.size;
  }
}

export interface QueuedMessage {
  frames: Uint8Array[];
  priority: MeshPriority;
  queuedAt: number;
  msgId: string;
  label: string;
}

/**
 * Sendewarteschlange mit Vorrang.
 *
 * Sortiert nach Wichtigkeit, dann nach Alter. Ohne die zweite Bedingung würde
 * eine Notfallnachricht eine ältere Nachricht derselben Stufe dauerhaft
 * verdrängen.
 */
export class MeshQueue {
  private q: QueuedMessage[] = [];

  enqueue(
    payload: Uint8Array,
    kind: MeshKind,
    priority: MeshPriority,
    label: string,
    nowSecs = Math.floor(Date.now() / 1000),
  ): QueuedMessage {
    const frames = fragment(payload, kind, priority);
    const eintrag: QueuedMessage = {
      frames,
      priority,
      queuedAt: nowSecs,
      msgId: messageId(payload),
      label,
    };
    this.q.push(eintrag);
    this.q.sort((a, b) => a.priority - b.priority || a.queuedAt - b.queuedAt);
    return eintrag;
  }

  /** Nächster zu sendender Rahmen; entfernt fertige Nachrichten. */
  next(): { frame: Uint8Array; msgId: string; remaining: number } | null {
    while (this.q.length > 0 && this.q[0].frames.length === 0) this.q.shift();
    if (this.q.length === 0) return null;
    const m = this.q[0];
    const frame = m.frames.shift()!;
    return { frame, msgId: m.msgId, remaining: m.frames.length };
  }

  remove(msgId: string): boolean {
    const vorher = this.q.length;
    this.q = this.q.filter((m) => m.msgId !== msgId);
    return this.q.length < vorher;
  }

  get pending(): { msgId: string; label: string; priority: MeshPriority; framesLeft: number }[] {
    return this.q.map((m) => ({
      msgId: m.msgId,
      label: m.label,
      priority: m.priority,
      framesLeft: m.frames.length,
    }));
  }

  /**
   * Wie lange dauert es, bis alles gesendet ist?
   *
   * Ehrliche Schätzung statt eines Fortschrittsbalkens ohne Bezug: Bei Funk
   * geht es um Minuten, und der Nutzer sollte das vorher wissen.
   */
  estimateSeconds(bytesPerSecond = 200): number {
    const bytes = this.q.reduce((s, m) => s + m.frames.reduce((x, f) => x + f.length, 0), 0);
    return Math.ceil(bytes / Math.max(1, bytesPerSecond));
  }
}

/** Was sich sinnvoll über Funk schicken lässt — und was nicht. */
export function meshFeasibility(
  payloadBytes: number,
  bytesPerSecond = 200,
): { feasible: boolean; frames: number; seconds: number; note: string } {
  const frames = Math.ceil(payloadBytes / MAX_PAYLOAD_PER_FRAME);
  const seconds = Math.ceil((frames * LORA_MTU) / Math.max(1, bytesPerSecond));

  if (frames > 255) {
    return {
      feasible: false, frames, seconds,
      note: `${payloadBytes} Byte sind zu viel für Funk. Grenze: ~${255 * MAX_PAYLOAD_PER_FRAME} Byte.`,
    };
  }
  if (seconds > 600) {
    return {
      feasible: true, frames, seconds,
      note: `Möglich, dauert aber ~${Math.round(seconds / 60)} Minuten. Für Text sinnvoll, für Dateien nicht.`,
    };
  }
  return {
    feasible: true, frames, seconds,
    note: `${frames} Pakete, etwa ${seconds} Sekunden.`,
  };
}
