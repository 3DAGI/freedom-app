/**
 * Sandbox für fremden und eigenen Code (Schritt VKb = 11.5s, Vorbild Codex unter
 * Linux; Regeln aus `docs/REPO-AGENTEN-ENTWURF.md`, „Vorschlag zu W3: Regeln fürs
 * Ausführen“, und `docs/VIBECODEN-ENTWURF.md` VK4).
 *
 * Jeder Befehl – und der ganze Motor eines Code-Laufs (VKc3) – läuft nur in
 * bubblewrap (`bwrap`, ein Programm des Bildes, keine npm-Abhängigkeit):
 * - eigene Namensräume für Nutzer, Prozesse, Netz, IPC, Hostname und cgroup
 *   (`--unshare-all`), endet mit dem Knoten (`--die-with-parent`), eigene
 *   Sitzung, keine Fähigkeiten (`--cap-drop ALL`);
 * - nur lesbar: `/usr` und die Bibliotheken; aus `/etc` nur ein eigenes
 *   `passwd`, `group` und `hosts`, dazu nur lesbar `/etc/alternatives` und `/etc/ld.so.cache` – nicht das ganze `/etc`;
 * - schreibbar nur der Arbeitsordner (`/arbeit`), darin `.git` wieder nur lesbar
 *   (die Commits macht der Knoten, VKc2); `/tmp` als tmpfs mit Grenze;
 * - die Umgebung leer bis auf `PATH`, `HOME` und `LANG` – keine Variable des
 *   Knotens, sein Home und `~/.freedom` sind nicht sichtbar;
 * - ohne Netz (VK4: Pakete holt der Knoten); GPU nur auf Wunsch.
 * Ohne bubblewrap oder ohne Nutzer-Namensräume (Docker-Seccomp, AppArmor) gibt
 * es kein Ausführen – `pruefeSandbox()` sagt das, nie läuft etwas direkt auf
 * dem Rechner.
 */
import { spawn } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdtempSync, openSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import { CODE_GRENZEN } from "@freedomstack/protocol";
import { kuerzeAusgabe, type MotorStart } from "./code-motor.js";
import { seccompFilter } from "./seccomp.js";

/** Grenzen je Befehl (Vorgabe; der Betreiber kann sie senken). */
export const SANDBOX_GRENZEN = {
  /** Zeit je Befehl – danach endet die ganze Prozessgruppe. */
  befehlMs: 60_000,
  /** Größe des tmpfs unter `/tmp`. */
  tmpBytes: 512 * 1024 * 1024,
  /** Rechenzeit (s), größte Datei (KiB), offene Dateien – über `ulimit` in der Sandbox. */
  cpuSek: 120,
  dateiKiB: 512 * 1024,
  offeneDateien: 1024,
} as const;

export interface SandboxOrt {
  /** Arbeitsordner – als `/arbeit` schreibbar eingebunden. */
  arbeit: string;
  /** Ein eigenes Home (z. B. `~/.hermes` je Projekt, VKc3) – als `/home/agent` schreibbar; sonst ein tmpfs. */
  home?: string;
  /** GPU (NVIDIA, DRI) einbinden – nur auf Wunsch (VKb). */
  gpu?: boolean;
  /** Programm für bubblewrap (Test). */
  bwrap?: string;
}

/** `seccomp`: ob der Filter aus 11.5s2 mitläuft (nur x86_64 und arm64). */
export type SandboxPruefung = { ok: true; seccomp: boolean } | { ok: false; fall: "sandbox.fehlt" | "sandbox.namensraum" | "sandbox.seccomp" };

