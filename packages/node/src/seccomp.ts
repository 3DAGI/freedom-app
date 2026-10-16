/**
 * seccomp für die Sandbox (Schritt 11.5s2, Vorbild Codex unter Linux; Regeln aus
 * `docs/REPO-AGENTEN-ENTWURF.md`, „Vorschlag zu W3“): ein cBPF-Filter, den
 * bubblewrap mit `--seccomp` lädt – ohne libseccomp, ohne Abhängigkeit.
 *
 * Die Sandbox hat schon kein Netz und keine Fähigkeiten (VKb). Der Filter nimmt
 * dazu, was den Kern angreifbar macht und kein Werkzeug braucht: `io_uring`,
 * Schlüsselbund, eBPF, Leistungszähler, `userfaultfd`, Module und `kexec`,
 * `open_by_handle_at`, Einhängen, und neue Namensräume (`unshare`, `setns`,
 * `clone` mit `CLONE_NEW*`). `clone3` antwortet mit `ENOSYS` – die C-Bibliothek
 * nimmt dann `clone`, dessen Flags der Filter sieht. Alles andere geht.
 * Nur x86_64 und arm64; auf anderen Rechnern gibt es keinen Filter (`null`).
 */

/** `AUDIT_ARCH_*` aus `<linux/audit.h>`. */
const ARCH = { x64: 0xc000003e, arm64: 0xc00000b7 } as const;
export type SeccompArch = keyof typeof ARCH;

/** Gesperrte Aufrufe je Architektur (Nummern aus `unistd_64.h` bzw. `asm-generic/unistd.h`). */
const GESPERRT: Record<SeccompArch, Record<string, number>> = {
  x64: {
    io_uring_setup: 425, io_uring_enter: 426, io_uring_register: 427, keyctl: 250, add_key: 248, request_key: 249, bpf: 321,
    perf_event_open: 298, userfaultfd: 323, kexec_load: 246, kexec_file_load: 320, open_by_handle_at: 304, init_module: 175,
    finit_module: 313, delete_module: 176, unshare: 272, setns: 308, mount: 165, umount2: 166, pivot_root: 155, swapon: 167,
    swapoff: 168, reboot: 169, fsopen: 430, fsmount: 432, move_mount: 429, open_tree: 428,
  },
  arm64: {
    io_uring_setup: 425, io_uring_enter: 426, io_uring_register: 427, keyctl: 219, add_key: 217, request_key: 218, bpf: 280,
    perf_event_open: 241, userfaultfd: 282, kexec_load: 104, kexec_file_load: 294, open_by_handle_at: 265, init_module: 105,
    finit_module: 273, delete_module: 106, unshare: 97, setns: 268, mount: 40, umount2: 39, pivot_root: 41, swapon: 224,
    swapoff: 225, reboot: 142, fsopen: 430, fsmount: 432, move_mount: 429, open_tree: 428,
  },
};
const CLONE = { x64: 56, arm64: 220 } as const;
const CLONE3 = 435;
/** `CLONE_NEWNS | NEWCGROUP | NEWUTS | NEWIPC | NEWUSER | NEWPID | NEWNET`. */
const CLONE_NEU = 0x00020000 | 0x02000000 | 0x04000000 | 0x08000000 | 0x10000000 | 0x20000000 | 0x40000000;

const RET_ALLOW = 0x7fff0000, RET_KILL = 0x80000000, RET_ERRNO = 0x00050000, EPERM = 1, ENOSYS = 38;
// BPF-Befehle (`<linux/filter.h>`)
const LD_W_ABS = 0x20, JEQ_K = 0x15, JSET_K = 0x45, RET_K = 0x06;
/** Offsets in `struct seccomp_data`: nr, arch, args[0] (untere 32 Bit, little-endian). */
const OFF_NR = 0, OFF_ARCH = 4, OFF_ARG0 = 16;

type Befehl = { code: number; k: number; wahr?: string; falsch?: string } | { marke: string };

/** Die Befehle als 8-Byte-Strukturen (`struct sock_filter`), Sprungziele aus Marken. */
function uebersetze(prog: Befehl[]): Uint8Array {
  const befehle = prog.filter((b): b is Exclude<Befehl, { marke: string }> => !("marke" in b));
  const marken = new Map<string, number>();
  let i = 0;
  for (const b of prog) {
    if ("marke" in b) marken.set(b.marke, i);
    else i++;
  }
  const aus = new Uint8Array(befehle.length * 8);
  const dv = new DataView(aus.buffer);
  befehle.forEach((b, n) => {
    const sprung = (m?: string) => {
      if (m === undefined) return 0;
      const weite = marken.get(m)! - n - 1;
      if (!(weite >= 0 && weite <= 255)) throw new Error("Sprung zu weit");
      return weite;
    };
    dv.setUint16(n * 8, b.code, true);
    dv.setUint8(n * 8 + 2, sprung(b.wahr));
    dv.setUint8(n * 8 + 3, sprung(b.falsch));
    dv.setUint32(n * 8 + 4, b.k >>> 0, true);
  });
  return aus;
}

/** Der Filter für diese Architektur – `null`, wo es keinen gibt. */
export function seccompFilter(arch: string = process.arch): Uint8Array | null {
  if (!(arch in ARCH)) return null;
  const a = arch as SeccompArch;
  const prog: Befehl[] = [
    { code: LD_W_ABS, k: OFF_ARCH },
    { code: JEQ_K, k: ARCH[a], wahr: "arch", falsch: "toeten" },
    { marke: "arch" },
    { code: LD_W_ABS, k: OFF_NR },
    // x32-Aufrufe (Bit 30) gibt es auf x86_64 nebenher – nie
    ...(a === "x64" ? [{ code: JSET_K, k: 0x40000000, wahr: "verboten" } as Befehl] : []),
    ...Object.values(GESPERRT[a]).map((nr): Befehl => ({ code: JEQ_K, k: nr, wahr: "verboten" })),
    { code: JEQ_K, k: CLONE3, wahr: "fehlt" },
    { code: JEQ_K, k: CLONE[a], wahr: "clone", falsch: "erlaubt" },
    { marke: "clone" },
    { code: LD_W_ABS, k: OFF_ARG0 },
    { code: JSET_K, k: CLONE_NEU, wahr: "verboten", falsch: "erlaubt" },
    { marke: "erlaubt" },
    { code: RET_K, k: RET_ALLOW },
    { marke: "verboten" },
    { code: RET_K, k: RET_ERRNO | EPERM },
    { marke: "fehlt" },
    { code: RET_K, k: RET_ERRNO | ENOSYS },
    { marke: "toeten" },
    { code: RET_K, k: RET_KILL },
  ];
  return uebersetze(prog);
}
