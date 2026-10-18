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
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { CODE_GRENZEN, istCommit, istProjektName, type CodeCommit, type CodeProjekt } from "@freedomstack/protocol";

export const projekteOrdner = (home = process.env.HOME ?? "."): string => join(home, ".freedom", "projekte");

/**
 * Ablehnung mit Kennung – die App erkennt den Fall am Tag `fall`, nie am Text
 * (wie `AgentAbgelehnt`). Fehler des Dateisystems tragen den Pfad und damit den
 * Projektnamen – sie gehen nur als `code-ablage` hinaus und ins Log.
 */
export class CodeAbgelehnt extends Error {
  constructor(readonly fall: "code-aus" | "code-ohne-motor" | "code-belegt" | "code-zu-viele" | "code-git" | "code-ablage" | "code-leer" | "code-zu-gross" | "code-commit" | "code-vorschau-aus") {
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

  /**
   * git ohne Shell, mit leerer Umgebung bis auf PATH; das Repository immer ausdrücklich (`--git-dir`). Mit `teilweise`
   * liefert ein Lauf über `maxBuffer` den Anfang statt eines Fehlers (Diff, VKe2).
   */
  private git(args: string[], projekt?: string, timeout = 10_000, o: { maxBuffer?: number; teilweise?: boolean } = {}): Promise<string> {
    const ort = projekt ? ["--git-dir", join(this.ordner, projekt, ".git"), "--work-tree", join(this.ordner, projekt)] : [];
    return new Promise((ok, fehler) => {
      execFile(this.gitProgramm, [...GIT_FEST, ...ort, ...args], {
        cwd: projekt ? join(this.ordner, projekt) : this.ordner,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: this.ordner, LC_ALL: "C",
          GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_CEILING_DIRECTORIES: this.ordner,
        },
        timeout, maxBuffer: o.maxBuffer ?? 1 << 20, windowsHide: true,
      }, (e, stdout) => {
        if (e && o.teilweise && (e as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return ok(String(stdout));
        return e ? fehler(e) : ok(String(stdout));
      });
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

  /**
   * Das Projekt als git-Bundle (VKl), alle Zweige: erst in eine Datei neben den Projekten (Name mit Punkt –
   * nie ein Projekt), dann gelesen und gelöscht. Ohne Commit `code-leer`, über `CODE_GRENZEN.bundle` `code-zu-gross`.
   */
  async bundle(name: string): Promise<Uint8Array> {
    if (!istProjektName(name)) throw new Error("Projektname ungültig");
    const datei = join(this.ordner, `.bundle-${randomBytes(8).toString("hex")}`);
    try {
      if (!(await this.git(["rev-list", "-n", "1", "--all"], name).catch(() => "")).trim()) throw new CodeAbgelehnt("code-leer");
      await this.git(["bundle", "create", datei, "--all"], name, 60_000).catch(() => { throw new CodeAbgelehnt("code-git"); });
      if ((await stat(datei)).size > CODE_GRENZEN.bundle) throw new CodeAbgelehnt("code-zu-gross");
      return new Uint8Array(await readFile(datei));
    } finally {
      await rm(datei, { force: true });
    }
  }

  /** Ein Commit dieses Projekts, der zu `HEAD` führt – sonst `code-commit` (fremde Kennung, Zweig daneben, kein Commit). */
  private async eigenerCommit(name: string, commit: string): Promise<void> {
    if (!istProjektName(name) || !istCommit(commit)) throw new Error("Commit ungültig");
    const art = (await this.git(["cat-file", "-t", commit], name).catch(() => "")).trim();
    if (art !== "commit") throw new CodeAbgelehnt("code-commit");
    await this.git(["merge-base", "--is-ancestor", commit, "HEAD"], name).catch(() => { throw new CodeAbgelehnt("code-commit"); });
  }

  /** Verlauf (VKe2): die letzten `CODE_GRENZEN.commits` Commits von `HEAD`, neueste zuerst, je mit Zahl der geänderten Dateien. */
  async verlauf(name: string): Promise<CodeCommit[]> {
    if (!istProjektName(name)) throw new Error("Projektname ungültig");
    if (!(await this.git(["rev-list", "-n", "1", "--all"], name).catch(() => "")).trim()) return [];
    const roh = await this.git(["log", "-n", String(CODE_GRENZEN.commits), "--no-renames", "--name-only", "--format=%x1e%H%x1f%ct%x1f%s", "HEAD"], name)
      .catch(() => { throw new CodeAbgelehnt("code-git"); });
    const commits: CodeCommit[] = [];
    for (const block of roh.split("\x1e").slice(1)) {
      const [kopf = "", ...dateien] = block.split("\n");
      const [id = "", zeit = "", nachricht = ""] = kopf.split("\x1f");
      if (!istCommit(id) || !/^\d{1,12}$/.test(zeit)) continue;
      commits.push({ id, zeit: Number(zeit), nachricht: [...nachricht].slice(0, CODE_GRENZEN.nachricht).join(""), dateien: dateien.filter((d) => d !== "").length });
    }
    return commits;
  }

  /**
   * Diff eines Commits (VKe2) als Patch wie `git format-patch` – den liest die App wie jeden Patch (`leseDiff()`). Ohne
   * Diff-Programme und Textumwandlung aus dem Projekt (`--no-ext-diff`, `--no-textconv`), auf `CODE_GRENZEN.diff`
   * (JSON-Länge) gekürzt.
   */
  async diff(name: string, commit: string): Promise<{ text: string; gekuerzt: boolean }> {
    await this.eigenerCommit(name, commit);
    const roh = await this.git(["format-patch", "-1", "--stdout", "--no-signature", "--no-color", "--no-ext-diff", "--no-textconv", commit], name, 20_000,
      { maxBuffer: 4 << 20, teilweise: true }).catch(() => { throw new CodeAbgelehnt("code-git"); });
    let text = roh, gekuerzt = false;
    while (JSON.stringify(text).length > CODE_GRENZEN.diff) {
      text = text.slice(0, Math.floor(text.length * 0.9));
      gekuerzt = true;
    }
    return { text, gekuerzt: gekuerzt || roh.length >= 4 << 20 };
  }

  /**
   * Zurück auf einen Commit (VKe2): dessen Baum als neuer Commit „Zurück auf <kurz>“ – nichts geht verloren, auch das
   * Zurück lässt sich zurücknehmen. Nur Commits, die zu `HEAD` führen. Zurück der neue Commit, leer, wenn sich nichts änderte.
   */
  async zurueck(name: string, commit: string): Promise<string> {
    await this.eigenerCommit(name, commit);
    try {
      await this.git(["read-tree", "-u", "--reset", commit], name, 60_000);
      if ((await this.git(["diff", "--cached", "--quiet", "HEAD"], name).then(() => true, () => false))) return "";
      await this.git(["-c", "user.name=Freedom-Agent", "-c", "user.email=agent@knoten.invalid", "commit", "-q", "--no-verify", "-m", `Zurück auf ${commit.slice(0, 7)}`], name);
      return (await this.git(["rev-parse", "HEAD"], name)).trim();
    } catch {
      throw new CodeAbgelehnt("code-git");
    }
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
