/**
 * Mesh-Transport: Nachrichten und Zahlungen ohne Internet.
 *
 * WAS BISHER FEHLTE
 * Wie über eine Funkstrecke transportiert wird. Dort passt kein Nostr-Event: LoRa trägt je
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
 *   ✓ Umschläge (Nostr, NIP-59): signiertes JSON, beliebig zerlegbar.
 *   ✓ Solana-Transaktionen: maximal 1.232 Byte, brauchen keine Interaktivität.
 *     Mit Durable Nonce läuft auch der Blockhash nicht ab, während das Paket
 *     unterwegs ist.
 *   ✗ Offene Nostr-Events und Ecash-Token (seit 7.1): tragen den Absender
 *     bzw. sind im Klartext Bargeld für jeden, der mithört.
 *   ✗ Lightning-Zahlungen. Sie brauchen mehrere Runden Hin und Her — das
 *     überlebt eine Funkstrecke mit Sekunden Latenz nicht.
 *   ✗ Lange KI-Antworten. Eine Antwort mit 500 Tokens braucht als Umschlag
 *     fast die ganze Sendezeit einer Stunde. Seit 7.4 geht eine kurze
 *     Antwort (höchstens 500 Zeichen) über ein Gateway mit Netz
 *     (`funk-gateway.ts`) – mehr gehört nicht versprochen.
 *
 * NUR VERSCHLÜSSELT (seit 7.1)
 * Funk hört jeder in Reichweite mit, und ein Sender lässt sich anpeilen. Ein
 * Paket mit dem Schlüssel des Absenders verrät deshalb, wer wo ist. Über Mesh
 * gehen nur noch Umschläge (NIP-59, Autor ist ein Wegwerf-Schlüssel) und
 * vollständig signierte Solana-Transaktionen – geprüft von `pruefeMeshInhalt()`
 * beim Senden, Empfangen und im Abgleich. MLS-Nachrichten kommen mit 2.2b dazu.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { NostrEvent, hasValidEventShape, verifyEvent } from "./event.js";
import { KIND_GIFT_WRAP } from "./gift-wrap.js";

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

// ------------------------------------------------ Was über Mesh darf (7.1)

/** Obergrenze einer Solana-Transaktion (Paketgröße im Netz). */
export const SOLANA_TX_MAX_BYTES = 1232;

/** Bestandsmeldung für den Abgleich: „D“, Anzahl (4 Byte), Bloom-Filter. */
export const BESTAND_MARKE = 0x44;
export const BESTAND_BYTES = 1024;

/**
 * Nachforderung fehlender Rahmen (7.4b): „N“, Kennung der Nachricht (4 Byte),
 * Bitfeld der fehlenden Nummern (256 Bit). Kein Inhalt – nur, was ohnehin in
 * jedem Rahmenkopf in der Luft steht.
 */
export const NACHFORDERUNG_MARKE = 0x4e;
export const NACHFORDERUNG_BYTES = 1 + 4 + 32;

/** Nur diese Arten reicht ein Knoten weiter – Klartext und Ecash nicht. */
const VERSCHLUESSELTE_ARTEN = new Set<number>([MeshKind.NostrEvent, MeshKind.SolanaTx]);

const HEX64 = /^[0-9a-f]{64}$/;
/** NIP-44 v2: Base64, erstes Byte 0x02 („A…“), mindestens 99 Byte (132 Zeichen). */
const NIP44 = /^A[A-Za-z0-9+/]{131,}={0,2}$/;

/** Warum eine Solana-Transaktion nicht vollständig signiert ist (8.16g2b3) – die App bildet daraus den Text. */
export type SolanaTxFehler =
  | "zu-gross" | "ohne-signatur" | "version" | "unvollstaendig" | "signaturzahl" | "ohne-konten" | "signatur";

/** Ergebnis von `pruefeSolanaTx()`; `bytes` bei "zu-gross", `signatur`/`signaturen` bei "signatur". */
export type SolanaTxPruefung =
  | { ok: true }
  | { ok: false; grund: string; fall: SolanaTxFehler; bytes?: number; signatur?: number; signaturen?: number };

