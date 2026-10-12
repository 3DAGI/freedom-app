/**
 * Der Freedom-Torrent eines Modells (Schritt B-29c2b, MENSCH 12.10.2026: aria2c,
 * verbunden mit dem dezentralen Freedom-Dateisystem – `docs/E9-ENTWURF.md`).
 *
 * Jeder Knoten, der ein Modell geprüft hält, kann denselben Torrent bauen – ohne
 * ihn von irgendwem zu bekommen: Name, Dateien und Stückgröße folgen nur aus dem
 * Manifest, die Stücke aus den geprüften Bytes. Gleiche Bytes, gleiche Kennung
 * (`infohash`). So teilen alle Freedom-Knoten mit demselben Modell einen Schwarm,
 * auch wenn sie es von Hugging Face, von Pirate Face oder voneinander haben.
 *
 * - Name: der Commit bei Hugging Face (`hf:<org/repo>@<commit>`), sonst
 *   `freedom-<Anfang der Inhalts-Kennung>`. Mit dem Commit als Name passt der
 *   Web-Seed von Hugging Face (BEP-19: `<basis>/<name>/<datei>`) – er steht
 *   außerhalb von `info` und ändert die Kennung nicht.
 * - Dateien: die des Manifests, nach Namen sortiert; Stückgröße aus der Summe
 *   (`stueckGroesse()`).
 * - Beim Bauen liest der Knoten jede Datei und prüft zugleich ihre SHA-256 – er
 *   teilt nur, was das Manifest nennt.
 *
 * Bencode (BEP-3) ohne Abhängigkeit: Zahlen, Bytes, Listen, Wörterbücher mit
 * sortierten Schlüsseln.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { type ModelManifest, hfQuelle, inhaltsKennung } from "@freedomstack/protocol";

export type BWert = number | string | Uint8Array | BWert[] | { [k: string]: BWert };

/** Bencode nach BEP-3: Wörterbuch-Schlüssel nach Bytes sortiert, Zahlen nur ganz. */
export function bencode(w: BWert): Buffer {
  if (typeof w === "number") {
    if (!Number.isSafeInteger(w)) throw Object.assign(new Error("keine ganze Zahl"), { name: "BencodeFehler" });
    return Buffer.from(`i${w}e`);
  }
  if (typeof w === "string" || w instanceof Uint8Array) {
    const b = typeof w === "string" ? Buffer.from(w, "utf8") : Buffer.from(w);
    return Buffer.concat([Buffer.from(`${b.length}:`), b]);
  }
  if (Array.isArray(w)) return Buffer.concat([Buffer.from("l"), ...w.map(bencode), Buffer.from("e")]);
  const schluessel = Object.keys(w).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return Buffer.concat([Buffer.from("d"), ...schluessel.flatMap((k) => [bencode(k), bencode(w[k]!)]), Buffer.from("e")]);
}

const MIB = 1024 * 1024;
/** Stückgröße aus der Gesamtgröße – fest, damit jeder Knoten denselben Torrent baut. */
export function stueckGroesse(gesamt: number): number {
  return gesamt > 16e9 ? 16 * MIB : gesamt > 4e9 ? 8 * MIB : gesamt > 1e9 ? 4 * MIB : gesamt > 256e6 ? MIB : MIB / 4;
}

/** Name des Torrents: Commit bei Hugging Face, sonst aus der Inhalts-Kennung. */
export function torrentName(m: ModelManifest): string {
  return hfQuelle(m)?.commit ?? `freedom-${inhaltsKennung(m).slice(0, 16)}`;
}

export interface ModellTorrent {
  infohash: string;
  name: string;
  /** Die .torrent-Datei (bencode) – für `aria2.addTorrent`. */
  datei: Buffer;
  /** Magnet nur mit der Kennung – Tracker und DHT findet der Client selbst. */
  magnet: string;
}

/**
 * Den Freedom-Torrent eines geprüften Modells bauen. Liest die Dateien aus
 * `ordner` (wie das Manifest sie nennt) und prüft dabei ihre SHA-256 – weicht
 * eine ab, wirft es `DateiAnders`. `webSeed` (nur mit Commit als Name sinnvoll):
 * `https://huggingface.co/<org>/<repo>/resolve/`.
 */
export async function baueModellTorrent(m: ModelManifest, ordner: string): Promise<ModellTorrent> {
  const dateien = [...m.files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const gesamt = dateien.reduce((s, f) => s + f.sizeBytes, 0);
  const stueck = stueckGroesse(gesamt);
  const stuecke: Buffer[] = [];
  let puffer = Buffer.alloc(stueck);
  let gefuellt = 0;
  const schliesse = () => { stuecke.push(createHash("sha1").update(puffer.subarray(0, gefuellt)).digest()); gefuellt = 0; };
  for (const f of dateien) {
    const summe = createHash("sha256");
    let n = 0;
    for await (const teil of createReadStream(join(ordner, f.name)) as AsyncIterable<Buffer>) {
      summe.update(teil);
      n += teil.length;
      let off = 0;
      while (off < teil.length) {
        const k = Math.min(stueck - gefuellt, teil.length - off);
        teil.copy(puffer, gefuellt, off, off + k);
        gefuellt += k;
        off += k;
        if (gefuellt === stueck) schliesse();
      }
    }
    if (n !== f.sizeBytes || summe.digest("hex") !== f.sha256) throw Object.assign(new Error("Datei weicht vom Manifest ab"), { name: "DateiAnders" });
  }
  if (gefuellt > 0) schliesse();
  puffer = Buffer.alloc(0);
  const name = torrentName(m);
  const info: BWert = {
    files: dateien.map((f) => ({ length: f.sizeBytes, path: [f.name] })),
    name,
    "piece length": stueck,
    pieces: Buffer.concat(stuecke),
  };
  const quelle = hfQuelle(m);
  const torrent: { [k: string]: BWert } = { info };
  // Web-Seed von Hugging Face: <basis>/<name>/<datei> = …/resolve/<commit>/<datei>
  if (quelle) torrent["url-list"] = [`https://huggingface.co/${quelle.name.org}/${quelle.name.repo}/resolve/`];
  const infohash = createHash("sha1").update(bencode(info)).digest("hex");
  return { infohash, name, datei: bencode(torrent), magnet: `magnet:?xt=urn:btih:${infohash}` };
}
