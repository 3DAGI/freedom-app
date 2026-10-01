/**
 * Storage-Rolle: Seeder-Node fuer Freedom Blobs.
 *
 * Der Node haelt Chunks (KIND_BLOB_CHUNK) auf der Festplatte:
 * - Annahme: Chunks aus dem Relay-Feed abonniert (oder via API gepusht)
 * - Haltung: unter data/storage/<sha256>.bin, LRU-Verdraengung bei Quota
 * - Auslieferung: Relay-Anfragen (später HTTP-API) — Micro-Reward pro Fetch
 * - BOOTSTRAP_SEEDER=1: haelt ALLE gesehenen Chunks (Startphase des Netzes)
 *
 * Non-custodial: der Seeder kann jederzeit kündigen — dank Erasure Coding
 * bleibt die Datei rekonstruierbar, solange genug andere Seeder existieren.
 *
 * Seit 8.9a: nur Verschluesseltes (`nimmAuf` → `pruefeSpeicherStueck`). Zu
 * jedem Stueck merkt sich der Knoten das signierte Event ohne Inhalt
 * (`<blob>.<index>.json`), um es auf Abruf wieder zu veroeffentlichen
 * (`ereignis`) – der Inhalt kommt aus der .bin-Datei, die ID prueft beides.
 *
 * Seit B-9b: Stuecke, die der Besitzer halten laesst (`nimmAuf(ev, { halten })`),
 * verdraengt die LRU nie; sie stehen in `gehalten.json` und zaehlen zur Quota –
 * ist sie damit voll, nimmt der Knoten keine weiteren zum Halten an.
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { computeEventId, getTag, pruefeSpeicherStueck, sha256, toHex, type NostrEvent } from "@freedomstack/protocol";

export interface StorageConfig {
  /** Speicherort fuer Chunk-Dateien. */
  dir: string;
  /** Max. Speicher in Bytes (LRU-Verdraengung darueber). 0 = unbegrenzt. */
  quotaBytes: number;
  /** Bootstrap: alle gesehenen Chunks halten (Netz-Startphase). */
  bootstrapSeeder: boolean;
}

export interface StoredChunk {
  sha256Hex: string;
  blobId: string;
  shardIndex: number;
  sizeBytes: number;
  storedAt: number;
}

export class StorageRole {
  private lastAccess = new Map<string, number>();
  private totalBytes = 0;
  /** blobId:idx -> sha256 (fuer Chunk-Fetch-Jobs). */
  private blobIndex = new Map<string, string>();
  /** Vom Besitzer gehaltene Stuecke (sha256) – nie verdraengt (B-9b). */
  private gehalten = new Set<string>();
  private gehaltenBytes = 0;

  constructor(private cfg: StorageConfig) {}

