/**
 * Vibecoden unter Docker (VKc3b): Hermes kommt nur mit `VIBECODEN=1` ins Bild – gepinnt, jedes Paket mit Hash, nur
 * Wheels, in `HERMES_ORDNER`. Die Sandbox braucht unter Docker ein eigenes Seccomp-Profil (Standard plus
 * Namensräume) und ein unverdecktes `/proc` – beides nur über `docker-compose.vibecoden.yml`, nie im Standard.
 * Geprüft am 17.10.2026 mit Docker 29.3.1: ohne die Ergänzung `sandbox.namensraum`, mit ihr laufen
 * `sandbox.test.ts` und `hermes-motor.test.ts` im Container grün.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HERMES_ORDNER } from "../src/hermes-motor.js";

const lies = (pfad: string) => readFileSync(new URL(`../../../${pfad}`, import.meta.url), "utf8");

test("VKc3b: Hermes im Bild nur mit VIBECODEN=1, gepinnt mit Hash je Paket, nur Wheels, in HERMES_ORDNER", () => {
  const docker = lies("docker/node.Dockerfile");
  assert.match(docker, /ARG VIBECODEN=0\n/);
  assert.match(docker, /if \[ "\$VIBECODEN" = "1" \]; then/);
  assert.match(docker, new RegExp(`python3 -m venv ${HERMES_ORDNER} `));
  for (const opt of ["--require-hashes", "--only-binary :all:", "--no-deps", "-r /tmp/hermes-requirements.txt"]) assert.ok(docker.includes(opt), opt);
  const sperre = lies("docker/hermes-requirements.txt");
  const pakete = sperre.split(/\n(?=[a-z0-9])/i).filter((b) => /^[a-z0-9][a-z0-9._-]*==/i.test(b));
  assert.ok(pakete.length > 50, "die ganze Kette steht in der Sperrdatei");
  for (const p of pakete) assert.match(p, /--hash=sha256:[0-9a-f]{64}/, p.split(" ")[0]);
  assert.ok(pakete.some((p) => p.startsWith("hermes-agent==0.19.0 ")));
  assert.ok(pakete.some((p) => p.startsWith("agent-client-protocol==")), "ACP für hermes-acp");
  assert.ok(pakete.some((p) => p.startsWith("mcp==")), "MCP für Freedom-MCP (VKd)");
  assert.match(lies("docker/hermes.in"), /^hermes-agent\[acp,mcp\]==0\.19\.0$/m);
});

test("VKc3b: Seccomp – das Standardprofil plus genau eine Regel für Namensräume, sonst gesperrt", () => {
  const p = JSON.parse(lies("docker/seccomp-vibecoden.json")) as { defaultAction: string; syscalls: Array<{ names: string[]; action: string; includes?: unknown; args?: unknown }> };
  assert.equal(p.defaultAction, "SCMP_ACT_ERRNO");
  const letzte = p.syscalls.at(-1)!;
  assert.deepEqual(letzte, { names: ["clone", "unshare", "mount", "umount2", "pivot_root", "setns", "sethostname"], action: "SCMP_ACT_ALLOW" });
  // nichts sonst ohne Bedingung freigegeben, was Docker nur mit CAP_SYS_ADMIN erlaubt
  for (const r of p.syscalls.slice(0, -1)) {
    if (r.action === "SCMP_ACT_ALLOW" && !r.includes && !r.args) assert.ok(!r.names.some((n) => ["bpf", "keyctl", "ptrace", "init_module", "kexec_load"].includes(n)), r.names.join());
  }
});

test("VKc3b: docker-compose.vibecoden.yml – Bild mit Hermes, Sandbox-Freigaben nur hier, nie im Standard", () => {
  const ergaenzung = lies("docker-compose.vibecoden.yml");
  for (const z of ['VIBECODEN: "1"', "- seccomp=docker/seccomp-vibecoden.json", "- systempaths=unconfined", "- apparmor=unconfined", 'CODE_MODELL: "${CODE_MODELL:-}"',
    'VORSCHAU_URL: "${VORSCHAU_URL:-}"', '- "${VORSCHAU_BIND:-0.0.0.0}:3603:3603"']) {
    assert.ok(ergaenzung.includes(z), z);
  }
  assert.match(ergaenzung, /build:\n\s+args:\n\s+VIBECODEN: "1"/);
  const standard = lies("docker-compose.yml");
  assert.ok(!/security_opt|unconfined|seccomp/.test(standard), "der Standard bleibt bei den Regeln von Docker");
  assert.ok(!/3603|VORSCHAU/.test(standard), "die Vorschau (VKg1a) gibt es nur mit Vibecoden");
  assert.match(standard, /VIBECODEN: "\$\{VIBECODEN:-0\}"/);
});
