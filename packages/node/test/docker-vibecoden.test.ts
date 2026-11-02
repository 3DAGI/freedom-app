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
import { GODOT_ORTE, OPENSCAD_ORTE } from "../src/bildstrom.js";
import { HERMES_ORDNER } from "../src/hermes-motor.js";
import { BROWSER_ORTE } from "../src/mcp-katalog.js";

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
    'VORSCHAU_URL: "${VORSCHAU_URL:-}"', '- "${VORSCHAU_BIND:-0.0.0.0}:3603:3603"', 'TURN_INTERN: "${TURN_INTERN:-}"',
    '- "host.docker.internal:host-gateway"']) {
    assert.ok(ergaenzung.includes(z), z);
  }
  assert.match(ergaenzung, /build:\n\s+args:\n\s+VIBECODEN: "1"/);
  const standard = lies("docker-compose.yml");
  assert.ok(!/security_opt|unconfined|seccomp/.test(standard), "der Standard bleibt bei den Regeln von Docker");
  assert.ok(!/3603|VORSCHAU/.test(standard), "die Vorschau (VKg1a) gibt es nur mit Vibecoden");
  assert.match(standard, /VIBECODEN: "\$\{VIBECODEN:-0\}"/);
});

test("VKk1: Chromium, Schriften und Playwright nur mit VIBECODEN=1 – das schlanke Bild bleibt ohne", () => {
  const docker = lies("docker/node.Dockerfile");
  const pakete = (m: RegExpExecArray | null) => (m?.[1] ?? "").trim().split(/\s+/);
  const immer = pakete(/\nRUN apt-get update && apt-get install -y --no-install-recommends ([^\\\n]+)/.exec(docker));
  // alle Zeilen des Aufrufs bis zum nächsten `&&`
  const vibecoden = pakete(/if \[ "\$VIBECODEN" = "1" \]; then \\\n\s+apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker))
    .filter((p) => p !== "\\");
  assert.ok(immer.includes("bubblewrap") && !immer.includes("chromium"), immer.join(" "));
  for (const p of ["chromium", "fonts-liberation"]) assert.ok(vibecoden.includes(p), p);
  // optionale Pakete (Playwright, ohne Browser-Download) nur mit Vibecoden
  assert.match(docker, /OPTIONAL=\$\(\[ "\$VIBECODEN" = "1" \] \|\| echo --omit=optional\);/);
  assert.equal(docker.match(/--no-fund \$OPTIONAL/g)?.length, 2);
  assert.match(docker, /ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1\n/);
  // den Chromium aus Debian findet der Knoten von selbst
  assert.equal(BROWSER_ORTE[0], "/usr/lib/chromium/chromium");
});

