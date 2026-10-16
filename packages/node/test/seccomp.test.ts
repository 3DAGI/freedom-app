/**
 * seccomp in der Sandbox (11.5s2): der cBPF-Filter ohne Abhängigkeit – Aufbau je
 * Architektur, und mit echtem bubblewrap: gesperrte Aufrufe ergeben EPERM, neue
 * Namensräume gehen nicht, gewöhnliche Programme (Shell, Prozesse, Threads) laufen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fuehreAus, pruefeSandbox } from "../src/sandbox.js";
import { seccompFilter } from "../src/seccomp.js";

/** Die Befehle als [code, jt, jf, k]. */
const befehle = (f: Uint8Array) => {
  const dv = new DataView(f.buffer, f.byteOffset, f.byteLength);
  return Array.from({ length: f.length / 8 }, (_, i) => [dv.getUint16(i * 8, true), dv.getUint8(i * 8 + 2), dv.getUint8(i * 8 + 3), dv.getUint32(i * 8 + 4, true)]);
};

test("11.5s2: Filter je Architektur – erst die Architektur, sonst töten; am Ende erlauben; Sprünge im Programm", () => {
  assert.equal(seccompFilter("ia32"), null);
  assert.equal(seccompFilter("riscv64"), null);
  for (const [arch, audit] of [["x64", 0xc000003e], ["arm64", 0xc00000b7]] as const) {
    const b = befehle(seccompFilter(arch)!);
    assert.ok(b.length > 10 && b.length < 4096);
    assert.deepEqual(b[0], [0x20, 0, 0, 4], "lädt die Architektur");
    assert.deepEqual(b[1].slice(0, 1).concat(b[1][3]!), [0x15, audit]);
    assert.deepEqual(b.at(-1), [0x06, 0, 0, 0x80000000], "fremde Architektur: töten");
    assert.ok(b.some((x) => x[0] === 0x06 && x[3] === 0x7fff0000), "erlauben");
    assert.ok(b.some((x) => x[0] === 0x06 && x[3] === 0x00050001), "EPERM");
    assert.ok(b.some((x) => x[0] === 0x06 && x[3] === 0x00050026), "ENOSYS für clone3");
    // Sprünge (Klasse BPF_JMP) landen im Programm; RET springt nicht
    b.forEach((x, i) => { if ((x[0]! & 0x07) === 0x05) assert.ok(i + 1 + x[1]! < b.length && i + 1 + x[2]! < b.length, `Sprung aus ${i}`); });
    // io_uring_setup (425) ist auf beiden gesperrt
    assert.ok(b.some((x) => x[0] === 0x15 && x[3] === 425));
  }
  // x32-Aufrufe nur auf x86_64
  assert.ok(befehle(seccompFilter("x64")!).some((x) => x[0] === 0x45 && x[3] === 0x40000000));
  assert.ok(!befehle(seccompFilter("arm64")!).some((x) => x[0] === 0x45 && x[3] === 0x40000000));
});

const sandbox = await pruefeSandbox();
const python = existsSync("/usr/bin/python3");
const ohne = !sandbox.ok ? `Sandbox geht hier nicht (${sandbox.fall})` : !sandbox.seccomp ? "kein seccomp für diese Architektur" : !python ? "python3 fehlt" : false;

test("11.5s2 (bubblewrap): gesperrte Aufrufe ergeben EPERM, gewöhnliche Programme laufen weiter", { skip: ohne }, async () => {
  const nr = process.arch === "x64" ? { keyctl: 250, bpf: 321, perf: 298, userfaultfd: 323 } : { keyctl: 219, bpf: 280, perf: 241, userfaultfd: 282 };
  const skript = [
    "import ctypes, os, threading, subprocess",
    "libc = ctypes.CDLL(None, use_errno=True)",
    "def ruf(n, *a):",
    "    r = libc.syscall(n, *a); return (r, ctypes.get_errno())",
    `print('io_uring', ruf(425, 1, 0))`,
    `print('keyctl', ruf(${nr.keyctl}, 0, 0))`,
    `print('bpf', ruf(${nr.bpf}, 0, 0, 0))`,
    `print('perf', ruf(${nr.perf}, 0, 0, 0, 0, 0))`,
    `print('userfaultfd', ruf(${nr.userfaultfd}, 0))`,
    "t = threading.Thread(target=lambda: None); t.start(); t.join(); print('thread ok')",
    "print('kind', subprocess.run(['/bin/sh', '-c', 'echo aus kind'], capture_output=True, text=True).stdout.strip())",
  ].join("\n");
  const r = await fuehreAus(["/usr/bin/python3", "-c", skript], { arbeit: mkdtempSync(join(tmpdir(), "seccomp-")) });
  assert.equal(r.code, 0, r.ausgabe);
  for (const name of ["io_uring", "keyctl", "bpf", "perf", "userfaultfd"]) assert.match(r.ausgabe, new RegExp(`^${name} \\(-1, 1\\)$`, "m"), `${name}: ${r.ausgabe}`);
  assert.match(r.ausgabe, /^thread ok$/m);
  assert.match(r.ausgabe, /^kind aus kind$/m);
});

test("11.5s2 (bubblewrap): keine neuen Namensräume in der Sandbox – unshare und clone mit CLONE_NEWUSER scheitern", { skip: ohne }, async () => {
  const r = await fuehreAus(["/bin/sh", "-c", "unshare -U true && echo unshare-ging || echo unshare-gesperrt"], { arbeit: mkdtempSync(join(tmpdir(), "seccomp-")) });
  assert.match(r.ausgabe, /unshare-gesperrt/, r.ausgabe);
  const ohneFilter = await fuehreAus(["/bin/sh", "-c", "exit 0"], { arbeit: mkdtempSync(join(tmpdir(), "seccomp-")), ohneSeccomp: true });
  assert.equal(ohneFilter.code, 0, "ohne Filter startet die Sandbox auch – die Prüfung unterscheidet die Fälle");
});