  async init(): Promise<void> {
    await fs.mkdir(this.cfg.dir, { recursive: true });
    // bestehende chunks einlesen (restart-faehig)
    try {
      const files = await fs.readdir(this.cfg.dir);
      for (const f of files) {
        if (!f.endsWith(".bin")) continue;
        const stat = await fs.stat(join(this.cfg.dir, f));
        this.totalBytes += stat.size;
        this.lastAccess.set(f.replace(".bin", ""), Date.now());
      }
    } catch { /* leer */ }
    // index.jsonl laden
    try {
      const raw = await fs.readFile(join(this.cfg.dir, "index.jsonl"), "utf8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line) as { blobId: string; idx: number; hash: string };
          this.blobIndex.set(`${e.blobId}:${e.idx}`, e.hash);
        } catch { /* zeile skip */ }
      }
    } catch { /* keine index-datei */ }
    // gehaltene Stuecke (B-9b)
    try {
      const liste = JSON.parse(await fs.readFile(join(this.cfg.dir, "gehalten.json"), "utf8")) as unknown;
      for (const h of Array.isArray(liste) ? liste : []) {
        if (typeof h !== "string" || !/^[0-9a-f]{64}$/.test(h)) continue;
        try {
          this.gehaltenBytes += (await fs.stat(join(this.cfg.dir, `${h}.bin`))).size;
          this.gehalten.add(h);
        } catch { /* Datei fehlt – nicht mehr gehalten */ }
      }
    } catch { /* noch keine Datei */ }
  }

  /** Chunk speichern (dedup via sha256) + blob-index eintrag. */
  async put(blobId: string, shardIndex: number, bytes: Uint8Array): Promise<StoredChunk> {
    const hash = toHex(sha256(bytes));
    const path = join(this.cfg.dir, `${hash}.bin`);
    // dedup
    try {
      await fs.access(path);
      this.lastAccess.set(hash, Date.now());
      await this.indexPut(blobId, shardIndex, hash);
      return { sha256Hex: hash, blobId, shardIndex, sizeBytes: bytes.length, storedAt: Date.now() };
    } catch { /* neu */ }

    // quota: LRU verdraengen bevor wir schreiben (bootstrap-seeder: nie verdraengen)
    if (this.cfg.quotaBytes > 0 && !this.cfg.bootstrapSeeder) {
      while (this.totalBytes + bytes.length > this.cfg.quotaBytes) {
        const evicted = await this.evictOne(hash);
        if (!evicted) break; // nichts mehr zu verdraengen
      }
    }

    await fs.writeFile(path, bytes);
    this.totalBytes += bytes.length;
    this.lastAccess.set(hash, Date.now());
    await this.indexPut(blobId, shardIndex, hash);
    return { sha256Hex: hash, blobId, shardIndex, sizeBytes: bytes.length, storedAt: Date.now() };
  }

  /**
   * Ein Stueck aus dem Relay-Feed aufnehmen – nur, wenn es als verschluesselt
   * gekennzeichnet ist und die Pruefung besteht. Gibt den Grund der Ablehnung
   * zurueck (nie den Inhalt).
   */
  async nimmAuf(ev: NostrEvent, opts: { halten?: boolean } = {}): Promise<{ ok: true } | { ok: false; grund: string }> {
    const r = pruefeSpeicherStueck(ev);
    if (!r.ok) return r;
    const hash = getTag(ev, "sha256") ?? "";
    if (opts.halten && !this.gehalten.has(hash) && this.cfg.quotaBytes > 0 && this.gehaltenBytes + r.bytes.length > this.cfg.quotaBytes) {
      return { ok: false, grund: "Speicher voll" };
    }
    await this.put(r.blobId, r.index, r.bytes);
    if (opts.halten && !this.gehalten.has(hash)) {
      this.gehalten.add(hash);
      this.gehaltenBytes += r.bytes.length;
      await this.sichereGehalten();
    }
    const { content: _, ...ohneInhalt } = ev;
    try {
      await fs.writeFile(join(this.cfg.dir, `${r.blobId}.${r.index}.json`), JSON.stringify(ohneInhalt));
    } catch { /* ohne Event kein Wiederveroeffentlichen – das Stueck bleibt gehalten */ }
    return { ok: true };
  }

  /** Die Liste der gehaltenen Stuecke ablegen – erst eine neue Datei, dann umbenennen. */
  private async sichereGehalten(): Promise<void> {
    const datei = join(this.cfg.dir, "gehalten.json");
    await fs.writeFile(`${datei}.tmp`, JSON.stringify([...this.gehalten]), { mode: 0o600 });
    await fs.rename(`${datei}.tmp`, datei);
  }

  /** Haelt der Knoten dieses Stueck fuer den Besitzer (B-9b)? */
  haelt(sha256Hex: string): boolean {
    return this.gehalten.has(sha256Hex);
  }

  /** Das gespeicherte Stueck-Event wieder zusammensetzen (fuer Abruf-Auftraege); null, wenn nicht gehalten. */
  async ereignis(blobId: string, index: number): Promise<NostrEvent | null> {
    if (!/^[0-9a-f]{64}$/.test(blobId) || !Number.isInteger(index) || index < 0) return null;
    try {
      const meta = JSON.parse(await fs.readFile(join(this.cfg.dir, `${blobId}.${index}.json`), "utf8")) as Omit<NostrEvent, "content">;
      const bytes = await this.getByBlobIndex(blobId, index);
      if (!bytes) return null;
      const ev: NostrEvent = { ...meta, content: toHex(bytes) };
      return computeEventId(ev) === ev.id ? ev : null;
    } catch {
      return null;
    }
  }

  /** Index-Datei: blobId:idx -> sha256 (fuer Chunk-Fetch-Jobs). */
  private async indexPut(blobId: string, shardIndex: number, hash: string): Promise<void> {
    try {
      await fs.appendFile(join(this.cfg.dir, "index.jsonl"), `${JSON.stringify({ blobId, idx: shardIndex, hash })}\n`);
    } catch { /* index optional */ }
  }

  /** Chunk per (blobId, shardIndex) finden — nutzt den in-memory index. */
  async getByBlobIndex(blobId: string, shardIndex: number): Promise<Uint8Array | null> {
    // erst memory-index (beim init aus index.jsonl geladen)
    const hash = this.blobIndex.get(`${blobId}:${shardIndex}`);
    if (hash) return this.get(hash);
    // fallback: index.jsonl durchsuchen (langsam, nur einmal — dann gecached)
    try {
      const raw = await fs.readFile(join(this.cfg.dir, "index.jsonl"), "utf8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line) as { blobId: string; idx: number; hash: string };
          if (e.blobId === blobId && e.idx === shardIndex) {
            this.blobIndex.set(`${blobId}:${shardIndex}`, e.hash);
            return this.get(e.hash);
          }
        } catch { /* zeile skip */ }
      }
    } catch { /* keine index-datei */ }
    return null;
  }

  /** Chunk laden (hash-verifiziert). */
  async get(sha256Hex: string): Promise<Uint8Array | null> {
    const path = join(this.cfg.dir, `${sha256Hex}.bin`);
    try {
      const bytes = new Uint8Array(await fs.readFile(path));
      const actual = toHex(sha256(bytes));
      if (actual !== sha256Hex) {
        await fs.unlink(path).catch(() => {}); // korrupt -> weg damit
        return null;
      }
      this.lastAccess.set(sha256Hex, Date.now());
      return bytes;
    } catch {
      return null;
    }
  }

  /** Hat der Seeder diesen Chunk? */
  async has(sha256Hex: string): Promise<boolean> {
    try { await fs.access(join(this.cfg.dir, `${sha256Hex}.bin`)); return true; }
    catch { return false; }
  }

  /** LRU: aeltesten zugriff loeschen (nicht den den wir gerade schreiben wollen). */
  private async evictOne(excludeHash: string): Promise<boolean> {
    let oldest: string | null = null;
    let oldestAt = Infinity;
    for (const [hash, at] of this.lastAccess) {
      if (hash === excludeHash || this.gehalten.has(hash)) continue; // gehaltene nie (B-9b)
      if (at < oldestAt) { oldestAt = at; oldest = hash; }
    }
    if (!oldest) return false;
    const path = join(this.cfg.dir, `${oldest}.bin`);
    try {
      const stat = await fs.stat(path);
      await fs.unlink(path);
      this.lastAccess.delete(oldest);
      this.totalBytes = Math.max(0, this.totalBytes - stat.size);
      return true;
    } catch {
      return false;
    }
  }

  stats(): { chunks: number; totalBytes: number; quotaBytes: number; bootstrap: boolean; gehalten: number; gehaltenBytes: number } {
    return {
      chunks: this.lastAccess.size, totalBytes: this.totalBytes, quotaBytes: this.cfg.quotaBytes, bootstrap: this.cfg.bootstrapSeeder,
      gehalten: this.gehalten.size, gehaltenBytes: this.gehaltenBytes,
    };
  }
}