test("VKg2c1: Bildstrom im Bild nur mit VIBECODEN=1 – Xvfb, GStreamer mit webrtcbin, PyGObject, python-xlib", () => {
  const docker = lies("docker/node.Dockerfile");
  const pakete = (m: RegExpExecArray | null) => (m?.[1] ?? "").trim().split(/\s+/).filter((p) => p !== "\\");
  const immer = pakete(/\nRUN apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  const vibecoden = pakete(/if \[ "\$VIBECODEN" = "1" \]; then \\\n\s+apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  // was bildFehlt() prüft (BILD_TEXT nennt dieselben Pakete)
  for (const p of ["xvfb", "gstreamer1.0-plugins-base", "gstreamer1.0-plugins-good", "gstreamer1.0-plugins-bad", "gstreamer1.0-nice",
    "gir1.2-gst-plugins-base-1.0", "gir1.2-gst-plugins-bad-1.0", "python3-gi", "python3-xlib"]) {
    assert.ok(vibecoden.includes(p), p);
    assert.ok(!immer.includes(p), `${p} nicht im schlanken Bild`);
  }
  assert.ok(vibecoden.includes("chromium"), "Chromium zeigt Web-Projekte im Bild");
});

test("VKg2c2: NVENC nur über docker-compose.nvenc.yml – GPU mit Video-Kodierer für den Knoten, nie im Standard", () => {
  const nvenc = lies("docker-compose.nvenc.yml");
  assert.match(nvenc, /services:\n  node:\n    deploy:\n      resources:\n        reservations:\n          devices:\n            - driver: nvidia\n/);
  assert.match(nvenc, /capabilities: \[gpu, compute, utility, video\]/);
  // im Standard bekommt nur Ollama eine GPU, der Knoten nie
  const standard = lies("docker-compose.yml");
  const knoten = standard.slice(standard.indexOf("\n  node:"), standard.indexOf("\n  coturn:"));
  assert.ok(knoten.length > 0 && !/driver: nvidia/.test(knoten), "der Knoten ohne GPU im Standard");
  assert.ok(!/nvidia/.test(lies("docker-compose.vibecoden.yml")), "Vibecoden ohne NVIDIA – läuft auch auf einem Raspberry Pi");
});

test("VKk3a: Godot nur mit VIBECODEN=1 – das Release in fester Fassung gegen SHA-512 geprüft, Mesa im Bild; die CI prüft es echt", () => {
  const skript = lies("scripts/godot-holen.sh");
  assert.match(skript, /^GODOT_FASSUNG=4\.7\.2-stable$/m);
  for (const s of ["x86_64", "arm64", "LICENSE\\.txt", "COPYRIGHT\\.txt"]) assert.match(skript, new RegExp(`^  \\[${s}\\]=[0-9a-f]{128}$`, "m"), s);
  assert.match(skript, /curl -fsSL --retry 3 --proto '=https' --tlsv1\.2 -o "\$2\.teil" "\$1"/, "nur https");
  assert.match(skript, /stimmt "\$2\.teil" "\$3" \|\| \{ rm -f "\$2\.teil";/, "erst geprüft, dann unter dem Namen");
  assert.match(skript, /unzip -p "\$ZIEL\/\$ARCHIV" "Godot_v\$\{GODOT_FASSUNG\}_linux\.\$ARCH" > "\$ZIEL\/godot\.teil"/, "nur die eine Datei");
  const docker = lies("docker/node.Dockerfile");
  assert.match(docker, /FROM node:22-slim AS godot-holen\nARG VIBECODEN=0\nCOPY scripts\/godot-holen\.sh \/tmp\/godot-holen\.sh\n/);
  assert.match(docker, /if \[ "\$VIBECODEN" = "1" \]; then apt-get update \\\n\s+&& apt-get install -y --no-install-recommends curl ca-certificates unzip \\\n\s+&& bash \/tmp\/godot-holen\.sh \/tmp\/godot \\\n/);
  assert.match(docker, /install -D -m 0755 \/tmp\/godot\/godot \/aus\/usr\/local\/bin\/godot/);
  assert.match(docker, /\nCOPY --from=godot-holen \/aus\/ \/\n/);
  assert.equal(GODOT_ORTE[0], "/usr/local/bin/godot", "dort findet der Knoten es von selbst");
  const pakete = (m: RegExpExecArray | null) => (m?.[1] ?? "").trim().split(/\s+/).filter((p) => p !== "\\");
  const immer = pakete(/\nRUN apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  const vibecoden = pakete(/if \[ "\$VIBECODEN" = "1" \]; then \\\n\s+apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  for (const p of ["libgl1", "libglx-mesa0", "libgl1-mesa-dri", "libxcursor1", "libxinerama1", "libxi6", "libxrandr2"]) {
    assert.ok(vibecoden.includes(p), p);
    assert.ok(!immer.includes(p), `${p} nicht im schlanken Bild`);
  }
  const ci = lies(".github/workflows/ci.yml");
  assert.match(ci, /key: godot-\$\{\{ hashFiles\('scripts\/godot-holen\.sh'\) \}\}\n/);
  assert.match(ci, /\n\s+bash scripts\/godot-holen\.sh "\$HOME\/\.cache\/freedom-godot"\n\s+echo "GODOT_TEST=\$HOME\/\.cache\/freedom-godot\/godot" >> "\$GITHUB_ENV"\n/);
});

test("VKi1/VKi2: Wine und mingw-w64 nur mit VIBECODEN=1 und WINE=1 – amd64 Wine der Distribution, arm64 Hangover; die CI prüft beide echt", () => {
  const docker = lies("docker/node.Dockerfile");
  assert.match(docker, /\nARG WINE=0\nRUN --mount=type=bind,from=hangover-holen,source=\/aus,target=\/tmp\/hangover \\\n\s+if \[ "\$VIBECODEN" = "1" \] && \[ "\$WINE" = "1" \]; then \\\n/);
  assert.match(docker, /if \[ "\$\(dpkg --print-architecture\)" = "amd64" \]; then \\\n\s+apt-get install -y --no-install-recommends wine wine64 gcc-mingw-w64-x86-64 g\+\+-mingw-w64-x86-64; \\\n/);
  assert.match(docker, /else \\\n\s+apt-get install -y --no-install-recommends \/tmp\/hangover\/\*\.deb gcc-mingw-w64-x86-64 g\+\+-mingw-w64-x86-64; \\\n/);
  // Hangover nur in einer eigenen Stufe geholt – das Archiv liegt in keiner Schicht, curl nicht im Bild
  assert.match(docker, /FROM node:22-slim AS hangover-holen\nARG VIBECODEN=0\nARG WINE=0\nCOPY scripts\/hangover-holen\.sh \/tmp\/hangover-holen\.sh\n/);
  assert.match(docker, /if \[ "\$VIBECODEN" = "1" \] && \[ "\$WINE" = "1" \] && \[ "\$\(dpkg --print-architecture\)" = "arm64" \]; then apt-get update/);
  assert.match(docker, /bash \/tmp\/hangover-holen\.sh \/tmp\/hangover bookworm \\\n/);
  assert.ok(!/COPY --from=hangover-holen/.test(docker), "nie per COPY – sonst bliebe das Paket in einer Schicht");
  const pakete = (m: RegExpExecArray | null) => (m?.[1] ?? "").trim().split(/\s+/).filter((p) => p !== "\\");
  const immer = pakete(/\nRUN apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  const vibecoden = pakete(/if \[ "\$VIBECODEN" = "1" \]; then \\\n\s+apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  for (const p of ["wine", "wine64"]) assert.ok(!immer.includes(p) && !vibecoden.includes(p), `${p} nur mit WINE=1`);
  assert.match(lies("docker-compose.vibecoden.yml"), /build:\n\s+args:\n\s+VIBECODEN: "1"\n(\s+#[^\n]*\n)?\s+WINE: "\$\{WINE:-0\}"\n/);
  assert.ok(!lies("docker-compose.yml").includes("WINE"), "der Standard bleibt ohne");
  const ci = lies(".github/workflows/ci.yml");
  assert.match(ci, /apt-get install -y --no-install-recommends wine64 gcc-mingw-w64-x86-64\n\s+\/usr\/lib\/wine\/wine64 --version && x86_64-w64-mingw32-gcc --version/);
  // ARM64: eigener Job, Hangover aus dem Skript, der Echttest ist Pflicht
  assert.match(ci, /\n  hangover:\n    name: Windows-Programme auf ARM64 \(Hangover\)\n    runs-on: ubuntu-24.04-arm\n/);
  assert.match(ci, /bash scripts\/hangover-holen\.sh "\$HOME\/\.cache\/freedom-hangover" noble\n\s+sudo apt-get install -y --no-install-recommends "\$HOME"\/\.cache\/freedom-hangover\/\*\.deb\n/);
  assert.match(ci, /run: WINE_TEST_PFLICHT=1 node --import tsx --test --test-name-pattern "VKi" test\/bildstrom\.test\.ts\n/);
});

test("VKk4a: OpenSCAD nur mit VIBECODEN=1 aus der Distribution, dort, wo der Knoten es sucht; die CI prüft es echt", () => {
  const docker = lies("docker/node.Dockerfile");
  const pakete = (m: RegExpExecArray | null) => (m?.[1] ?? "").trim().split(/\s+/).filter((p) => p !== "\\");
  const immer = pakete(/\nRUN apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  const vibecoden = pakete(/if \[ "\$VIBECODEN" = "1" \]; then \\\n\s+apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  assert.ok(vibecoden.includes("openscad"), "im großen Bild");
  assert.ok(!immer.includes("openscad"), "nicht im schlanken Bild");
  assert.deepEqual(OPENSCAD_ORTE, ["/usr/bin/openscad"], "dort legt Debian es ab");
  assert.match(lies(".github/workflows/ci.yml"), /apt-get install -y --no-install-recommends openscad\n\s+openscad --version\n/);
});

test("VKi2: Hangover in fester Fassung – SHA-256 je Distribution fest im Skript, nur https, nur die vier Pakete, nur ARM64", () => {
  const skript = lies("scripts/hangover-holen.sh");
  assert.match(skript, /^HANGOVER_FASSUNG=11\.16$/m);
  for (const d of ["noble", "bookworm"]) assert.match(skript, new RegExp(`^  \\[${d}\\]=[0-9a-f]{64}$`, "m"), d);
  assert.match(skript, /curl -fsSL --retry 3 --proto '=https' --tlsv1\.2 -o "\$tar_datei\.teil"/, "nur https");
  assert.match(skript, /stimmt "\$tar_datei\.teil" "\$\{SUMME\[\$DIST\]\}" \|\| \{ rm -f "\$tar_datei\.teil";/, "erst geprüft, dann unter dem Namen");
  assert.match(skript, /^PAKETE=\(hangover-wine hangover-libarm64ecfex hangover-libwow64fex hangover-wowbox64\)$/m, "ohne DXVK");
  assert.match(skript, /tar -xOf "\$tar_datei" "\$name" > "\$ZIEL\/\$name"/, "nur flache Namen, nie entpacken, wohin es will");
  assert.match(skript, /aarch64 \| arm64\) ;;/);
});
