/**
 * 11.5s4b: Speicher und Prozesse aller Programme eines Befehls zusammen – über cgroups v2, wo der Knoten einen eigenen
 * Teilbaum hat (`Delegate=memory pids` im Dienst des Installers), sonst wie bisher je Prozess. Die Logik läuft gegen eine
 * Attrappe des Dateisystems, der Startweg mit einem Ersatz für bubblewrap. Der echte Test braucht einen delegierten Teilbaum
 * – die CI gibt ihm eine eigene Scope mit `Delegate=yes` (als root, `pids.max` gilt auch dann) und setzt
 * `CGROUP_TEST_PFLICHT=1`: Fehlt der Teilbaum dort, ist das rot, nicht übersprungen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CGROUP_TEXT, CgroupVerwalter, eigeneCgroup, inCgroup, richteCgroupsEin, type CgroupDateien } from "../src/cgroup.js";
import { cgroupsAktiv, fuehreAus, nutzeCgroups, pruefeSandbox, sandboxDienst, SANDBOX_GRENZEN, sandboxText } from "../src/sandbox.js";

const GRENZEN = { speicherBytes: 256 << 20, prozesse: 64 };
const S = "/sys/fs/cgroup/system.slice/freedom-node.service";

/** Ein Dateisystem der cgroups im Speicher: ein neuer Ordner bekommt die Dateien, die der Kern anlegt. */
function attrappe(o: { controller?: string; nichtSchreibbar?: string[]; ohneSwap?: boolean } = {}) {
  const inhalt = new Map<string, string>([
    [`${S}/cgroup.controllers`, o.controller ?? "cpuset cpu io memory hugetlb pids rdma misc\n"],
    [`${S}/cgroup.procs`, "123\n456\n"], [`${S}/cgroup.subtree_control`, ""],
  ]);
  const ordner = new Set<string>([S]);
  const geschrieben: Array<[string, string]> = [];
  let rmdirScheitert = 0;
  const d: CgroupDateien = {
    lies: (p) => { const t = inhalt.get(p); if (t === undefined) throw Object.assign(new Error("fehlt"), { code: "ENOENT" }); return t; },
    schreibe: (p, t) => { if (!inhalt.has(p)) throw new Error("fehlt"); geschrieben.push([p, t]); inhalt.set(p, t); },
    ordner: (p) => {
      if (ordner.has(p)) throw new Error("gibt es");
      ordner.add(p);
      for (const f of ["cgroup.procs", "memory.max", "pids.max", "cgroup.kill", ...(o.ohneSwap ? [] : ["memory.swap.max"])]) inhalt.set(`${p}/${f}`, "");
    },
    weg: (p) => { if (rmdirScheitert-- > 0) throw new Error("belegt"); if (!ordner.delete(p)) throw new Error("fehlt"); },
    gibt: (p) => inhalt.has(p) || ordner.has(p),
    schreibbar: (p) => inhalt.has(p) && !(o.nichtSchreibbar ?? []).includes(p),
  };
  return { d, geschrieben, ordner, belegt: (n: number) => { rmdirScheitert = n; } };
}

test("11.5s4b: die eigene Gruppe nur aus reinem cgroups v2 – nie die Wurzel, nie mit ..; aus knoten die darüber", () => {
  assert.equal(eigeneCgroup("0::/system.slice/freedom-node.service\n"), "/system.slice/freedom-node.service");
  assert.equal(eigeneCgroup("0::/system.slice/freedom-node.service/knoten\n"), "/system.slice/freedom-node.service");
  for (const falsch of ["0::/\n", "", "12:memory:/x\n0::/x\n", "0::/a/../b\n", "1:name=systemd:/x\n", "0::relativ\n"]) assert.equal(eigeneCgroup(falsch), null, falsch);
});