/** Warum eine Nutzlast nicht über Mesh darf (8.16g2b3). */
export type MeshFehler = SolanaTxFehler | "klartext" | "kein-event" | "kein-umschlag" | "umschlag-signatur" | "eigener-schluessel";

export type MeshPruefung =
  | { ok: true; art: "umschlag" | "bestand" | "nachforderung" | "solana" }
  | { ok: false; grund: string; fall: MeshFehler; bytes?: number; signatur?: number; signaturen?: number };

/**
 * Ist das ein Umschlag nach NIP-59, wie er über Mesh darf? Nur die Form:
 * Kind 1059, Inhalt NIP-44, genau ein Empfänger, sonst höchstens Ablauf
 * (NIP-40) und Rechenarbeit (NIP-13). Jedes weitere Tag könnte Klartext tragen.
 * Die Signatur prüft `pruefeMeshInhalt()`.
 */
export function istMeshUmschlag(ev: NostrEvent): boolean {
  if (!hasValidEventShape(ev) || ev.kind !== KIND_GIFT_WRAP) return false;
  if (!NIP44.test(ev.content) || ev.content.length % 4 !== 0) return false;
  let empfaenger = 0;
  for (const t of ev.tags) {
    if (t[0] === "p" && t.length === 2 && HEX64.test(t[1])) empfaenger++;
    else if (t[0] === "expiration" && t.length === 2 && /^\d{1,12}$/.test(t[1])) continue;
    else if (t[0] === "nonce" && t.length === 3 && /^\d{1,16}$/.test(t[1]) && /^\d{1,3}$/.test(t[2])) continue;
    else return false;
  }
  return empfaenger === 1;
}

/** compact-u16 der Solana-Serialisierung; null bei kaputter Kodierung. */
function leseKurzzahl(b: Uint8Array, off: number): { wert: number; laenge: number } | null {
  let wert = 0;
  for (let i = 0; i < 3; i++) {
    if (off + i >= b.length) return null;
    const x = b[off + i];
    wert |= (x & 0x7f) << (7 * i);
    if ((x & 0x80) === 0) return { wert, laenge: i + 1 };
  }
  return null;
}

/**
 * Vollständig signierte Solana-Transaktion (Legacy oder v0)? Jede verlangte
 * Signatur muss zu ihrem Schlüssel und zur Nachricht passen – eine halb
 * signierte Transaktion kann kein Gateway einreichen.
 */
export function pruefeSolanaTx(tx: Uint8Array): SolanaTxPruefung {
  if (tx.length > SOLANA_TX_MAX_BYTES) return { ok: false, grund: `Solana-Transaktion zu groß (${tx.length} Byte)`, fall: "zu-gross", bytes: tx.length };
  const n = leseKurzzahl(tx, 0);
  if (!n || n.wert < 1) return { ok: false, grund: "Solana-Transaktion ohne Signatur", fall: "ohne-signatur" };
  const nachrichtAb = n.laenge + 64 * n.wert;
  const nachricht = tx.subarray(nachrichtAb);
  const kopf = nachricht.length > 0 && (nachricht[0] & 0x80) ? 1 : 0; // v0: Versionsbyte
  if (kopf && nachricht[0] !== 0x80) return { ok: false, grund: "Solana-Transaktion mit unbekannter Version", fall: "version" };
  if (nachricht.length < kopf + 3) return { ok: false, grund: "Solana-Transaktion unvollständig", fall: "unvollstaendig" };
  if (nachricht[kopf] !== n.wert) return { ok: false, grund: "Signaturzahl passt nicht zur Nachricht", fall: "signaturzahl" };
  const k = leseKurzzahl(nachricht, kopf + 3);
  if (!k || k.wert < n.wert) return { ok: false, grund: "Solana-Transaktion ohne Konten", fall: "ohne-konten" };
  const kontenAb = kopf + 3 + k.laenge;
  if (nachricht.length < kontenAb + 32 * k.wert + 32) return { ok: false, grund: "Solana-Transaktion unvollständig", fall: "unvollstaendig" };
  for (let i = 0; i < n.wert; i++) {
    const sig = tx.subarray(n.laenge + 64 * i, n.laenge + 64 * (i + 1));
    const konto = nachricht.subarray(kontenAb + 32 * i, kontenAb + 32 * (i + 1));
    let gueltig = false;
    try {
      gueltig = ed25519.verify(sig, nachricht, konto);
    } catch { /* kaputte Signatur */ }
    if (!gueltig) return { ok: false, grund: `Signatur ${i + 1} von ${n.wert} fehlt oder ist ungültig`, fall: "signatur", signatur: i + 1, signaturen: n.wert };
  }
  return { ok: true };
}

