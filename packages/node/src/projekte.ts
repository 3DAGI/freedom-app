/**
 * Projekte für das Vibecoden auf dem eigenen Knoten (A-31, VKc1, Entwurf
 * `docs/VIBECODEN-ENTWURF.md`, VK-W2 A): je Projekt ein Ordner unter
 * `~/.freedom/projekte` mit eigenem git. Anlegen und auflisten nur für den
 * Besitzer (5080, versiegelt, Nachweis – `dvm-provider.ts`), nur mit
 * `VIBECODEN=1`. Namen nur nach `istProjektName()`; git nur über `git()` –
 * ohne Shell, ohne Vorlagen, ohne Suche nach oben und mit festen Einstellungen,
 * die eine Konfiguration im Projekt nicht ändert: Ab VKc2 schreibt ein Agent im
 * Projekt, der Knoten traut `.git/config` nie. Ins Log nur Zahlen und Kennungen –
 * Projektnamen sind Inhalt.
 */
import { execFile } from "node:child_process";
import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { CODE_GRENZEN, istProjektName, type CodeProjekt } from "@freedomstack/protocol";

export const projekteOrdner = (home = process.env.HOME ?? "."): string => join(home, ".freedom", "projekte");

/**
 * Ablehnung mit Kennung – die App erkennt den Fall am Tag `fall`, nie am Text
 * (wie `AgentAbgelehnt`). Fehler des Dateisystems tragen den Pfad und damit den
 * Projektnamen – sie gehen nur als `code-ablage` hinaus und ins Log.
 */
export class CodeAbgelehnt extends Error {
  constructor(readonly fall: "code-aus" | "code-ohne-motor" | "code-belegt" | "code-zu-viele" | "code-git" | "code-ablage") {
    super(`Code: ${fall}`);
    this.name = "CodeAbgelehnt";
  }
}

/**
 * Feste Einstellungen für jeden Aufruf – `-c` geht jeder Datei vor. Keine
 * Hooks, kein fsmonitor (führt ein Programm aus), keine Signaturprüfung beim
 * Lesen (`gpg.program`), keine Signatur beim Commit.
 */
const GIT_FEST = [
  "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "log.showSignature=false",
  "-c", "commit.gpgSign=false", "-c", "core.pager=cat",
];

export class ProjektAblage {
  private readonly gitProgramm: string;

  constructor(readonly ordner: string, o: { git?: string } = {}) {
    this.gitProgramm = o.git ?? "git";
  }