/** Feste Sätze für Log und `npm run pruefen` – nie Text von bubblewrap. */
export const SANDBOX_TEXT: Record<"sandbox.ok" | "sandbox.ok-ohne-seccomp" | "sandbox.fehlt" | "sandbox.namensraum" | "sandbox.seccomp", string> = {
  "sandbox.ok": "Sandbox geht (bubblewrap, ohne Netz, Wurzel nur lesbar, seccomp)",
  "sandbox.ok-ohne-seccomp": "Sandbox geht (bubblewrap, ohne Netz, Wurzel nur lesbar) – seccomp gibt es für diese Architektur nicht",
  "sandbox.fehlt": "Sandbox fehlt: bubblewrap ist nicht installiert (apt install bubblewrap) – ohne Sandbox führt der Knoten keinen Code aus",
  "sandbox.namensraum": "Sandbox geht nicht: bubblewrap darf keine Nutzer-Namensräume anlegen (Docker-Seccomp, AppArmor ab Ubuntu 24.04) – ohne Sandbox führt der Knoten keinen Code aus",
  "sandbox.seccomp": "Sandbox geht nicht: bubblewrap lädt den seccomp-Filter nicht – ohne Sandbox führt der Knoten keinen Code aus",
};

export function sandboxText(p: SandboxPruefung): string {
  return SANDBOX_TEXT[p.ok ? (p.seccomp ? "sandbox.ok" : "sandbox.ok-ohne-seccomp") : p.fall];
}

const PATH_INNEN = "/usr/local/bin:/usr/bin:/bin";

/** Die Wurzel nur lesbar: `/usr` und, wo es sie als eigene Ordner gibt, `/bin`, `/lib`, `/lib64`, `/sbin`. */
function wurzel(): string[] {
  const a = ["--ro-bind", "/usr", "/usr"];
  for (const d of ["bin", "lib", "lib64", "sbin"]) {
    if (!existsSync(`/${d}`)) continue;
    // Bei zusammengelegtem /usr sind es Verweise (`/bin` → `usr/bin`) – als Verweis anlegen, sonst nur lesbar einbinden
    a.push(...(lstatSync(`/${d}`).isSymbolicLink() ? ["--symlink", readlinkSync(`/${d}`), `/${d}`] : ["--ro-bind", `/${d}`, `/${d}`]));
  }
  return a;
}

/** Die Argumente für bubblewrap – ohne den Befehl. `etc` ist ein Ordner mit `passwd`, `group`, `hosts`. */
export function sandboxArgumente(o: SandboxOrt, etc: string): string[] {
  const a = [
    "--unshare-all", "--unshare-user", "--die-with-parent", "--new-session", "--cap-drop", "ALL",
    "--uid", "1000", "--gid", "1000", "--hostname", "sandbox",
    "--clearenv", "--setenv", "PATH", PATH_INNEN, "--setenv", "HOME", "/home/agent", "--setenv", "LANG", "C.UTF-8",
    ...wurzel(),
    "--ro-bind", join(etc, "passwd"), "/etc/passwd",
    "--ro-bind", join(etc, "group"), "/etc/group",
    "--ro-bind", join(etc, "hosts"), "/etc/hosts",
    // Verweise der Paketverwaltung (`/usr/bin/python3` → `/etc/alternatives/python3`) und der Cache des Laders –
    // ohne sie starten viele Programme nicht; beide tragen nichts Geheimes
    "--ro-bind-try", "/etc/alternatives", "/etc/alternatives", "--ro-bind-try", "/etc/ld.so.cache", "/etc/ld.so.cache",
    "--proc", "/proc", "--dev", "/dev",
    "--size", String(SANDBOX_GRENZEN.tmpBytes), "--tmpfs", "/tmp",
    ...(o.home ? ["--bind", o.home, "/home/agent"] : ["--tmpfs", "/home/agent"]),
    "--bind", o.arbeit, "/arbeit",
  ];
  // .git nur lesbar: ein Filter oder fsmonitor aus `.git/config` liefe sonst beim Commit im Knoten (VKc2)
  if (existsSync(join(o.arbeit, ".git"))) a.push("--ro-bind", join(o.arbeit, ".git"), "/arbeit/.git");
  if (o.gpu) {
    for (const g of ["/dev/nvidiactl", "/dev/nvidia-uvm", "/dev/nvidia0", "/dev/dri"]) if (existsSync(g)) a.push("--dev-bind", g, g);
  }
  // die Wurzel selbst (ein tmpfs von bubblewrap, darin /etc) nach dem Aufbau nur lesbar
  a.push("--remount-ro", "/", "--chdir", "/arbeit");
  return a;
}