/**
 * Darf diese Nutzlast über Mesh (Funk, Bluetooth, Datei)? Eine Stelle für
 * Senden, Empfangen und Abgleich:
 *   - Nostr-Art: nur ein gültig signierter Umschlag (`istMeshUmschlag`) oder
 *     die Bestandsmeldung des Abgleichs (nur Bits eines Filters);
 *   - Solana-Art: nur eine vollständig signierte Transaktion;
 *   - Klartext und Ecash nie – ein Ecash-Token ist Bargeld für jeden, der mithört.
 * `eigeneSchluessel`: Beim Senden darf keiner davon im Paket stehen – auch
 * nicht als Empfänger. Ein Umschlag an sich selbst verriete über Funk, wem das
 * Gerät gehört.
 */
export function pruefeMeshInhalt(
  payload: Uint8Array,
  kind: MeshKind,
  opts: { eigeneSchluessel?: readonly string[] } = {},
): MeshPruefung {
  if (kind === MeshKind.SolanaTx) {
    const r = pruefeSolanaTx(payload);
    return r.ok ? { ok: true, art: "solana" } : r;
  }
  if (kind !== MeshKind.NostrEvent) return { ok: false, grund: "Über Mesh geht nur Verschlüsseltes – kein Klartext, kein Ecash", fall: "klartext" };
  if (payload.length === 5 + BESTAND_BYTES && payload[0] === BESTAND_MARKE) return { ok: true, art: "bestand" };
  if (leseNachforderung(payload)) return { ok: true, art: "nachforderung" };

  let ev: NostrEvent;
  try {
    ev = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)) as NostrEvent;
  } catch {
    return { ok: false, grund: "Kein Nostr-Event", fall: "kein-event" };
  }
  if (!istMeshUmschlag(ev)) return { ok: false, grund: "Über Mesh gehen nur Umschläge (NIP-59)", fall: "kein-umschlag" };
  if (!verifyEvent(ev)) return { ok: false, grund: "Umschlag mit ungültiger Signatur", fall: "umschlag-signatur" };
  const eigene = (opts.eigeneSchluessel ?? []).map((s) => s.toLowerCase());
  if (eigene.includes(ev.pubkey) || ev.tags.some((t) => eigene.includes(t[1]))) {
    return { ok: false, grund: "Umschlag trägt den eigenen Schlüssel", fall: "eigener-schluessel" };
  }
  return { ok: true, art: "umschlag" };
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
  private teile = new Map<string, { frames: Map<number, Uint8Array>; frame: MeshFrame; seenAt: number; zuletzt: number; gefordert: number }>();
  /** Kürzlich vollständige Nachrichten – eine späte Dublette ist keine Lücke (7.4b2). */
  private fertig = new Map<string, number>();

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
      e = { frames: new Map(), frame: f, seenAt: nowSecs, zuletzt: nowSecs, gefordert: 0 };
      this.teile.set(f.msgId, e);
      // NACH dem Einfuegen aufraeumen: davor koennte die Sammlung um eins
      // ueber die Obergrenze wachsen, und genau darauf zielt ein Angreifer,
      // der Fragments zu nie vervollstaendigten Nachrichten streut.
      this.prune(nowSecs);
    }
    // Widersprüchliche Gesamtzahl: entweder Übertragungsfehler oder zwei
    // Nachrichten mit derselben Kennung. Beides darf nicht zusammenlaufen.
    if (e.frame.total !== f.total) return null;
    if (!e.frames.has(f.index)) e.zuletzt = nowSecs;
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
    this.fertig.delete(f.msgId);
    this.fertig.set(f.msgId, nowSecs);
    if (this.fertig.size > this.maxMessages) this.fertig.delete(this.fertig.keys().next().value!);
    return { ...status, payload };
  }

  /**
   * Lücken, die jetzt nachgefordert werden sollen (7.4b): Nachrichten, bei
   * denen seit `ruheSek` kein neuer Rahmen kam. Jede Nachforderung kostet
   * Sendezeit – deshalb höchstens `maxMal` je Nachricht, und die Ruhe vor der
   * nächsten verdreifacht sich (die Gegenseite wartet vielleicht nur auf ihre
   * Sendezeit).
   */
  faelligeNachforderungen(
    nowSecs = Math.floor(Date.now() / 1000), ruheSek = 20, maxMal = 3,
  ): { msgId: string; fehlend: number[]; priority: MeshPriority }[] {
    const out: { msgId: string; fehlend: number[]; priority: MeshPriority }[] = [];
    for (const [msgId, e] of this.teile) {
      // Späte Dublette einer schon vollständigen Nachricht: nichts nachzufordern
      const fertig = this.fertig.get(msgId);
      if (fertig !== undefined && nowSecs - fertig <= this.maxAgeSeconds) {
        this.teile.delete(msgId);
        continue;
      }
      if (e.gefordert >= maxMal || nowSecs - e.zuletzt < ruheSek * 3 ** e.gefordert) continue;
      const fehlend: number[] = [];
      for (let i = 0; i < e.frame.total; i++) if (!e.frames.has(i)) fehlend.push(i);
      e.gefordert++;
      e.zuletzt = nowSecs;
      out.push({ msgId, fehlend, priority: e.frame.priority });
    }
    return out;
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
    // Klartext und Ecash reicht kein Knoten weiter (7.1) – den Inhalt eines
    // Umschlags prüft erst der Empfänger nach dem Zusammensetzen.
    if (!VERSCHLUESSELTE_ARTEN.has(f.kind)) return false;

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
    /** Sprungzahl; beim Weiterreichen eine weniger als empfangen. */
    ttl = MAX_TTL,
  ): QueuedMessage {
    const frames = fragment(payload, kind, priority, ttl);
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

  /** Einzelne Rahmen erneut einreihen – nachgeforderte (7.4b). */
  enqueueFrames(
    frames: readonly Uint8Array[], msgId: string, priority: MeshPriority, label: string,
    nowSecs = Math.floor(Date.now() / 1000),
  ): void {
    if (frames.length === 0) return;
    this.q.push({ frames: [...frames], priority, queuedAt: nowSecs, msgId, label });
    this.q.sort((a, b) => a.priority - b.priority || a.queuedAt - b.queuedAt);
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
): { feasible: boolean; frames: number; seconds: number; note: string; fall: "zu-gross" | "lang" | "ok" } {
  const frames = Math.ceil(payloadBytes / MAX_PAYLOAD_PER_FRAME);
  const seconds = Math.ceil((frames * LORA_MTU) / Math.max(1, bytesPerSecond));

  if (frames > 255) {
    return {
      feasible: false, frames, seconds, fall: "zu-gross",
      note: `${payloadBytes} Byte sind zu viel für Funk. Grenze: ~${255 * MAX_PAYLOAD_PER_FRAME} Byte.`,
    };
  }
  if (seconds > 600) {
    return {
      feasible: true, frames, seconds, fall: "lang",
      note: `Möglich, dauert aber ~${Math.round(seconds / 60)} Minuten. Für Text sinnvoll, für Dateien nicht.`,
    };
  }
  return {
    feasible: true, frames, seconds, fall: "ok",
    note: `${frames} Pakete, etwa ${seconds} Sekunden.`,
  };
}

// ------------------------------------------------------- Sendezeit (7.1)

/**
 * EU 868 MHz: In den meisten Teilbändern darf ein Gerät höchstens 1 % der
 * Zeit senden, gemessen über eine Stunde (ETSI EN 300 220). Das sind 36
 * Sekunden Sendezeit je Stunde – bei 200 Byte/s rund 7 KB, also wenige
 * Umschläge. Wer mehr sendet, verstößt gegen die Zulassung und stört alle.
 */
export const SENDEZEIT_ANTEIL = 0.01;
export const SENDEZEIT_FENSTER_SEKUNDEN = 3600;

/** Byte in der Luft: Nutzlast plus ein Rahmenkopf je Funkpaket. */
export function luftBytes(payloadBytes: number): number {
  return payloadBytes + Math.ceil(payloadBytes / MAX_PAYLOAD_PER_FRAME) * FRAME_HEADER_BYTES;
}

/**
 * Sendezeitkonto über ein gleitendes Fenster. Gebucht wird je gesendetem
 * Rahmen; vor dem Senden sagt `wartezeit()`, wie lange das Gerät schweigen muss.
 */
export class Sendezeitkonto {
  private gesendet: { at: number; sek: number }[] = [];

  constructor(readonly anteil = SENDEZEIT_ANTEIL, readonly fenster = SENDEZEIT_FENSTER_SEKUNDEN) {}

  /** Sendezeit je Fenster, z. B. 36 s je Stunde. */
  get budget(): number {
    return this.anteil * this.fenster;
  }

  /** Noch freie Sendezeit im aktuellen Fenster (Sekunden). */
  frei(nowSecs: number): number {
    this.gesendet = this.gesendet.filter((g) => g.at > nowSecs - this.fenster);
    return Math.max(0, this.budget - this.gesendet.reduce((s, g) => s + g.sek, 0));
  }

  buche(sek: number, nowSecs: number): void {
    this.gesendet.push({ at: nowSecs, sek });
  }

  /** Sekunden bis `sek` Sendezeit frei sind (0 = sofort). */
  wartezeit(sek: number, nowSecs: number): number {
    if (sek > this.budget) throw new Error(`Ein Rahmen braucht ${sek}s – mehr als ${this.budget}s je Fenster`);
    let fehlt = sek - this.frei(nowSecs);
    for (const g of this.gesendet) {
      if (fehlt <= 0) break;
      fehlt -= g.sek;
      if (fehlt <= 0) return Math.max(0, g.at + this.fenster - nowSecs);
    }
    return 0;
  }

  /**
   * Ehrliche Dauer für `sek` Sendezeit: im Budget sofort, darüber läuft der
   * Rest nur mit dem erlaubten Anteil – bei 1 % hundertmal langsamer.
   */
  dauer(sek: number, nowSecs: number): number {
    const frei = this.frei(nowSecs);
    return Math.ceil(sek <= frei ? sek : frei + (sek - frei) / this.anteil);
  }
}

// -------------------------------------------------- Nachforderung (7.4b)

/** Fehlende Rahmen einer Nachricht nachfordern – Nutzlast für `MeshKind.NostrEvent`. */
export function baueNachforderung(msgId: string, fehlend: readonly number[]): Uint8Array {
  if (!/^[0-9a-f]{8}$/.test(msgId)) throw new Error("Kennung der Nachricht ungültig");
  if (fehlend.length === 0) throw new Error("Nichts nachzufordern");
  const p = new Uint8Array(NACHFORDERUNG_BYTES);
  p[0] = NACHFORDERUNG_MARKE;
  for (let b = 0; b < 4; b++) p[1 + b] = parseInt(msgId.substr(b * 2, 2), 16);
  for (const i of fehlend) {
    // Eine Nachricht hat höchstens 255 Rahmen (0 … 254)
    if (!Number.isInteger(i) || i < 0 || i > 254) throw new Error(`Rahmennummer ${i} ungültig`);
    p[5 + (i >> 3)] |= 1 << (i & 7);
  }
  return p;
}

/** Nachforderung lesen; null, wenn die Nutzlast keine ist (oder nichts fehlt). */
export function leseNachforderung(p: Uint8Array): { msgId: string; fehlend: number[] } | null {
  if (p.length !== NACHFORDERUNG_BYTES || p[0] !== NACHFORDERUNG_MARKE) return null;
  const fehlend: number[] = [];
  for (let i = 0; i < 255; i++) if (p[5 + (i >> 3)] & (1 << (i & 7))) fehlend.push(i);
  // Bit 255 gibt es nicht – gesetzt heißt: keine Nachforderung, sondern Müll
  if (fehlend.length === 0 || p[36] & 0x80) return null;
  return { msgId: bytesToHex(p.subarray(1, 5)), fehlend };
}

/**
 * Gedächtnis gesendeter Nachrichten, damit fehlende Rahmen nachgesendet werden
 * können (7.4b). Begrenzt, weil jede Nachforderung Sendezeit kostet und ein
 * Fremder sonst das Gerät zum Dauersenden brächte: wenige Nachrichten, eine
 * Stunde, höchstens `maxNachsenden` Mal je Nachricht.
 */
export class Sendegedaechtnis {
  private m = new Map<string, { frames: Uint8Array[]; at: number; nachgesendet: number }>();

  constructor(private maxNachrichten = 20, private maxAlterSek = 3600, private maxNachsenden = 2) {}

  merke(msgId: string, frames: readonly Uint8Array[], nowSecs = Math.floor(Date.now() / 1000)): void {
    this.m.delete(msgId);
    this.m.set(msgId, { frames: [...frames], at: nowSecs, nachgesendet: 0 });
    for (const [k, e] of this.m) if (nowSecs - e.at > this.maxAlterSek) this.m.delete(k);
    while (this.m.size > this.maxNachrichten) this.m.delete(this.m.keys().next().value!);
  }

  /** Ging diese Nachricht (noch gemerkt) von hier aus? Dann reicht der Knoten eine Nachforderung nicht weiter. */
  kennt(msgId: string, nowSecs = Math.floor(Date.now() / 1000)): boolean {
    const e = this.m.get(msgId);
    return !!e && nowSecs - e.at <= this.maxAlterSek;
  }

  /** Die angeforderten Rahmen – leer, wenn die Nachricht unbekannt, zu alt oder schon oft nachgesendet ist. */
  nachsenden(n: { msgId: string; fehlend: readonly number[] }, nowSecs = Math.floor(Date.now() / 1000)): Uint8Array[] {
    const e = this.m.get(n.msgId);
    if (!e || nowSecs - e.at > this.maxAlterSek || e.nachgesendet >= this.maxNachsenden) return [];
    const frames = n.fehlend.filter((i) => i < e.frames.length).map((i) => e.frames[i]);
    if (frames.length > 0) e.nachgesendet++;
    return frames;
  }
}

// ------------------------------------ Strecke zum Funkgerät (7.4b2, 7.4c1)

/**
 * Rahmen für eine Byte-Strecke zum Funkgerät – USB, Bluetooth, TCP-Brücke des
 * Knotens: zwei Byte Länge (Big Endian), dann der Rahmen. Ohne Grenze fließen
 * Rahmen im Strom ineinander; bis 7.4c1 las die App über USB gar nicht, und
 * über Bluetooth kamen Häppchen statt Rahmen an.
 */
export function mitLaenge(frame: Uint8Array): Uint8Array {
  if (frame.length === 0 || frame.length > LORA_MTU) throw new Error(`Rahmen mit ${frame.length} Byte passt nicht über Funk`);
  const out = new Uint8Array(2 + frame.length);
  out[0] = frame.length >> 8;
  out[1] = frame.length & 0xff;
  out.set(frame, 2);
  return out;
}

/**
 * Rahmen aus dem Byte-Strom der Strecke. Eine unmögliche Länge (0 oder mehr als
 * ein Funkpaket) heißt: Der Strom hat sich verschoben – ein Byte weiter
 * suchen. Was dabei falsch zusammenkommt, verwirft der Zusammenbau (die
 * Kennung ist der Hash des Inhalts).
 */
export class LaengenRahmen {
  private puffer = new Uint8Array(0);

  push(chunk: Uint8Array): Uint8Array[] {
    const neu = new Uint8Array(this.puffer.length + chunk.length);
    neu.set(this.puffer);
    neu.set(chunk, this.puffer.length);
    this.puffer = neu;
    const out: Uint8Array[] = [];
    while (this.puffer.length >= 2) {
      const n = (this.puffer[0] << 8) | this.puffer[1];
      if (n === 0 || n > LORA_MTU) {
        this.puffer = this.puffer.subarray(1);
        continue;
      }
      if (this.puffer.length < 2 + n) break;
      out.push(this.puffer.slice(2, 2 + n));
      this.puffer = this.puffer.subarray(2 + n);
    }
    return out;
  }
}
