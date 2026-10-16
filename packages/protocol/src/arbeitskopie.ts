/**
 * Arbeitskopie eines Repo-Auftrags (Schritt 11.5a1, `docs/REPO-AGENTEN-ENTWURF.md`
 * V3, V4 und W3a A): der Baum am Kopf des Bundles als Liste von Dateien – nur aus
 * dem Bundle, ohne git, ohne Platte. Den Arbeitsordner schreibt der Knoten
 * (`node/src/arbeitskopie.ts`); der Agent arbeitet darin in der Sandbox (VKb).
 *
 * Bundles kommen von Fremden. Deshalb gilt je Pfad, was git selbst verlangt
 * (`istRepoPfad()`: kein `..`, kein `.git` in keinem Teil, keine Steuerzeichen),
 * jeder Name nur einmal je Ordner, und alles ist begrenzt (`ARBEITSKOPIE_GRENZEN`)
 * – auch derselbe Ordner an vielen Stellen zählt je Stelle, sonst würden aus
 * wenigen Objekten Millionen Dateien. Was nicht passt, bricht mit `BundleFehler` ab.
 */
import { BundleFehler, type GelesenesBundle, kopfCommit, leseBaum, leseCommit } from "./git-bundle.js";

export const ARBEITSKOPIE_GRENZEN = {
  /** Dateien zusammen (je Stelle im Baum). */
  dateien: 20_000,
  /** Bytes zusammen – so viel belegt die Arbeitskopie im Arbeitsordner. */
  bytes: 256 * 1024 * 1024,
  /** Ordner in Ordnern. */
  tiefe: 32,
  /** Ziel eines Verweises (Symlink), in Bytes. */
  verweis: 1024,
} as const;

export type ArbeitskopieGrenzen = { [K in keyof typeof ARBEITSKOPIE_GRENZEN]: number };

/** `datei` 100644, `ausfuehrbar` 100755, `verweis` 120000 (Inhalt ist das Ziel). */
export type ArbeitsDateiArt = "datei" | "ausfuehrbar" | "verweis";
export interface ArbeitsDatei {
  pfad: string;
  art: ArbeitsDateiArt;
  daten: Uint8Array;
  /** Kennung des Blobs, wenn bekannt (aus dem Baum) – sonst rechnet der Patch-Schreiber sie aus. */
  sha?: string;
}

export interface Arbeitskopie {
  /** Der Commit, dessen Baum es ist – aus dem Bundle, nie aus einem Verweis (Befund 4). */
  commit: string;
  dateien: ArbeitsDatei[];
  /** Submodule (160000) bleiben unberührt – Pfad und Commit, damit der Baum gleich bleibt. */
  module: Array<{ pfad: string; sha: string }>;
}

const STEUERZEICHEN = /[\u0000-\u001f\u007f]/;

/** Pfad wie git ihn zulässt (V4): relativ, Teile nicht leer, nicht `.`/`..`/`.git` (gleich wie geschrieben), höchstens 255 Bytes je Teil. */
export function istRepoPfad(pfad: string): boolean {
  if (typeof pfad !== "string" || pfad.length === 0 || pfad.length > 4096 || STEUERZEICHEN.test(pfad)) return false;
  return pfad.split("/").every((t) => t !== "" && t !== "." && t !== ".." && t.toLowerCase() !== ".git" && new TextEncoder().encode(t).length <= 255);
}

/**
 * Der Baum von `commit` (ohne Angabe: `kopfCommit()`) als Dateien. Fehlt ein
 * Objekt (etwa in einem Bundle mit Voraussetzungen), ist die Arbeitskopie nicht
 * vollständig – dann `BundleFehler("kaputt")`, nie eine halbe.
 */
export function arbeitskopie(b: GelesenesBundle, commit: string | undefined = kopfCommit(b), g: ArbeitskopieGrenzen = ARBEITSKOPIE_GRENZEN): Arbeitskopie {
  const c = commit ? b.objekte.get(commit) : undefined;
  if (!commit || c?.art !== "commit") throw new BundleFehler("kaputt");
  const dateien: ArbeitsDatei[] = [];
  const module: Arbeitskopie["module"] = [];
  let bytes = 0;
  const geh = (sha: string, ort: string[]) => {
    const baum = b.objekte.get(sha);
    if (baum?.art !== "tree") throw new BundleFehler("kaputt");
    if (ort.length >= g.tiefe) throw new BundleFehler("gross");
    const namen = new Set<string>();
    for (const e of leseBaum(baum.daten)) {
      const pfad = [...ort, e.name].join("/");
      if (namen.has(e.name) || !istRepoPfad(pfad)) throw new BundleFehler("kaputt");
      namen.add(e.name);
      if (e.art === "ordner") {
        geh(e.sha, [...ort, e.name]);
        continue;
      }
      if (e.art === "modul") {
        module.push({ pfad, sha: e.sha });
        continue;
      }
      const blob = b.objekte.get(e.sha);
      if (blob?.art !== "blob") throw new BundleFehler("kaputt");
      if (e.art === "link" && (blob.daten.length === 0 || blob.daten.length > g.verweis || blob.daten.includes(0))) throw new BundleFehler("kaputt");
      bytes += blob.daten.length;
      if (dateien.length >= g.dateien || bytes > g.bytes) throw new BundleFehler("gross");
      dateien.push({ pfad, art: e.art === "link" ? "verweis" : e.modus === "100755" ? "ausfuehrbar" : "datei", daten: blob.daten, sha: e.sha });
    }
  };
  geh(leseCommit(c.daten).baum, []);
  return { commit, dateien, module };
}
