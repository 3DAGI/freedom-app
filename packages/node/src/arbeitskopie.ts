/**
 * Arbeitsordner eines Repo-Auftrags (Schritt 11.5a1, `docs/REPO-AGENTEN-ENTWURF.md`
 * W3a A, „Arbeitsordner im Arbeitsspeicher“): je Auftrag ein neuer Ordner (0700),
 * wo es geht auf einem tmpfs (`/dev/shm`), darin die Arbeitskopie aus dem Bundle
 * (`arbeitskopie()` im Protokoll). Darin arbeitet der Agent in der Sandbox (VKb);
 * nach dem Auftrag löscht `weg()` den Ordner, auch wenn er scheitert (11.5c).
 *
 * Geschrieben wird nur in einen leeren, echten Ordner, jede Datei neu
 * (`O_EXCL`, `O_NOFOLLOW`), Verweise (Symlinks) zuletzt – so führt beim Schreiben
 * kein Pfad durch einen Verweis aus dem Bundle. Der Knoten folgt Verweisen nie:
 * Wer den Ordner danach liest (Patch, 11.5a2), nimmt `lstat` und liest einen
 * Verweis als Text – der Agent kann in der Sandbox Verweise auf alles anlegen.
 */
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ARBEITSKOPIE_GRENZEN, type ArbeitsDatei, type Arbeitskopie, type ArbeitskopieGrenzen, type IgnoreRegel, istIgnoriert, istRepoPfad, leseIgnore,
} from "@freedomstack/protocol";

/** Ort für Arbeitsordner: `/dev/shm` (Arbeitsspeicher), wenn es ihn als Ordner gibt, sonst das Temp-Verzeichnis. */
export function arbeitsOrt(shm = "/dev/shm"): string {
  try {
    return lstatSync(shm).isDirectory() ? shm : tmpdir();
  } catch {
    return tmpdir();
  }
}

/** Ein neuer, leerer Arbeitsordner (0700) und wie man ihn wieder los wird. */
export function neuerArbeitsordner(basis: string = arbeitsOrt()): { ordner: string; weg: () => void } {
  const ordner = mkdtempSync(join(basis, "freedom-arbeit-"));
  return { ordner, weg: () => rmSync(ordner, { recursive: true, force: true }) };
}

function schreibeGanz(fd: number, daten: Uint8Array): void {
  for (let ab = 0; ab < daten.length;) ab += writeSync(fd, daten, ab);
}

/** Die Arbeitskopie in `ordner` schreiben – nur in einen leeren, echten Ordner. */
export function schreibeArbeitskopie(ordner: string, k: Arbeitskopie): void {
  if (!lstatSync(ordner).isDirectory() || readdirSync(ordner).length > 0) throw new Error("Arbeitsordner kein leerer Ordner");
  if (k.dateien.some((d) => !istRepoPfad(d.pfad))) throw new Error("Pfad ungültig");
  const neu = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
  for (const d of k.dateien) {
    if (d.art === "verweis") continue;
    const ziel = join(ordner, d.pfad);
    mkdirSync(dirname(ziel), { recursive: true, mode: 0o755 });
    const fd = openSync(ziel, neu, d.art === "ausfuehrbar" ? 0o755 : 0o644);
    try {
      schreibeGanz(fd, d.daten);
    } finally {
      closeSync(fd);
    }
  }
  for (const d of k.dateien) {
    if (d.art !== "verweis") continue;
    const ziel = join(ordner, d.pfad);
    mkdirSync(dirname(ziel), { recursive: true, mode: 0o755 });
    symlinkSync(new TextDecoder().decode(d.daten), ziel);
  }
}

/** Eine `.gitignore` liest der Knoten nur bis zu dieser Größe. */
const IGNORE_BYTES = 64 * 1024;

/**
 * Den Arbeitsordner nach dem Auftrag lesen (11.5a2b) – für `schreibePatch()`.
 * Nur `lstat`: Verweise kommen als ihr Text (`verweis`), nie als das, worauf
 * sie zeigen; anderes als Dateien, Ordner und Verweise fällt weg. `.git` in
 * jeder Schreibweise und Submodule (aus `alt`) betritt der Knoten nie. Was die
 * `.gitignore`-Dateien ignorieren, bleibt draußen – ein ignorierter Ordner
 * wird nicht betreten, außer git kennt Dateien darin (`alt`); bekannte Dateien
 * bleiben immer drin, wie bei git. Grenzen wie die Arbeitskopie.
 */
export function leseArbeitsordner(ordner: string, alt: Arbeitskopie, g: ArbeitskopieGrenzen = ARBEITSKOPIE_GRENZEN): { dateien: ArbeitsDatei[] } | { fall: "patch.gross" | "patch.ordner" } {
  const bekannt = new Set(alt.dateien.map((d) => d.pfad));
  const bekannteOrdner = new Set(alt.dateien.flatMap((d) => d.pfad.split("/").slice(0, -1).map((_, i, t) => t.slice(0, i + 1).join("/"))));
  const module = new Set(alt.module.map((m) => m.pfad));
  const regeln: IgnoreRegel[] = [];
  const dateien: ArbeitsDatei[] = [];
  let bytes = 0;
  class Grenze extends Error {}
  const nimm = (d: ArbeitsDatei) => {
    bytes += d.daten.length;
    if (dateien.length >= g.dateien || bytes > g.bytes) throw new Grenze();
    dateien.push(d);
  };
  const geh = (rel: string, tiefe: number, nurBekannte: boolean) => {
    if (tiefe > g.tiefe) throw new Grenze();
    const voll = rel ? join(ordner, rel) : ordner;
    const namen = readdirSync(voll);
    if (namen.length > g.dateien) throw new Grenze();
    if (!nurBekannte && namen.includes(".gitignore")) {
      const st = lstatSync(join(voll, ".gitignore"));
      if (st.isFile() && st.size <= IGNORE_BYTES) regeln.push(...leseIgnore(readFileSync(join(voll, ".gitignore"), "utf8"), rel));
    }
    for (const name of namen) {
      const pfad = rel ? `${rel}/${name}` : name;
      if (name.toLowerCase() === ".git" || module.has(pfad) || !istRepoPfad(pfad)) continue;
      const st = lstatSync(join(voll, name));
      if (st.isDirectory()) {
        const weg = nurBekannte || istIgnoriert(pfad, true, regeln);
        if (!weg || bekannteOrdner.has(pfad)) geh(pfad, tiefe + 1, weg);
        continue;
      }
      if (!bekannt.has(pfad) && (nurBekannte || istIgnoriert(pfad, false, regeln))) continue;
      if (st.isSymbolicLink()) {
        nimm({ pfad, art: "verweis", daten: new Uint8Array(readlinkSync(join(voll, name), { encoding: "buffer" })) });
      } else if (st.isFile()) {
        if (st.size > g.bytes) throw new Grenze();
        const fd = openSync(join(voll, name), constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const mode = fstatSync(fd).mode;
          nimm({ pfad, art: mode & 0o100 ? "ausfuehrbar" : "datei", daten: new Uint8Array(readFileSync(fd)) });
        } finally {
          closeSync(fd);
        }
      }
    }
  };
  try {
    if (!lstatSync(ordner).isDirectory()) return { fall: "patch.ordner" };
    geh("", 0, false);
    return { dateien };
  } catch (e) {
    return { fall: e instanceof Grenze ? "patch.gross" : "patch.ordner" };
  }
}

