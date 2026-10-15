/**
 * Sandbox (VKb = 11.5s): Befehle und Motor nur in bubblewrap – Wurzel nur lesbar,
 * schreibbar nur der Arbeitsordner (darin `.git` nur lesbar), leere Umgebung, kein
 * Netz, nichts vom Knoten sichtbar, Zeitgrenze für die ganze Prozessgruppe. Die
 * Tests mit echtem bubblewrap überspringen sich nur, wenn `pruefeSandbox()` hier
 * scheitert (die CI installiert bubblewrap).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Stream } from "@agentclientprotocol/sdk";
import { CODE_GRENZEN } from "@freedomstack/protocol";
import { SANDBOX_GRENZEN, SANDBOX_TEXT, fuehreAus, pruefeSandbox, sandboxArgumente, sandboxMotor, sandboxText } from "../src/sandbox.js";

const pruefung = await pruefeSandbox();
const ohne = !pruefung.ok && `Sandbox geht hier nicht (${pruefung.fall})`;
const projekt = (mitGit = true) => {
  const arbeit = mkdtempSync(join(tmpdir(), "sandbox-test-"));
  if (mitGit) mkdirSync(join(arbeit, ".git"));
  return arbeit;
};
/** Der Wert hinter einer Option in den Argumenten. */
const nach = (a: string[], opt: string) => a.flatMap((x, i) => (x === opt ? [a[i + 1]!] : []));

test("VKb: Argumente – alle Namensräume, keine Fähigkeiten, leere Umgebung, nur lesbar, .git nur lesbar nach dem Arbeitsordner", () => {
  const arbeit = projekt();
  const a = sandboxArgumente({ arbeit }, "/etc-test");
  for (const o of ["--unshare-all", "--unshare-user", "--die-with-parent", "--new-session", "--clearenv"]) assert.ok(a.includes(o), o);
  assert.deepEqual(nach(a, "--cap-drop"), ["ALL"]);
  assert.deepEqual(nach(a, "--setenv").sort(), ["HOME", "LANG", "PATH"]);
  // aus /etc nur drei Dateien, nie das ganze /etc, nie das Home des Knotens
  assert.deepEqual(nach(a, "--ro-bind").filter((q) => q === "/etc" || q.startsWith("/etc/")), []);
  assert.deepEqual(a.filter((x) => x.startsWith("/etc/")).sort(), ["/etc/group", "/etc/hosts", "/etc/passwd"]);
  assert.ok(!a.some((x) => x === process.env.HOME || x.includes(".freedom")));
  // schreibbar nur der Arbeitsordner – .git danach nur lesbar darüber
  assert.deepEqual(nach(a, "--bind"), [arbeit]);
  const rw = a.indexOf("--bind"), ro = a.indexOf(join(arbeit, ".git"));
  assert.ok(ro > rw && a[ro - 1] === "--ro-bind" && a[ro + 1] === "/arbeit/.git");
  assert.equal(nach(a, "--size")[0], String(SANDBOX_GRENZEN.tmpBytes));
  assert.deepEqual(nach(a, "--chdir"), ["/arbeit"]);
  assert.deepEqual(nach(a, "--remount-ro"), ["/"]);
  // ohne Wunsch keine GPU, ohne .git keine zweite Einbindung
  assert.ok(!a.includes("--dev-bind"));
  assert.ok(!sandboxArgumente({ arbeit: projekt(false) }, "/e").some((x) => x.endsWith("/.git")));
  // ein eigenes Home nur auf Wunsch, sonst ein tmpfs
  assert.ok(nach(a, "--tmpfs").includes("/home/agent"));
  assert.deepEqual(nach(sandboxArgumente({ arbeit, home: "/h" }, "/e"), "--bind"), ["/h", arbeit]);
});

test("VKb: Selbstprüfung mit festen Sätzen – je Fall einer", () => {
  assert.equal(sandboxText({ ok: true }), SANDBOX_TEXT["sandbox.ok"]);
  for (const fall of ["sandbox.fehlt", "sandbox.namensraum"] as const) assert.match(sandboxText({ ok: false, fall }), /führt der Knoten keinen Code aus/);
});

test("VKb: ohne bubblewrap kein Ausführen – nie direkt auf dem Rechner", async () => {
  assert.deepEqual(await pruefeSandbox("/nicht/da/bwrap"), { ok: false, fall: "sandbox.fehlt" });
  await assert.rejects(fuehreAus(["/bin/sh", "-c", "touch /tmp/nie"], { arbeit: projekt(), bwrap: "/nicht/da/bwrap" }), { name: "SandboxFehlt" });
  assert.throws(() => fuehreAus([], { arbeit: projekt() }), /leer/);
  assert.throws(() => fuehreAus(["a\0b"], { arbeit: projekt() }), /ungültig/);
});

