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
import { closeSync, constants, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, rmSync, symlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type Arbeitskopie, istRepoPfad } from "@freedomstack/protocol";

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
