/**
 * FileRelay: Offline-Transport ueber Dateien (USB-Stick, SD-Karte, geteilter
 * Ordner, Bluetooth-Dateitransfer, ...). Nostr-Events sind signierte JSON —
 * transport-unabhaengig. Ein FileRelay schreibt/liest Events als .json-Dateien
 * in einem Ordner, der physisch zwischen Geraeten wandern kann.
 *
 * Das ist der einfachste Mesh-Transport: Outbox exportieren -> USB-Stick ->
 * auf anderem Geraet importieren. Belohnung via Delivery-Receipt (siehe
 * mesh.ts): der Ueberbringer beweist Zustellung, Empfaenger zahlt aus Escrow.
 */
import { NostrEvent, verifyEvent } from "./event.js";
import { Relay, RelayFilter } from "./outbox.js";

export interface FileRelayStorage {
  /** Alle .json-Dateien im Ordner lesen (rohe Strings). */
  readAll(): Promise<string[]>;
  /** Eine Datei schreiben (Name + Inhalt). */
  write(name: string, content: string): Promise<void>;
}

/** Node/fs-Implementierung (Server/CLI). Nicht im Browser verfuegbar —
 *  dort memStorage oder eine IndexedDB-Variante nutzen. */
export function fsStorage(dir: string): FileRelayStorage {
  return {
    async readAll() {
      const fs = await import("node:fs/promises").catch(() => null);
      const path = await import("node:path").catch(() => null);
      if (!fs || !path) return [];
      let files: string[] = [];
      try {
        files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
      } catch { return []; }
      const out: string[] = [];
      for (const f of files) {
        try { out.push(await fs.readFile(path.join(dir, f), "utf8")); } catch { /* skip */ }
      }
      return out;
    },
    async write(name, content) {
      const fs = await import("node:fs/promises").catch(() => null);
      const path = await import("node:path").catch(() => null);
      if (!fs || !path) return;
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, name), content, "utf8");
    },
  };
}

/** In-Memory-Storage (Tests/Browser). */
export function memStorage(initial: Record<string, string> = {}): FileRelayStorage & { files: Record<string, string> } {
  const files = { ...initial };
  return {
    files,
    async readAll() { return Object.values(files); },
    async write(name, content) { files[name] = content; },
  };
}

export class FileRelay implements Relay {
  readonly url: string;
  private seenIds = new Set<string>();
  constructor(private storage: FileRelayStorage, url = "file://outbox") {
    this.url = url;
  }

  /** Schreibt ein Event als <id>.json in den Ordner. */
  async publish(ev: NostrEvent): Promise<void> {
    if (this.seenIds.has(ev.id)) return;
    this.seenIds.add(ev.id);
    await this.storage.write(`${ev.id}.json`, JSON.stringify(ev));
  }

  /** Liest alle Events, verifiziert Signatur, filtert. */
  async query(filter: RelayFilter): Promise<NostrEvent[]> {
    const raw = await this.storage.readAll();
    const out: NostrEvent[] = [];
    for (const r of raw) {
      let ev: NostrEvent;
      try { ev = JSON.parse(r); } catch { continue; }
      if (!ev.id || !ev.sig || !ev.pubkey) continue;
      try { if (!verifyEvent(ev)) continue; } catch { continue; }
      if (filter.kinds && !filter.kinds.includes(ev.kind)) continue;
      if (filter.authors && !filter.authors.includes(ev.pubkey)) continue;
      if (filter.ids && !filter.ids.includes(ev.id)) continue;
      if (filter.since && ev.created_at < filter.since) continue;
      if (filter.until && ev.created_at > filter.until) continue;
      // Tag-Filter (#x)
      let tagOk = true;
      for (const [k, vals] of Object.entries(filter)) {
        if (!k.startsWith("#") || !vals) continue;
        const tagName = k.slice(1);
        const has = ev.tags.some((t) => t[0] === tagName && vals.includes(t[1]));
        if (!has) { tagOk = false; break; }
      }
      if (!tagOk) continue;
      out.push(ev);
    }
    out.sort((a, b) => b.created_at - a.created_at);
    return filter.limit ? out.slice(0, filter.limit) : out;
  }
}