  /** git ohne Shell, mit leerer Umgebung bis auf PATH; das Repository immer ausdrücklich (`--git-dir`). */
  private git(args: string[], projekt?: string): Promise<string> {
    const ort = projekt ? ["--git-dir", join(this.ordner, projekt, ".git"), "--work-tree", join(this.ordner, projekt)] : [];
    return new Promise((ok, fehler) => {
      execFile(this.gitProgramm, [...GIT_FEST, ...ort, ...args], {
        cwd: projekt ? join(this.ordner, projekt) : this.ordner,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: this.ordner, LC_ALL: "C",
          GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_CEILING_DIRECTORIES: this.ordner,
        },
        timeout: 10_000, maxBuffer: 1 << 20, windowsHide: true,
      }, (e, stdout) => (e ? fehler(e) : ok(String(stdout))));
    });
  }

  /** Beim Start: git vorhanden, Ordner da (0700). Ohne git keine Rolle „code“. */
  async pruefe(): Promise<boolean> {
    try {
      await mkdir(this.ordner, { recursive: true, mode: 0o700 });
      return /^git version /.test(await this.git(["--version"]));
    } catch {
      return false;
    }
  }

  /** Namen der Projekte – nur gültige Namen, nur echte Ordner (Verweise zählen nicht). */
  private async namen(): Promise<{ name: string; mtime: number }[]> {
    let eintraege: string[];
    try {
      eintraege = await readdir(this.ordner);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new CodeAbgelehnt("code-ablage");
    }
    const namen: { name: string; mtime: number }[] = [];
    for (const name of eintraege.sort()) {
      if (!istProjektName(name)) continue;
      const st = await lstat(join(this.ordner, name)).catch(() => null);
      if (st?.isDirectory()) namen.push({ name, mtime: Math.floor(st.mtimeMs / 1000) });
    }
    return namen;
  }

  /** Alle Projekte, zuletzt geänderte zuerst, höchstens `CODE_GRENZEN.projekte`. Schritte = Commits. */
  async liste(): Promise<CodeProjekt[]> {
    const projekte: CodeProjekt[] = [];
    for (const { name, mtime } of (await this.namen()).slice(0, CODE_GRENZEN.projekte)) {
      let schritte = 0, geaendert = mtime;
      try {
        const n = Number((await this.git(["rev-list", "--count", "--all"], name)).trim());
        const zeit = (await this.git(["log", "-1", "--all", "--format=%ct"], name)).trim();
        if (Number.isSafeInteger(n) && n >= 0) schritte = n;
        if (/^\d{1,12}$/.test(zeit)) geaendert = Number(zeit);
      } catch { /* kein Repository (noch nicht angelegt) – Ordnerzeit, null Schritte */ }
      projekte.push({ name, schritte, geaendert });
    }
    return projekte.sort((a, b) => b.geaendert - a.geaendert || a.name.localeCompare(b.name));
  }

  /** Ordner eines Projekts – für den Motor (VKc2). */
  ort(name: string): string {
    if (!istProjektName(name)) throw new Error("Projektname ungültig");
    return join(this.ordner, name);
  }

  /**
   * Schritt sichern (VKc2): ein Commit, wenn sich etwas geändert hat. Läuft im
   * Knoten, nicht in der Sandbox – deshalb bindet die Sandbox `.git` nur lesbar ein
   * (ein Filter in `.git/config` liefe sonst hier), und die Nachricht trägt nur die Nummer.
   */
  async sichere(name: string, nr: number): Promise<boolean> {
    if (!istProjektName(name) || !Number.isSafeInteger(nr)) throw new Error("Schritt ungültig");
    if ((await this.git(["status", "--porcelain"], name)).trim() === "") return false;
    await this.git(["add", "-A"], name);
    await this.git(["-c", "user.name=Freedom-Agent", "-c", "user.email=agent@knoten.invalid", "commit", "-q", "--no-verify", "-m", `Schritt ${nr}`], name);
    return true;
  }

  /** Projekt anlegen: Ordner (0700) und git mit Zweig `main`. Vorhandene bleiben, wie sie sind (ohne git bekommen sie eines). */
  async neu(name: string): Promise<void> {
    if (!istProjektName(name)) throw new Error("Projektname ungültig");
    const ort = join(this.ordner, name);
    const st = await lstat(ort).catch(() => null);
    if (st && !st.isDirectory()) throw new Error("Projektname ungültig");
    if (!st && (await this.namen()).length >= CODE_GRENZEN.projekte) throw new CodeAbgelehnt("code-zu-viele");
    let neuerOrdner = false;
    try {
      await mkdir(this.ordner, { recursive: true, mode: 0o700 });
      await mkdir(ort, { mode: 0o700 });
      neuerOrdner = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw new CodeAbgelehnt("code-ablage");
    }
    if (await lstat(join(ort, ".git")).then(() => true, () => false)) return;
    try {
      await this.git(["init", "-q", "--template=", "-b", "main", ort]);
    } catch {
      if (neuerOrdner) await rm(ort, { recursive: true, force: true });
      throw new CodeAbgelehnt("code-git");
    }
  }
}

/** Aus der Umgebung: `VIBECODEN=1` an, leer oder `0` aus (`null`), anderes ungültig → kein Start. */
export function projekteAusUmgebung(env: { VIBECODEN?: string }, ordner = projekteOrdner()): { ablage?: ProjektAblage; grund?: string } | null {
  const wert = (env.VIBECODEN ?? "").trim();
  if (wert === "" || wert === "0") return null;
  if (wert !== "1") return { grund: "VIBECODEN ist weder 0 noch 1" };
  return { ablage: new ProjektAblage(ordner) };
}