/** Grenzen über `ulimit` (je Grenze ein Aufruf – dash nimmt nur eine), dann der Befehl – `sh` aus dem nur lesbaren `/usr`. */
function mitGrenzen(befehl: readonly string[]): string[] {
  const g = SANDBOX_GRENZEN;
  return ["/bin/sh", "-c", `ulimit -t ${g.cpuSek} && ulimit -f ${g.dateiKiB} && ulimit -n ${g.offeneDateien} && exec "$@"`, "sandbox", ...befehl];
}

/**
 * Ein eigenes `/etc` mit genau drei Dateien und – wo es ihn gibt – der seccomp-Filter
 * als offene Datei (`fd`, für `--seccomp 3`); nach dem Lauf geschlossen und gelöscht.
 */
function eigenesEtc(mitSeccomp = true): { ort: string; fd: number | null; weg: () => void } {
  const ort = mkdtempSync(join(tmpdir(), "freedom-sandbox-etc-"));
  writeFileSync(join(ort, "passwd"), "agent:x:1000:1000::/home/agent:/bin/sh\n");
  writeFileSync(join(ort, "group"), "agent:x:1000:\n");
  writeFileSync(join(ort, "hosts"), "127.0.0.1 localhost sandbox\n");
  const filter = mitSeccomp ? seccompFilter() : null;
  let fd: number | null = null;
  if (filter) {
    writeFileSync(join(ort, "seccomp.bpf"), filter, { mode: 0o600 });
    fd = openSync(join(ort, "seccomp.bpf"), "r");
  }
  let weg = false;
  return {
    ort, fd,
    weg: () => {
      if (weg) return;
      weg = true;
      if (fd !== null) closeSync(fd);
      rmSync(ort, { recursive: true, force: true });
    },
  };
}

/** Der Filter liegt im Kind auf fd 3 (`stdio[3]`), bubblewrap lädt ihn mit `--seccomp 3`. */
const mitSeccomp = (fd: number | null): string[] => (fd === null ? [] : ["--seccomp", "3"]);

export interface SandboxErgebnis {
  /** Exit-Code des Befehls; `null`, wenn er abgebrochen wurde. */
  code: number | null;
  ausgabe: string;
  gekuerzt: boolean;
  /** Über die Zeitgrenze – die ganze Prozessgruppe wurde beendet. */
  zeitUm: boolean;
}

/**
 * Einen Befehl in der Sandbox ausführen (für Aufträge mit eigenem Ablauf, 11.5c).
 * Ausgabe (stdout und stderr zusammen) gekürzt wie im Code-Lauf (`kuerzeAusgabe()`); nach `befehlMs` endet die ganze
 * Prozessgruppe. Wirft nur, wenn bubblewrap gar nicht startet.
 */
