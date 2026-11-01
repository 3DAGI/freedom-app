/**
 * Speicher und Prozesse aller Programme eines Befehls zusammen (11.5s4b) – über cgroups v2, wo der Knoten einen eigenen
 * Teilbaum hat: im Dienst des Installers über `Delegate=memory pids`. Ohne (unter Docker, mit cgroups v1, als Dienst ohne
 * `Delegate=`) bleibt es bei den Grenzen je Prozess aus 11.5s3 und 11.5s4a (`ulimit` in der Sandbox).
 *
 * cgroups v2 schaltet Controller für Kinder nur ein, wenn die Gruppe selbst keine Prozesse hält: Der Knoten zieht beim
 * Start mit allem, was in seiner Gruppe läuft, in `<eigene>/knoten` und schaltet `memory` und `pids` für die Kinder ein. Je
 * Befehl entsteht `<eigene>/befehl-<zufall>` mit `memory.max`, `memory.swap.max` und `pids.max`; der Befehl tritt selbst
 * ein, bevor er bubblewrap startet (`inCgroup()`: `/bin/sh` schreibt `$$` nach `cgroup.procs`, dann `exec`) – so entsteht
 * kein Prozess außerhalb. Danach `cgroup.kill` und `rmdir`. `pids.max` gilt auch für root – anders als `RLIMIT_NPROC`.
 */
import { randomBytes } from "node:crypto";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Grenzen je Befehl zusammen: Speicher (ohne Swap) und Prozesse samt Threads. */
export interface CgroupGrenzen {
  speicherBytes: number;
  prozesse: number;
}

/** Zugriff auf das Dateisystem der cgroups – im Test eine Attrappe. */
export interface CgroupDateien {
  lies(pfad: string): string;
  schreibe(pfad: string, text: string): void;
  ordner(pfad: string): void;
  weg(pfad: string): void;
  gibt(pfad: string): boolean;
  schreibbar(pfad: string): boolean;
}

const ECHT: CgroupDateien = {
  lies: (p) => readFileSync(p, "utf8"),
  schreibe: (p, t) => writeFileSync(p, t),
  ordner: (p) => mkdirSync(p),
  weg: (p) => rmdirSync(p),
  gibt: (p) => existsSync(p),
  schreibbar: (p) => { try { accessSync(p, constants.W_OK); return true; } catch { return false; } },
};

/** Die eigene Gruppe aus `/proc/self/cgroup` – nur reines cgroups v2 (eine Zeile `0::`), nie die Wurzel. */
export function eigeneCgroup(proc: string): string | null {
  const zeilen = proc.split("\n").filter((z) => z !== "");
  const pfad = zeilen.length === 1 ? /^0::(\/.*)$/.exec(zeilen[0]!)?.[1] : undefined;
  if (!pfad || pfad === "/" || pfad.split("/").some((t) => t === "." || t === "..")) return null;
  // nach einem Neustart im selben Prozess (oder wenn ein Elternteil schon umgezogen ist) zählt die Gruppe darüber
  return basename(pfad) === "knoten" ? dirname(pfad) : pfad;
}

/** Gruppen je Befehl unter dem eigenen Teilbaum. */
export class CgroupVerwalter {
  constructor(readonly basis: string, readonly grenzen: CgroupGrenzen, private readonly d: CgroupDateien = ECHT) {}

  /** Eine Gruppe für einen Befehl: Er tritt über `procs` selbst ein (`inCgroup()`); `weg()` beendet den Rest und räumt auf. */
  neu(): { procs: string; weg: () => void } {
    const ordner = join(this.basis, `befehl-${randomBytes(8).toString("hex")}`);
    this.d.ordner(ordner);
    try {
      this.d.schreibe(join(ordner, "memory.max"), String(this.grenzen.speicherBytes));
      this.d.schreibe(join(ordner, "pids.max"), String(this.grenzen.prozesse));
      // ohne Swap-Abrechnung gibt es die Datei nicht – dann zählt ohnehin nur der Arbeitsspeicher
      if (this.d.gibt(join(ordner, "memory.swap.max"))) this.d.schreibe(join(ordner, "memory.swap.max"), "0");
    } catch (e) {
      this.entferne(ordner);
      throw e;
    }
    return { procs: join(ordner, "cgroup.procs"), weg: () => this.entferne(ordner) };
  }

  private entferne(ordner: string): void {
    try {
      if (this.d.gibt(join(ordner, "cgroup.kill"))) this.d.schreibe(join(ordner, "cgroup.kill"), "1");
    } catch { /* schon leer */ }
    // rmdir geht erst, wenn kein Prozess mehr darin ist – nach dem Beenden kurz nachsehen
    const versuch = (rest: number): void => {
      try {
        this.d.weg(ordner);
      } catch {
        if (rest > 0) setTimeout(() => versuch(rest - 1), 100).unref();
      }
    };
    versuch(50);
  }
}

/**
 * Den eigenen Teilbaum einrichten – einmal beim Start, bevor der Knoten Kinder startet. `null`, wo es keinen gibt; dann
 * ändert sich nichts. Mit `nurPruefen` (für `npm run pruefen`) nur nachsehen, nichts umziehen.
 */
export function richteCgroupsEin(grenzen: CgroupGrenzen, o: { wurzel?: string; proc?: string; dateien?: CgroupDateien; nurPruefen?: boolean } = {}): CgroupVerwalter | null {
  const d = o.dateien ?? ECHT;
  try {
    const eigene = eigeneCgroup(o.proc ?? d.lies("/proc/self/cgroup"));
    if (!eigene) return null;
    const basis = join(o.wurzel ?? "/sys/fs/cgroup", eigene);
    const controller = d.lies(join(basis, "cgroup.controllers")).split(/\s+/);
    if (!controller.includes("memory") || !controller.includes("pids")) return null;
    if (!d.schreibbar(join(basis, "cgroup.subtree_control")) || !d.schreibbar(join(basis, "cgroup.procs"))) return null;
    if (o.nurPruefen) return new CgroupVerwalter(basis, grenzen, d);
    const knoten = join(basis, "knoten");
    if (!d.gibt(knoten)) d.ordner(knoten);
    // alles aus der eigenen Gruppe in das Blatt – je Schreiben ein Prozess; wer gerade endet, fehlt (ESRCH)
    for (const pid of d.lies(join(basis, "cgroup.procs")).split("\n").filter((z) => /^\d+$/.test(z))) {
      try { d.schreibe(join(knoten, "cgroup.procs"), pid); } catch { /* schon beendet */ }
    }
    d.schreibe(join(basis, "cgroup.subtree_control"), "+memory +pids");
    return new CgroupVerwalter(basis, grenzen, d);
  } catch {
    return null;
  }
}

/** Den Befehl in seiner Gruppe starten: Die Shell tritt ein und wird dann zum Befehl – scheitert das Eintreten, läuft nichts. */
export function inCgroup(procs: string, befehl: readonly string[]): string[] {
  return ["/bin/sh", "-c", 'echo $$ > "$0" && exec "$@"', procs, ...befehl];
}

/** Feste Sätze fürs Log. */
export const CGROUP_TEXT = {
  an: "Speicher und Prozesse je Befehl zusammen begrenzt (cgroups v2, eigener Teilbaum)",
  aus: "Speicher und Prozesse nur je Prozess begrenzt – ohne eigenen cgroup-Teilbaum (Docker, cgroups v1 oder Dienst ohne Delegate=memory pids)",
} as const;
