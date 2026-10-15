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
 *   `passwd`, `group` und `hosts` – nicht das ganze `/etc`;
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
import { existsSync, lstatSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import { CODE_GRENZEN } from "@freedomstack/protocol";
import { kuerzeAusgabe, type MotorStart } from "./code-motor.js";

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

export type SandboxPruefung = { ok: true } | { ok: false; fall: "sandbox.fehlt" | "sandbox.namensraum" };

/** Feste Sätze für Log und `npm run pruefen` – nie Text von bubblewrap. */
export const SANDBOX_TEXT: Record<"sandbox.ok" | "sandbox.fehlt" | "sandbox.namensraum", string> = {
  "sandbox.ok": "Sandbox geht (bubblewrap, ohne Netz, Wurzel nur lesbar)",
  "sandbox.fehlt": "Sandbox fehlt: bubblewrap ist nicht installiert (apt install bubblewrap) – ohne Sandbox führt der Knoten keinen Code aus",
  "sandbox.namensraum": "Sandbox geht nicht: bubblewrap darf keine Nutzer-Namensräume anlegen (Docker-Seccomp, AppArmor ab Ubuntu 24.04) – ohne Sandbox führt der Knoten keinen Code aus",
};

export function sandboxText(p: SandboxPruefung): string {
  return SANDBOX_TEXT[p.ok ? "sandbox.ok" : p.fall];
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

/** Ein eigenes `/etc` mit genau drei Dateien – nach dem Lauf gelöscht. */
function eigenesEtc(): { ort: string; weg: () => void } {
  const ort = mkdtempSync(join(tmpdir(), "freedom-sandbox-etc-"));
  writeFileSync(join(ort, "passwd"), "agent:x:1000:1000::/home/agent:/bin/sh\n");
  writeFileSync(join(ort, "group"), "agent:x:1000:\n");
  writeFileSync(join(ort, "hosts"), "127.0.0.1 localhost sandbox\n");
  return { ort, weg: () => rmSync(ort, { recursive: true, force: true }) };
}

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
export function fuehreAus(befehl: readonly string[], o: SandboxOrt, zeitMs: number = SANDBOX_GRENZEN.befehlMs): Promise<SandboxErgebnis> {
  if (befehl.length === 0 || befehl.some((t) => typeof t !== "string" || t.includes("\0"))) throw new Error("Befehl leer oder ungültig");
  const etc = eigenesEtc();
  return new Promise((fertig, scheitern) => {
    const kind = spawn(o.bwrap ?? "bwrap", [...sandboxArgumente(o, etc.ort), "--", ...mitGrenzen(befehl)], {
      stdio: ["ignore", "pipe", "pipe"], detached: true, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
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
 * `sandbox.namensraum`.
 */
export async function pruefeSandbox(bwrap = "bwrap"): Promise<SandboxPruefung> {
  const arbeit = mkdtempSync(join(tmpdir(), "freedom-sandbox-pruefung-"));
  try {
    const r = await fuehreAus(["/bin/sh", "-c", "exit 0"], { arbeit, bwrap }, 10_000);
    return r.code === 0 ? { ok: true } : { ok: false, fall: "sandbox.namensraum" };
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
    const kind = spawn(o.bwrap ?? "bwrap", [...sandboxArgumente(ort, etc.ort), "--", ...befehl], {
      stdio: ["pipe", "pipe", "ignore"], env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, windowsHide: true,
    });
    kind.on("error", () => { /* fehlt bubblewrap, endet der Strom – der Lauf endet mit „fehler“ */ });
    kind.on("close", () => etc.weg());
    return {
      strom: ndJsonStream(Writable.toWeb(kind.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(kind.stdout!) as ReadableStream<Uint8Array>),
      beende: () => { if (kind.exitCode === null && kind.signalCode === null) kind.kill("SIGTERM"); },
    };
  };
}
