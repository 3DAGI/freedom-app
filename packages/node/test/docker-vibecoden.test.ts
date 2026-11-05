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
import { BLENDER_ORTE, GIMP_ORTE, GODOT_ORTE, INKSCAPE_ORTE, KICAD_ORTE, LIBREOFFICE_ORTE, OPENSCAD_ORTE } from "../src/bildstrom.js";
import { AAPT2_ORTE, ANDROID_SDK_ORTE, GRADLE_ORTE, HERMES_ORDNER } from "../src/hermes-motor.js";
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
  assert.match(docker, /FROM node:22-bookworm-slim AS godot-holen\nARG VIBECODEN=0\nCOPY scripts\/godot-holen\.sh \/tmp\/godot-holen\.sh\n/);
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
  assert.match(docker, /FROM node:22-bookworm-slim AS hangover-holen\nARG VIBECODEN=0\nARG WINE=0\nCOPY scripts\/hangover-holen\.sh \/tmp\/hangover-holen\.sh\n/);
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

test("VKk4b: KiCad nur mit VIBECODEN=1 und KICAD=1 – aus bookworm-backports mit kicad-cli, Symbolen und Footprints; die CI prüft es echt", () => {
  const docker = lies("docker/node.Dockerfile");
  assert.match(docker, /\nARG KICAD=0\nRUN if \[ "\$VIBECODEN" = "1" \] && \[ "\$KICAD" = "1" \]; then \\\n/);
  assert.match(docker, /echo "deb http:\/\/deb\.debian\.org\/debian bookworm-backports main" > \/etc\/apt\/sources\.list\.d\/bookworm-backports\.list/);
  assert.match(docker, /apt-get install -y --no-install-recommends -t bookworm-backports kicad kicad-symbols kicad-footprints \\\n/);
  assert.match(docker, /rm -rf \/var\/lib\/apt\/lists\/\* \/etc\/apt\/sources\.list\.d\/bookworm-backports\.list;/, "Backports nur für diesen Schritt");
  const pakete = (m: RegExpExecArray | null) => (m?.[1] ?? "").trim().split(/\s+/).filter((p) => p !== "\\");
  const immer = pakete(/\nRUN apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  const vibecoden = pakete(/if \[ "\$VIBECODEN" = "1" \]; then \\\n\s+apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  assert.ok(!immer.includes("kicad") && !vibecoden.includes("kicad"), "nur mit KICAD=1 – rund 700 MB");
  assert.deepEqual(KICAD_ORTE, ["/usr/bin/eeschema"], "dort legt Debian es ab");
  assert.match(lies("docker-compose.vibecoden.yml"), /\n\s+KICAD: "\$\{KICAD:-0\}"\n/);
  assert.ok(!lies("docker-compose.yml").includes("KICAD"), "der Standard bleibt ohne");
  assert.match(lies(".github/workflows/ci.yml"), /apt-get install -y --no-install-recommends kicad\n\s+kicad-cli version\n/);
});

test("VKk4c: Blender nur mit VIBECODEN=1 und BLENDER=1 aus der Distribution, dort, wo der Knoten es sucht; die CI prüft es echt", () => {
  const docker = lies("docker/node.Dockerfile");
  assert.match(docker, /\nARG BLENDER=0\nRUN if \[ "\$VIBECODEN" = "1" \] && \[ "\$BLENDER" = "1" \]; then \\\n\s+apt-get update && apt-get install -y --no-install-recommends blender && rm -rf \/var\/lib\/apt\/lists\/\*; \\\n/);
  const pakete = (m: RegExpExecArray | null) => (m?.[1] ?? "").trim().split(/\s+/).filter((p) => p !== "\\");
  const immer = pakete(/\nRUN apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  const vibecoden = pakete(/if \[ "\$VIBECODEN" = "1" \]; then \\\n\s+apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  assert.ok(!immer.includes("blender") && !vibecoden.includes("blender"), "nur mit BLENDER=1 – rund 400 MB");
  assert.deepEqual(BLENDER_ORTE, ["/usr/bin/blender"], "dort legt Debian es ab");
  assert.match(lies("docker-compose.vibecoden.yml"), /\n\s+BLENDER: "\$\{BLENDER:-0\}"\n/);
  assert.ok(!lies("docker-compose.yml").includes("BLENDER"), "der Standard bleibt ohne");
  assert.match(lies(".github/workflows/ci.yml"), /apt-get install -y --no-install-recommends blender\n\s+blender --version \| head -1\n/);
});

test("VKk4d: LibreOffice nur mit VIBECODEN=1 und LIBREOFFICE=1 aus der Distribution, dort, wo der Knoten es sucht; die CI prüft es echt", () => {
  const docker = lies("docker/node.Dockerfile");
  const lo = "libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw";
  assert.match(docker, new RegExp(`\\nARG LIBREOFFICE=0\\nRUN if \\[ "\\$VIBECODEN" = "1" \\] && \\[ "\\$LIBREOFFICE" = "1" \\]; then \\\\\\n`
    + `\\s+apt-get update && apt-get install -y --no-install-recommends ${lo} \\\\\\n\\s+&& rm -rf /var/lib/apt/lists/\\*; \\\\\\n`));
  const pakete = (m: RegExpExecArray | null) => (m?.[1] ?? "").trim().split(/\s+/).filter((p) => p !== "\\");
  const immer = pakete(/\nRUN apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  const vibecoden = pakete(/if \[ "\$VIBECODEN" = "1" \]; then \\\n\s+apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  assert.ok(![...immer, ...vibecoden].some((p) => p.startsWith("libreoffice")), "nur mit LIBREOFFICE=1 – rund 400 MB");
  assert.deepEqual(LIBREOFFICE_ORTE, ["/usr/bin/soffice"], "dort legt Debian den Verweis ab");
  assert.match(lies("docker-compose.vibecoden.yml"), /\n\s+LIBREOFFICE: "\$\{LIBREOFFICE:-0\}"\n/);
  assert.ok(!lies("docker-compose.yml").includes("LIBREOFFICE"), "der Standard bleibt ohne");
  assert.ok(lies(".github/workflows/ci.yml").includes(`apt-get install -y --no-install-recommends ${lo}\n          soffice --version\n`), "die CI installiert dieselben");
});

test("VKk4e: Inkscape nur mit VIBECODEN=1 und INKSCAPE=1 aus der Distribution, dort, wo der Knoten es sucht; die CI prüft es echt", () => {
  const docker = lies("docker/node.Dockerfile");
  assert.match(docker, /\nARG INKSCAPE=0\nRUN if \[ "\$VIBECODEN" = "1" \] && \[ "\$INKSCAPE" = "1" \]; then \\\n\s+apt-get update && apt-get install -y --no-install-recommends inkscape && rm -rf \/var\/lib\/apt\/lists\/\*; \\\n/);
  const pakete = (m: RegExpExecArray | null) => (m?.[1] ?? "").trim().split(/\s+/).filter((p) => p !== "\\");
  const immer = pakete(/\nRUN apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  const vibecoden = pakete(/if \[ "\$VIBECODEN" = "1" \]; then \\\n\s+apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  assert.ok(!immer.includes("inkscape") && !vibecoden.includes("inkscape"), "nur mit INKSCAPE=1 – rund 200 MB");
  assert.deepEqual(INKSCAPE_ORTE, ["/usr/bin/inkscape"], "dort legt Debian es ab");
  assert.match(lies("docker-compose.vibecoden.yml"), /\n\s+INKSCAPE: "\$\{INKSCAPE:-0\}"\n/);
  assert.ok(!lies("docker-compose.yml").includes("INKSCAPE"), "der Standard bleibt ohne");
  assert.match(lies(".github/workflows/ci.yml"), /apt-get install -y --no-install-recommends inkscape\n\s+inkscape --version\n/);
});

test("VKk4f: GIMP nur mit VIBECODEN=1 und GIMP=1 aus der Distribution, dort, wo der Knoten es sucht; die CI prüft es echt", () => {
  const docker = lies("docker/node.Dockerfile");
  assert.match(docker, /\nARG GIMP=0\nRUN if \[ "\$VIBECODEN" = "1" \] && \[ "\$GIMP" = "1" \]; then \\\n\s+apt-get update && apt-get install -y --no-install-recommends gimp && rm -rf \/var\/lib\/apt\/lists\/\*; \\\n/);
  const pakete = (m: RegExpExecArray | null) => (m?.[1] ?? "").trim().split(/\s+/).filter((p) => p !== "\\");
  const immer = pakete(/\nRUN apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  const vibecoden = pakete(/if \[ "\$VIBECODEN" = "1" \]; then \\\n\s+apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  assert.ok(!immer.includes("gimp") && !vibecoden.includes("gimp"), "nur mit GIMP=1 – rund 250 MB");
  assert.deepEqual(GIMP_ORTE, ["/usr/bin/gimp"], "dort legt Debian den Verweis ab");
  assert.match(lies("docker-compose.vibecoden.yml"), /\n\s+GIMP: "\$\{GIMP:-0\}"\n/);
  assert.ok(!lies("docker-compose.yml").includes("GIMP"), "der Standard bleibt ohne");
  assert.match(lies(".github/workflows/ci.yml"), /apt-get install -y --no-install-recommends gimp\n\s+gimp --version\n/);
});

test("VKh2a: Gradle nur mit VIBECODEN=1 und GRADLE=1 – die Distribution in fester Fassung gegen SHA-256, das JDK aus Debian; die CI baut damit", () => {
  const skript = lies("scripts/gradle-holen.sh");
  assert.match(skript, /^GRADLE_FASSUNG=9\.8\.2$/m);
  assert.match(skript, /^GRADLE_SUMME=[0-9a-f]{64}$/m);
  assert.match(skript, /curl -fsSL --retry 3 --proto '=https' --proto-redir '=https' --tlsv1\.2 -o "\$ARCHIV\.teil" "\$QUELLE"/, "nur https, auch nach der Weiterleitung");
  assert.match(skript, /stimmt "\$ARCHIV\.teil" \|\| \{ rm -f "\$ARCHIV\.teil";/, "erst geprüft, dann unter dem Namen");
  assert.match(skript, /unzip -Z1 "\$ARCHIV" \| grep -qvE "\^\$ORDNER\//, "nur entpacken, was unter gradle-<fassung>/ liegt");
  const docker = lies("docker/node.Dockerfile");
  assert.match(docker, /FROM node:22-bookworm-slim AS gradle-holen\nARG VIBECODEN=0\nARG GRADLE=0\nCOPY scripts\/gradle-holen\.sh \/tmp\/gradle-holen\.sh\n/);
  assert.match(docker, /if \[ "\$VIBECODEN" = "1" \] && \[ "\$GRADLE" = "1" \]; then apt-get update \\\n\s+&& apt-get install -y --no-install-recommends curl ca-certificates unzip \\\n\s+&& bash \/tmp\/gradle-holen\.sh \/tmp\/gradle \\\n/);
  assert.match(docker, /ln -s \.\.\/lib\/gradle\/bin\/gradle \/aus\/usr\/local\/bin\/gradle/);
  assert.match(docker, /\nCOPY --from=gradle-holen \/aus\/ \/\n/);
  assert.match(docker, /\nARG GRADLE=0\nRUN if \[ "\$VIBECODEN" = "1" \] && \[ "\$GRADLE" = "1" \]; then \\\n\s+mkdir -p \/usr\/share\/man\/man1 && apt-get update && apt-get install -y --no-install-recommends openjdk-17-jdk-headless \\\n/);
  assert.deepEqual(GRADLE_ORTE, ["/usr/local/bin/gradle"], "dort legt das Bild den Verweis ab");
  assert.match(lies("docker-compose.vibecoden.yml"), /\n\s+GRADLE: "\$\{GRADLE:-0\}"\n/);
  assert.ok(!lies("docker-compose.yml").includes("GRADLE"), "der Standard bleibt ohne");
  const ci = lies(".github/workflows/ci.yml");
  assert.match(ci, /key: gradle-\$\{\{ hashFiles\('scripts\/gradle-holen\.sh'\) \}\}\n/);
  assert.match(ci, /test "\$offiziell" = "\$summe" \|\|/, "die Summe gleich der von gradle.org");
  assert.match(ci, /\n\s+bash scripts\/gradle-holen\.sh "\$HOME\/\.cache\/freedom-gradle"\n\s+echo "GRADLE_TEST=\$HOME\/\.cache\/freedom-gradle\/gradle-\$fassung\/bin\/gradle" >> "\$GITHUB_ENV"\n/);
});

test("VKh2b: Android-SDK nur mit VIBECODEN=1, ANDROID=1 und GRADLE=1 – die Lizenz nimmt nur an, wer das Bild baut; Werkzeuge gegen SHA-256", () => {
  const skript = lies("scripts/android-sdk-holen.sh");
  assert.match(skript, /^WERKZEUGE_FASSUNG=15859902$/m);
  assert.match(skript, /^WERKZEUGE_SUMME=[0-9a-f]{64}$/m);
  assert.match(skript, /^ANDROID_PLATTFORM="platforms;android-36"$/m);
  assert.match(skript, /^ANDROID_BUILD_TOOLS="build-tools;36\.0\.0"$/m);
  assert.match(skript, /if \[ "\$\{ANDROID_SDK_LIZENZ:-\}" != "angenommen" \]; then[\s\S]{0,300}exit 1\nfi/, "ohne Annahme bricht es ab, bevor es etwas lädt");
  assert.ok(skript.indexOf("ANDROID_SDK_LIZENZ:-") < skript.indexOf("curl "), "die Lizenz vor dem ersten Abruf");
  assert.match(skript, /curl -fsSL --retry 3 --proto '=https' --proto-redir '=https' --tlsv1\.2 -o "\$ARCHIV\.teil" "\$QUELLE"/);
  assert.match(skript, /stimmt "\$ARCHIV\.teil" \|\| \{ rm -f "\$ARCHIV\.teil";/, "erst geprüft, dann unter dem Namen");
  assert.match(skript, /\{ yes \|\| true; \} \| "\$SDKMANAGER"/, "yes endet mit SIGPIPE – mit pipefail bräche das Skript sonst ab");
  assert.match(skript, /"\$SDKMANAGER" --sdk_root="\$ZIEL" --install "\$ANDROID_PLATTFORM" "\$ANDROID_BUILD_TOOLS"/, "genau diese beiden Pakete");
  const docker = lies("docker/node.Dockerfile");
  assert.match(docker, /FROM node:22-bookworm-slim AS android-sdk-holen\nARG VIBECODEN=0\nARG GRADLE=0\nARG ANDROID=0\nARG ANDROID_SDK_LIZENZ=\n/);
  assert.match(docker, /if \[ "\$GRADLE" != "1" \]; then echo "ANDROID=1 braucht GRADLE=1" >&2; exit 1; fi;/);
  assert.match(docker, /&& rm -rf \/aus\/usr\/lib\/android-sdk\/cmdline-tools; \\\n/, "sdkmanager bleibt draußen");
  assert.match(docker, /\nCOPY --from=android-sdk-holen \/aus\/ \/\n/);
  // die Lizenz nimmt nie das Repo an: im Bild leer vorgegeben, Compose reicht nur durch, die CI nennt sie nicht
  assert.equal([...docker.matchAll(/^(?:ARG|ENV) ANDROID_SDK_LIZENZ.*$/gm)].map((m) => m[0]).join("|"), "ARG ANDROID_SDK_LIZENZ=");
  assert.equal([...lies("docker-compose.vibecoden.yml").matchAll(/^\s+ANDROID_SDK_LIZENZ:.*$/gm)].map((m) => m[0].trim()).join("|"),
    'ANDROID_SDK_LIZENZ: "${ANDROID_SDK_LIZENZ:-}"');
  assert.ok(!lies(".github/workflows/ci.yml").includes("ANDROID_SDK_LIZENZ"), "die CI baut nur mit dem SDK des Runners");
  assert.deepEqual(ANDROID_SDK_ORTE, ["/usr/lib/android-sdk"], "dort legt das Bild das SDK ab");
  const compose = lies("docker-compose.vibecoden.yml");
  assert.match(compose, /\n\s+ANDROID: "\$\{ANDROID:-0\}"\n\s+ANDROID_SDK_LIZENZ: "\$\{ANDROID_SDK_LIZENZ:-\}"\n/);
  assert.ok(!lies("docker-compose.yml").includes("ANDROID"), "der Standard bleibt ohne");
});

test("VKh3a: aapt2 nur aus den Quellen – Rezept und jedes Repo am Commit geprüft, bevor etwas davon läuft; die CI baut es wie das Bild auf beiden Prozessoren", () => {
  const skript = lies("scripts/aapt2-bauen.sh");
  assert.match(skript, /^AAPT2_FASSUNG=37\.0\.0$/m);
  assert.match(skript, /^AOSP_TAG=android-17\.0\.0_r1$/m);
  assert.match(skript, /^AOSP=https:\/\/android\.googlesource\.com$/m);
  assert.match(skript, /^REZEPT=https:\/\/github\.com\/Commit451\/android-arm-build-tools$/m);
  assert.match(skript, /^REZEPT_COMMIT=[0-9a-f]{40}$/m);
  const staende = skript.match(/^STAENDE="\n([\s\S]*?)\n"$/m)![1].split("\n");
  assert.equal(staende.length, 39, "alle Repos aus repos.json des Rezepts");
  for (const z of staende) assert.match(z, /^[a-z0-9_-]+ +platform\/[a-z0-9_/-]+ +[0-9a-f]{40}$/, z);
  assert.ok(!staende.some((z) => / 0{40}$/.test(z)), "kein Platzhalter – jeder Commit fest");
  // erst holen und prüfen, dann die Liste des Rezepts vergleichen – erst danach laufen dessen Skript und CMake
  const stelle = (t: string) => { const i = skript.indexOf(t); assert.ok(i > 0, t); return i; };
  assert.ok(stelle('[ "$stand" != "$commit" ]') < stelle("repos.json des Rezepts nennt andere Repos"));
  assert.ok(stelle("repos.json des Rezepts nennt andere Repos") < stelle('python3 -I "$R/scripts/fetch_sources.py"'));
  assert.ok(stelle('python3 -I "$R/scripts/fetch_sources.py"') < stelle('cmake -S "$R"'));
  assert.match(skript, /grep -q ": cloned\$" "\$ARBEIT\/quellen\.log" \|\| grep -q "!!" "\$ARBEIT\/quellen\.log"/, "das Rezept holt nichts selbst, jeder Patch passt");
  assert.match(skript, /-DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g\+\+/);
  assert.match(skript, /bibliotheken="\$\(ldd "\$PROGRAMM"\)" \|\| \{/, "scheitert ldd, bricht es ab – leer hieße sonst „nichts Fremdes“");
  assert.match(skript, /grep -vqE 'linux-vdso\|ld-linux\|lib\(c\|m\|dl\|rt\|pthread\|stdc\\\+\\\+\|gcc_s\|z\)\\\.so'/, "nur glibc, libstdc++ und zlib");
  assert.match(skript, /Lizenztext fehlt für\$fehlt – Abbruch/);
  assert.ok(stelle("Lizenztext fehlt für") < stelle('cmake -S "$R"'), "Lizenztexte vor dem langen Bau");
  assert.ok(!/\b(curl|wget)\b/.test(skript), "nichts Fertiges laden – nur Quellen über git");
  const ci = lies(".github/workflows/ci.yml");
  assert.match(ci, /- \{ arch: x86_64, runner: ubuntu-24\.04 \}\n\s+- \{ arch: aarch64, runner: ubuntu-24\.04-arm \}/);
  assert.equal([...ci.matchAll(/key: aapt2-\$\{\{ matrix\.arch \}\}-\$\{\{ hashFiles\('scripts\/aapt2-bauen\.sh'\) \}\}/g)].length, 2, "geholt und gleich nach dem Bau gespeichert");
  // gebaut wie im Bild: dieselbe Basis wie jede Stufe (B-43), genau die Pakete aus dem Skript
  assert.match(ci, /pakete="\$\(sed -n 's\/\^AAPT2_BAU_PAKETE="\\\(\.\*\\\)"\$\/\\1\/p' scripts\/aapt2-bauen\.sh\)"/);
  assert.match(ci, /docker run --rm -v "\$PWD\/scripts:\/skripte:ro" -v "\$HOME\/\.cache\/freedom-aapt2:\/aus" node:22-bookworm-slim bash -c/);
  assert.match(ci, /apt-get install -y -qq --no-install-recommends \$pakete > \/dev\/null && bash \/skripte\/aapt2-bauen\.sh \/aus"/);
  assert.match(ci, /AAPT2_TEST="\$HOME\/\.cache\/freedom-aapt2\/aapt2" AAPT2_TEST_PFLICHT=1 node --import tsx --test --test-name-pattern "VKh3" test\/paket-spiegel\.test\.ts\n/);
  assert.match(ci, /echo "AAPT2_APK_PFLICHT=1" >> "\$GITHUB_ENV"/, "auf x86-64 auch das APK, nie übersprungen");
});

test("VKh3b: aapt2 im Bild nur mit VIBECODEN=1, ANDROID=1 und auf arm64 – aus den Quellen mit den Paketen des Skripts, dort, wo der Motor es sucht", () => {
  const docker = lies("docker/node.Dockerfile");
  assert.match(docker, /FROM node:22-bookworm-slim AS aapt2-bauen\nARG VIBECODEN=0\nARG ANDROID=0\nCOPY scripts\/aapt2-bauen\.sh \/tmp\/aapt2-bauen\.sh\n/);
  assert.match(docker, /if \[ "\$VIBECODEN" = "1" \] && \[ "\$ANDROID" = "1" \] && \[ "\$\(dpkg --print-architecture\)" = "arm64" \]; then \\\n\s+pakete="\$\(sed -n 's\/\^AAPT2_BAU_PAKETE=/,
    "nur auf arm64 – auf amd64 nimmt das Android-Plugin aapt2 aus Maven; die Pakete genau wie im CI-Job");
  assert.match(docker, /&& bash \/tmp\/aapt2-bauen\.sh \/tmp\/aapt2 \\\n\s+&& install -D -m 0755 \/tmp\/aapt2\/aapt2 \/aus\/usr\/local\/bin\/aapt2 /);
  assert.match(docker, /install -m 0644 \/tmp\/aapt2\/aapt2-lizenzen\/\* \/aus\/usr\/local\/share\/doc\/aapt2\//, "die Lizenztexte im Bild");
  assert.match(docker, /\nCOPY --from=aapt2-bauen \/aus\/ \/\n/, "nur das Programm, Compiler und Quellen bleiben in der Stufe");
  assert.deepEqual(AAPT2_ORTE, ["/usr/local/bin/aapt2"], "dort legt das Bild es ab");
  // ANDROID reicht Compose schon durch (VKh2b); ARM64 braucht keinen weiteren Schalter
  assert.match(lies("docker-compose.vibecoden.yml"), /\n\s+ANDROID: "\$\{ANDROID:-0\}"\n/);
});

test("B-43: Basis fest auf Debian 12 – jede Stufe node:22-bookworm-slim, Hangover für dieselbe Fassung", () => {
  const docker = lies("docker/node.Dockerfile");
  const basen = [...docker.matchAll(/^FROM (\S+)/gm)].map((m) => m[1]);
  assert.ok(basen.length >= 4, "Stufen gefunden");
  assert.deepEqual([...new Set(basen)], ["node:22-bookworm-slim"], "nie node:22-slim – das wandert mit der nächsten Debian-Fassung mit");
  // die Pakete von Hangover gibt es je Distribution: die im Bild muss zur Basis passen
  assert.deepEqual([...docker.matchAll(/hangover-holen\.sh \S+ (\w+)/g)].map((m) => m[1]), ["bookworm"]);
  assert.match(lies("scripts/hangover-holen.sh"), /bookworm: Debian 12 \(Docker-Bild\)/);
  assert.equal(lies(".nvmrc").trim().split(".")[0], "22", "dieselbe Hauptversion wie CI und Pages");
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