test("11.5s4b: einrichten – alle Prozesse ins Blatt knoten, dann memory und pids für die Kinder; sonst nichts geändert", () => {
  const a = attrappe();
  const v = richteCgroupsEin(GRENZEN, { proc: "0::/system.slice/freedom-node.service\n", dateien: a.d });
  assert.ok(v instanceof CgroupVerwalter);
  assert.equal(v.basis, S);
  assert.ok(a.ordner.has(`${S}/knoten`));
  assert.deepEqual(a.geschrieben, [[`${S}/knoten/cgroup.procs`, "123"], [`${S}/knoten/cgroup.procs`, "456"], [`${S}/cgroup.subtree_control`, "+memory +pids"]],
    "erst umziehen, dann einschalten – cgroups v2 erlaubt Controller für Kinder nur ohne eigene Prozesse");
  // nur nachsehen: nichts schreiben
  const b = attrappe();
  assert.ok(richteCgroupsEin(GRENZEN, { proc: "0::/system.slice/freedom-node.service\n", dateien: b.d, nurPruefen: true }));
  assert.deepEqual(b.geschrieben, []);
  // ohne Speicher-Controller, ohne Schreibrecht (kein Delegate=), mit cgroups v1, ohne Datei: nichts
  for (const [fall, x, proc] of [
    ["ohne memory", attrappe({ controller: "cpu pids" }), "0::/system.slice/freedom-node.service\n"],
    ["ohne pids", attrappe({ controller: "cpu memory" }), "0::/system.slice/freedom-node.service\n"],
    ["nicht delegiert", attrappe({ nichtSchreibbar: [`${S}/cgroup.subtree_control`] }), "0::/system.slice/freedom-node.service\n"],
    ["cgroups v1", attrappe(), "4:memory:/x\n0::/system.slice/freedom-node.service\n"],
    ["andere Gruppe", attrappe(), "0::/user.slice\n"],
  ] as const) {
    assert.equal(richteCgroupsEin(GRENZEN, { proc, dateien: x.d }), null, fall);
    assert.deepEqual(x.geschrieben, [], fall);
  }
});

test("11.5s4b: je Befehl eine Gruppe mit Speicher ohne Swap und Prozessen; weg beendet den Rest und räumt auf, auch später", async () => {
  const a = attrappe();
  const v = new CgroupVerwalter(S, GRENZEN, a.d);
  const g = v.neu();
  const ordner = g.procs.slice(0, -"/cgroup.procs".length);
  assert.match(ordner, new RegExp(`^${S}/befehl-[0-9a-f]{16}$`));
  assert.deepEqual(a.geschrieben, [[`${ordner}/memory.max`, String(256 << 20)], [`${ordner}/pids.max`, "64"], [`${ordner}/memory.swap.max`, "0"]]);
  a.belegt(2); // die Prozesse enden erst nach cgroup.kill
  g.weg();
  assert.deepEqual(a.geschrieben.at(-1), [`${ordner}/cgroup.kill`, "1"]);
  for (let i = 0; i < 30 && a.ordner.has(ordner); i++) await new Promise((f) => setTimeout(f, 50));
  assert.ok(!a.ordner.has(ordner), "nach dem Beenden weg");
  // ohne Swap-Abrechnung keine Datei dafür; scheitert eine Grenze, gibt es keine Gruppe
  const b = attrappe({ ohneSwap: true });
  new CgroupVerwalter(S, GRENZEN, b.d).neu();
  assert.ok(!b.geschrieben.some(([p]) => p.endsWith("memory.swap.max")));
  const c = attrappe();
  const kaputt: CgroupDateien = { ...c.d, schreibe: (p, t) => { if (p.endsWith("pids.max")) throw new Error("EINVAL"); c.d.schreibe(p, t); } };
  assert.throws(() => new CgroupVerwalter(S, GRENZEN, kaputt).neu());
  assert.deepEqual([...c.ordner], [S], "die halbe Gruppe ist wieder weg");
  // der Befehl tritt selbst ein und wird dann zu bubblewrap
  assert.deepEqual(inCgroup("/g/cgroup.procs", ["bwrap", "--x"]), ["/bin/sh", "-c", 'echo $$ > "$0" && exec "$@"', "/g/cgroup.procs", "bwrap", "--x"]);
});