test("VKb (bubblewrap): leere Umgebung, eigener Nutzer, kein Netz, Grenzen gesetzt, keine neuen Rechte", { skip: ohne }, async () => {
  process.env.FREEDOM_GEHEIM_TEST = "nie-in-der-sandbox";
  const env = await fuehreAus(["/usr/bin/env"], { arbeit: projekt() });
  assert.equal(env.code, 0);
  assert.deepEqual(env.ausgabe.trim().split("\n").map((z) => z.split("=")[0]).sort(), ["HOME", "LANG", "PATH", "PWD"]);
  assert.ok(!env.ausgabe.includes("nie-in-der-sandbox"));
  const r = await fuehreAus(["/bin/sh", "-c", "id -u; pwd; ulimit -t; ulimit -f; ulimit -n; grep NoNewPrivs /proc/self/status; tail -n +3 /proc/net/dev | cut -d: -f1"], { arbeit: projekt() });
  assert.equal(r.code, 0);
  const [uid, pwd, cpu, datei, dateien, nnp, ...netz] = r.ausgabe.trim().split("\n").map((z) => z.trim());
  assert.deepEqual([uid, pwd, cpu, datei, dateien], ["1000", "/arbeit", String(SANDBOX_GRENZEN.cpuSek), String(SANDBOX_GRENZEN.dateiKiB), String(SANDBOX_GRENZEN.offeneDateien)]);
  assert.match(nnp!, /NoNewPrivs:\s+1/);
  assert.deepEqual(netz, ["lo"]);
});

test("VKb (bubblewrap): schreibbar nur der Arbeitsordner, .git und die Wurzel nur lesbar, Knoten-Dateien unsichtbar", { skip: ohne }, async () => {
  const arbeit = projekt();
  writeFileSync(join(arbeit, ".git", "config"), "[core]\n");
  const geheim = join(mkdtempSync(join(tmpdir(), "knoten-")), "node-key");
  writeFileSync(geheim, "geheim");
  const r = await fuehreAus(["/bin/sh", "-c", [
    "echo neu > datei && echo arbeit-ok",
    "echo x >> .git/config || echo git-nur-lesbar",
    "touch /usr/x 2>/dev/null || echo wurzel-nur-lesbar",
    "touch /etc/x 2>/dev/null || echo etc-nur-lesbar",
    "touch /x 2>/dev/null || echo wurzel-tmpfs-nur-lesbar",
    `test -e ${geheim} || echo knoten-unsichtbar`,
    "test -e /etc/shadow || echo kein-shadow",
    "test -e /root || echo kein-root",
    "echo t > /tmp/t && echo tmp-ok",
  ].join("; ")], { arbeit });
  assert.equal(r.code, 0);
  for (const z of ["arbeit-ok", "git-nur-lesbar", "wurzel-nur-lesbar", "etc-nur-lesbar", "wurzel-tmpfs-nur-lesbar", "knoten-unsichtbar", "kein-shadow", "kein-root", "tmp-ok"]) assert.ok(r.ausgabe.includes(z), z);
  assert.equal(readFileSync(join(arbeit, "datei"), "utf8"), "neu\n");
  assert.equal(readFileSync(join(arbeit, ".git", "config"), "utf8"), "[core]\n");
  // /tmp der Sandbox ist ein eigenes tmpfs
  assert.ok(!existsSync("/tmp/t") || readFileSync("/tmp/t", "utf8") !== "t\n");
});

test("VKb (bubblewrap): Exit-Code kommt durch, lange Ausgabe gekürzt, nach der Zeit endet die ganze Prozessgruppe", { skip: ohne }, async () => {
  assert.equal((await fuehreAus(["/bin/sh", "-c", "exit 7"], { arbeit: projekt() })).code, 7);
  const lang = await fuehreAus(["/bin/sh", "-c", "head -c 30000 /dev/zero | tr '\\0' a; echo ENDE"], { arbeit: projekt() });
  assert.ok(lang.gekuerzt && lang.ausgabe.length <= CODE_GRENZEN.ausgabe && lang.ausgabe.trimEnd().endsWith("ENDE"));
  // ein Kind im Hintergrund hält die Rückgabe nicht auf
  const t = Date.now();
  const r = await fuehreAus(["/bin/sh", "-c", "sleep 30 & sleep 30"], { arbeit: projekt() }, 300);
  assert.deepEqual([r.code, r.zeitUm], [null, true]);
  assert.ok(Date.now() - t < 10_000, `nach ${Date.now() - t} ms`);
});

test("VKb (bubblewrap): der Motor läuft in der Sandbox – Strom über stdin/stdout, Home außerhalb des Repos, beende() hält ihn an", { skip: ohne }, async () => {
  const arbeit = projekt(), home = mkdtempSync(join(tmpdir(), "motor-home-"));
  const start = sandboxMotor(["/bin/sh", "-c", `printf '{"pwd":"%s","home":"%s","uid":"%s"}\\n' "$PWD" "$HOME" "$(id -u)"; touch "$HOME/h"; exec cat`], { home: (o) => (o === arbeit ? home : "/falsch") });
  const m = start(arbeit);
  const strom = m.strom as Stream;
  const leser = strom.readable.getReader(), schreiber = strom.writable.getWriter();
  assert.deepEqual((await leser.read()).value, { pwd: "/arbeit", home: "/home/agent", uid: "1000" });
  await schreiber.write({ jsonrpc: "2.0", method: "echo", params: { x: 1 } });
  assert.deepEqual((await leser.read()).value, { jsonrpc: "2.0", method: "echo", params: { x: 1 } });
  assert.ok(existsSync(join(home, "h")) && !existsSync(join(arbeit, "h")));
  m.beende();
  assert.equal((await leser.read()).done, true);
  assert.throws(() => sandboxMotor([]), /leer/);
});