export function fuehreAus(befehl: readonly string[], o: SandboxOrt & { ohneSeccomp?: boolean }, zeitMs: number = SANDBOX_GRENZEN.befehlMs): Promise<SandboxErgebnis> {
  if (befehl.length === 0 || befehl.some((t) => typeof t !== "string" || t.includes("\0"))) throw new Error("Befehl leer oder ungültig");
  const etc = eigenesEtc(!o.ohneSeccomp);
  return new Promise((fertig, scheitern) => {
    const kind = spawn(o.bwrap ?? "bwrap", [...sandboxArgumente(o, etc.ort), ...mitSeccomp(etc.fd), "--", ...mitGrenzen(befehl)], {
      stdio: ["ignore", "pipe", "pipe", ...(etc.fd === null ? [] : [etc.fd])], detached: true, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    let text = "";
    const nimm = (b: Buffer) => { if (text.length < CODE_GRENZEN.ausgabe * 4) text += b.toString("utf8"); };
    kind.stdout!.on("data", nimm);
    kind.stderr!.on("data", nimm);
    let zeitUm = false;
    const uhr = setTimeout(() => {
      zeitUm = true;
      try { process.kill(-kind.pid!, "SIGKILL"); } catch { /* schon weg */ }
    }, zeitMs);
    kind.on("error", (e) => { clearTimeout(uhr); etc.weg(); scheitern(Object.assign(new Error("Sandbox startet nicht"), { name: "SandboxFehlt", cause: e })); });
    kind.on("close", (code) => {
      clearTimeout(uhr);
      etc.weg();
      fertig({ code: zeitUm ? null : code, ...kuerzeAusgabe(text), zeitUm });
    });
  });
}

/**
 * Geht die Sandbox hier? Startet `true` darin. Fehlt bubblewrap: `sandbox.fehlt`;
 * startet es, scheitert aber an den Namensräumen (Docker-Seccomp, AppArmor):
 * `sandbox.namensraum`; geht es nur ohne den Filter aus 11.5s2: `sandbox.seccomp`.
 */
export async function pruefeSandbox(bwrap = "bwrap"): Promise<SandboxPruefung> {
  const arbeit = mkdtempSync(join(tmpdir(), "freedom-sandbox-pruefung-"));
  try {
    const seccomp = seccompFilter() !== null;
    const r = await fuehreAus(["/bin/sh", "-c", "exit 0"], { arbeit, bwrap }, 10_000);
    if (r.code === 0) return { ok: true, seccomp };
    if (!seccomp) return { ok: false, fall: "sandbox.namensraum" };
    const ohne = await fuehreAus(["/bin/sh", "-c", "exit 0"], { arbeit, bwrap, ohneSeccomp: true }, 10_000);
    return { ok: false, fall: ohne.code === 0 ? "sandbox.seccomp" : "sandbox.namensraum" };
  } catch {
    return { ok: false, fall: "sandbox.fehlt" };
  } finally {
    rmSync(arbeit, { recursive: true, force: true });
  }
}

/**
 * Der Motor eines Code-Laufs (VKc2) in der Sandbox – die einzige `MotorStart`, die
 * `main.ts` bauen darf (VK4). Der Projektordner ist `/arbeit`, `.git` nur lesbar;
 * `home(ordner)` nennt ein eigenes Home außerhalb des Repos (VKc3: `~/.hermes` je Projekt).
 * stderr des Motors geht nirgends hin – er kann Fremdtext tragen.
 */
export function sandboxMotor(befehl: readonly string[], o: { home?: (ordner: string) => string; gpu?: boolean; bwrap?: string } = {}): MotorStart {
  if (befehl.length === 0 || befehl.some((t) => t === "")) throw new Error("Motor-Befehl leer");
  return (ordner) => {
    const etc = eigenesEtc();
    const ort: SandboxOrt = { arbeit: ordner, ...(o.home ? { home: o.home(ordner) } : {}), ...(o.gpu ? { gpu: true } : {}), ...(o.bwrap ? { bwrap: o.bwrap } : {}) };
    const kind = spawn(o.bwrap ?? "bwrap", [...sandboxArgumente(ort, etc.ort), ...mitSeccomp(etc.fd), "--", ...befehl], {
      stdio: ["pipe", "pipe", "ignore", ...(etc.fd === null ? [] : [etc.fd])], env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, windowsHide: true,
    });
    kind.on("error", () => { /* fehlt bubblewrap, endet der Strom – der Lauf endet mit „fehler“ */ });
    kind.on("close", () => etc.weg());
    return {
      strom: ndJsonStream(Writable.toWeb(kind.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(kind.stdout!) as ReadableStream<Uint8Array>),
      beende: () => { if (kind.exitCode === null && kind.signalCode === null) kind.kill("SIGTERM"); },
    };
  };
}