test("11.5s4b: die Sandbox tritt vor bubblewrap in die Gruppe ein – derselbe Prozess; ohne bubblewrap wie bisher „fehlt“", async () => {
  const d = mkdtempSync(join(tmpdir(), "freedom-cgroup-"));
  // statt bubblewrap ein Skript, das seine Prozessnummer aufschreibt
  const bwrap = join(d, "bwrap");
  writeFileSync(bwrap, `#!/bin/sh\necho $$ > ${d}/bwrap-pid\necho ok\n`, { mode: 0o755 });
  const weg: string[] = [];
  let neu = 0;
  const stub = { neu: () => { neu++; return { procs: join(d, "procs"), weg: () => weg.push("weg") }; } } as unknown as CgroupVerwalter;
  try {
    assert.match(sandboxText({ ok: true, seccomp: true, root: true }), /läuft als root/);
    nutzeCgroups(stub);
    assert.ok(cgroupsAktiv());
    assert.doesNotMatch(sandboxText({ ok: true, seccomp: true, root: true }), /läuft als root/, "pids.max gilt auch für root");
    const r = await fuehreAus(["/bin/true"], { arbeit: d, bwrap });
    assert.equal(r.code, 0, r.ausgabe);
    assert.equal(readFileSync(join(d, "procs"), "utf8").trim(), readFileSync(join(d, "bwrap-pid"), "utf8").trim(), "erst eingetreten, dann bubblewrap");
    assert.deepEqual(weg, ["weg"]);
    // auch Dienste (Dev-Server, Bildstrom) und damit der Motor desselben Wegs
    await sandboxDienst(["/bin/true"], { arbeit: d, bwrap }).ende;
    assert.deepEqual(weg, ["weg", "weg"]);
    // fehlt bubblewrap, keine Gruppe und dieselbe Meldung wie bisher
    await assert.rejects(fuehreAus(["/bin/true"], { arbeit: d, bwrap: join(d, "gibt-es-nicht") }), { name: "SandboxFehlt" });
    assert.equal(neu, 2);
  } finally {
    nutzeCgroups(null);
    rmSync(d, { recursive: true, force: true });
  }
  assert.ok(!cgroupsAktiv());
  assert.match(CGROUP_TEXT.aus, /Delegate=memory pids/);
  assert.match(readFileSync(new URL("../../../scripts/install-freedom.sh", import.meta.url), "utf8"), /\nDelegate=memory pids\n\n\[Install\]/, "der Dienst des Installers bekommt den Teilbaum");
  assert.match(readFileSync(new URL("../src/main.ts", import.meta.url), "utf8"),
    /const gruppen = richteCgroupsEin\(\{ speicherBytes: SANDBOX_GRENZEN\.speicherGesamtKiB \* 1024, prozesse: SANDBOX_GRENZEN\.prozesse \}\);\n\s+nutzeCgroups\(gruppen\);/);
  assert.ok(SANDBOX_GRENZEN.speicherGesamtKiB >= SANDBOX_GRENZEN.speicherKiB, "zusammen nie weniger als einer allein");
});

const pflicht = process.env.CGROUP_TEST_PFLICHT === "1";
const echt = richteCgroupsEin(GRENZEN);
const sandbox = await pruefeSandbox();
const ohne = (!echt && "kein eigener cgroup-Teilbaum (cgroups v2 mit Delegate=)") || (!sandbox.ok && `Sandbox geht hier nicht (${sandbox.fall})`)
  || (!existsSync("/usr/bin/python3") && "python3 fehlt");

if (pflicht && ohne) test("11.5s4b (cgroups v2): in der CI Pflicht", () => assert.fail(ohne));

test("11.5s4b (cgroups v2): Speicher und Prozesse aller Programme eines Befehls zusammen – auch als root; nichts bleibt liegen", { skip: ohne, timeout: 120_000 }, async () => {
  const arbeit = mkdtempSync(join(tmpdir(), "freedom-cgroup-echt-"));
  nutzeCgroups(echt);
  try {
    // drei Prozesse je 150 MiB: jeder für sich unter 4 GiB (ulimit -d), zusammen über 256 MiB – einer wird beendet
    const speicher = await fuehreAus(["/bin/sh", "-c",
      'p=""; for i in 1 2 3; do /usr/bin/python3 -c "import time; x = b\\"a\\" * (150 << 20); time.sleep(3)" & p="$p $!"; done; ok=0; for i in $p; do wait $i || ok=1; done; echo "ende $ok"'],
    { arbeit });
    assert.match(speicher.ausgabe, /ende 1/, speicher.ausgabe);
    // pids.max: höchstens 64 Prozesse – ulimit -u (1024) greift für root nicht, die Gruppe schon
    const prozesse = await fuehreAus(["/usr/bin/python3", "-c",
      "import os, time\nn = 0\nfor i in range(200):\n    try:\n        pid = os.fork()\n    except OSError:\n        break\n    if pid == 0:\n        time.sleep(2)\n        os._exit(0)\n    n += 1\nprint('kinder', n)"],
    { arbeit });
    const kinder = Number(/kinder (\d+)/.exec(prozesse.ausgabe)?.[1]);
    assert.ok(kinder > 0 && kinder < 64, prozesse.ausgabe);
    // ohne Grenze aus der Gruppe liefen alle drei durch
    nutzeCgroups(null);
    const frei = await fuehreAus(["/bin/sh", "-c",
      'p=""; for i in 1 2 3; do /usr/bin/python3 -c "import time; x = b\\"a\\" * (150 << 20); time.sleep(1)" & p="$p $!"; done; ok=0; for i in $p; do wait $i || ok=1; done; echo "ende $ok"'],
    { arbeit });
    assert.match(frei.ausgabe, /ende 0/, "Gegenprobe ohne Gruppe");
    // alle Gruppen der Befehle sind wieder weg
    const rest = () => readdirSync(echt!.basis).filter((n) => n.startsWith("befehl-"));
    for (let i = 0; i < 50 && rest().length > 0; i++) await new Promise((f) => setTimeout(f, 100));
    assert.deepEqual(rest(), []);
  } finally {
    nutzeCgroups(null);
    rmSync(arbeit, { recursive: true, force: true });
  }
});
