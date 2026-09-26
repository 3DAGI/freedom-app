/**
 * Lokale Suche (Schritt 8.13): ein Index ueber die eigenen Nachrichten, nur
 * auf diesem Geraet. Gespeichert wird er verschluesselt (AES-GCM 256) in einer
 * eigenen IndexedDB-Datenbank; der Schluessel liegt im Tresor. Ohne Tresor
 * lebt der Index nur im Speicher – ein Schluessel im Klartext daneben waere
 * keine Verschluesselung.
 *
 * Gespeichert werden die Dokumente; die Wortliste entsteht beim Laden neu, in
 * Abschnitten, damit die Oberflaeche bedienbar bleibt. Ablaufende
 * Direktnachrichten (NIP-40) verschwinden mit ihrem Ablauf auch aus dem Index.
 */
import {
  buildIndexIncrementally, emptyIndex, indexDoc, removeDoc, search,
  type IndexedDoc, type SearchHit, type SearchIndex, type SearchOptions,
} from "@freedomstack/protocol";

/** Wo der verschluesselte Index liegt (IndexedDB in der App, Speicher im Test). */
export interface SuchSpeicher {
  lesen(): Promise<string | null>;
  schreiben(blob: string): Promise<void>;
  loeschen(): Promise<void>;
}

export type SuchDoc = IndexedDoc & { ablauf?: number };

const VERSION = 1;
const HEX64 = /^[0-9a-f]{64}$/;

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function ausB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/** Schluessel aus 32 Byte Hex (aus dem Tresor). */
export async function suchSchluessel(hex: string): Promise<CryptoKey> {
  if (!HEX64.test(hex)) throw new Error("Suchschlüssel ungültig");
  const roh = Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
  return crypto.subtle.importKey("raw", roh as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function neuerSuchSchluessel(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fremde bzw. alte Daten streng lesen. */
function alsDoc(x: unknown): SuchDoc | null {
  const d = x as Partial<SuchDoc> | null;
  if (!d || typeof d.id !== "string" || typeof d.text !== "string" || !Number.isSafeInteger(d.createdAt)) return null;
  return {
    id: d.id, text: d.text, createdAt: d.createdAt!,
    ...(typeof d.scope === "string" ? { scope: d.scope } : {}),
    ...(typeof d.author === "string" ? { author: d.author } : {}),
    ...(Number.isSafeInteger(d.ablauf) ? { ablauf: d.ablauf } : {}),
  };
}

export class LokaleSuche {
  private idx: SearchIndex = emptyIndex();
  private ablauf = new Map<string, number>();
  private geaendert = false;
  private zeitgeber: ReturnType<typeof setTimeout> | null = null;

  /**
   * `speicher` und `schluessel` fehlen ohne Tresor – dann nur im Speicher.
   * `jetzt` in Sekunden (Tests).
   */
  constructor(
    private speicher: SuchSpeicher | null,
    private schluessel: CryptoKey | null,
    private jetzt: () => number = () => Math.floor(Date.now() / 1000),
    private speicherVerzoegerung = 2000,
  ) {}

  get anzahl(): number {
    return this.idx.docs.size;
  }

  /** Verschluesselten Index laden und in Abschnitten neu aufbauen; `pause` gibt der Oberflaeche Luft. */
  async laden(pause: () => Promise<void> = async () => undefined): Promise<number> {
    if (!this.speicher || !this.schluessel) return 0;
    const roh = await this.speicher.lesen();
    if (!roh) return 0;
    const { v, iv, ct } = JSON.parse(roh) as { v?: number; iv?: string; ct?: string };
    if (v !== VERSION || typeof iv !== "string" || typeof ct !== "string") throw new Error("Suchindex unlesbar");
    const klar = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ausB64(iv) as BufferSource }, this.schluessel, ausB64(ct) as BufferSource);
    const liste = (JSON.parse(new TextDecoder().decode(klar)) as unknown[]).map(alsDoc).filter((d): d is SuchDoc => !!d);
    const t = this.jetzt();
    const gueltig = liste.filter((d) => d.ablauf === undefined || d.ablauf > t);
    for (const d of gueltig) if (d.ablauf !== undefined) this.ablauf.set(d.id, d.ablauf);
    const bau = buildIndexIncrementally(gueltig);
    for (let s = bau.next(); ; s = bau.next()) {
      if (s.done) {
        this.idx = s.value;
        break;
      }
      await pause();
    }
    if (gueltig.length < liste.length) this.merkeAenderung();
    return this.idx.docs.size;
  }

  /** Eine Nachricht aufnehmen (einmal je Kennung). */
  aufnehmen(doc: SuchDoc): void {
    if (this.idx.docs.has(doc.id) || !doc.text.trim()) return;
    if (doc.ablauf !== undefined) {
      if (doc.ablauf <= this.jetzt()) return;
      this.ablauf.set(doc.id, doc.ablauf);
    }
    indexDoc(this.idx, { id: doc.id, text: doc.text, createdAt: doc.createdAt, scope: doc.scope, author: doc.author });
    this.merkeAenderung();
  }

  /** Suchen – Abgelaufenes fliegt vorher heraus. */
  suche(anfrage: string, opts: SearchOptions = {}): SearchHit[] {
    this.raeumeAuf();
    return search(this.idx, anfrage, opts);
  }

  private raeumeAuf(): void {
    const t = this.jetzt();
    for (const [id, bis] of this.ablauf) {
      if (bis > t) continue;
      removeDoc(this.idx, id);
      this.ablauf.delete(id);
      this.merkeAenderung();
    }
  }

  private merkeAenderung(): void {
    this.geaendert = true;
    if (!this.speicher || this.zeitgeber) return;
    this.zeitgeber = setTimeout(() => { this.zeitgeber = null; void this.speichern(); }, this.speicherVerzoegerung);
  }

  /** Verschluesselt speichern (nur mit Tresor). */
  async speichern(): Promise<void> {
    if (!this.speicher || !this.schluessel || !this.geaendert) return;
    this.raeumeAuf();
    this.geaendert = false;
    const docs = [...this.idx.docs.values()].map((d) => ({ ...d, ...(this.ablauf.has(d.id) ? { ablauf: this.ablauf.get(d.id) } : {}) }));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, this.schluessel, new TextEncoder().encode(JSON.stringify(docs)) as BufferSource));
    await this.speicher.schreiben(JSON.stringify({ v: VERSION, iv: b64(iv), ct: b64(ct) }));
  }

  /** Alles vergessen – im Speicher und auf dem Geraet. */
  async vergessen(): Promise<void> {
    if (this.zeitgeber) clearTimeout(this.zeitgeber);
    this.zeitgeber = null;
    this.idx = emptyIndex();
    this.ablauf.clear();
    this.geaendert = false;
    await this.speicher?.loeschen();
  }
}
