/**
 * Hermes als erster Motor für Code-Läufe (VKc3, Entscheidung VK-W1n C, `docs/VIBECODEN-ENTWURF.md`): Hermes Agent
 * (Nous Research, MIT) spricht ACP über stdio (`hermes-acp`) und läuft nur in der Sandbox (`sandboxMotor()`, VK4).
 *
 * - **Installiert** als eigenes venv mit `hermes-agent[acp]` in `HERMES_ORDNER` (Vorgabe `/opt/hermes`, das Docker-Bild
 *   mit `VIBECODEN=1`, VKc3b) – nur lesbar in die Sandbox eingebunden, unter demselben Pfad. Der Knoten prüft nur, ob
 *   die Programme da sind; er führt sie nie außerhalb der Sandbox aus.
 * - **Modell** nur über die Brücke (`modell-bruecke.ts`): Die Sandbox hat kein Netz, `freedom_motor.py` reicht
 *   `127.0.0.1:8080` darin an den Socket weiter. Kein Nous Portal, kein OpenRouter, keine eigenen Schlüssel.
 * - **Konfiguration** je Projekt in einem eigenen Home (`~/.freedom/hermes/<projekt>`, 0700) außerhalb des Repos –
 *   Gedächtnis und Skills bleiben beim Projekt (AG1 A), landen aber nie in seinen Commits. `config.yaml` schreibt der
 *   Knoten vor jedem Start neu: eigener Endpunkt, Freigaben `manual` über ACP, keine Nachinstallation von Paketen.
 *   Hermes fragt über ACP vor Änderungen an Dateien und vor riskanten Befehlen – nicht vor jedem Befehl.
 * - **Pakete** (seit VKd3) über dieselbe Brücke: `.npmrc` und `pip.conf` im Home zeigen auf den Spiegel des Knotens
 *   (`paket-spiegel.ts`), nur npm und PyPI von der festen Liste; seit VKh1 auch Gradle (Init-Skript in `~/.gradle/init.d`)
 *   mit Google Maven und Maven Central.
 */
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, rmSync, statSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MotorStart } from "./code-motor.js";
import { BILDER_IN_SANDBOX } from "./bilder-motor.js";
import { MCP_ZEICHEN } from "./freedom-mcp.js";
import { hermesMcpEintrag, type McpServer } from "./mcp-katalog.js";
import { BRUECKE_IN_SANDBOX, type ModellBruecke } from "./modell-bruecke.js";
import type { ProjektAblage } from "./projekte.js";
import { sandboxMotor } from "./sandbox.js";

export const HERMES_ORDNER = "/opt/hermes";
/** Das Startskript liegt im Paket des Knotens und wird nur lesbar eingebunden. */
export const STARTSKRIPT = fileURLToPath(new URL("../motor/freedom_motor.py", import.meta.url));
const STARTSKRIPT_IN_SANDBOX = "/freedom/motor.py";
/** Modellnamen, wie Ollama und OpenAI-kompatible Dienste sie nennen. */
const MODELL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export interface HermesEinstellung {
  /** venv mit `bin/python` und `bin/hermes-acp`. */
  ordner: string;
  /** Modell für Code-Läufe (`CODE_MODELL`); ohne das erste Modell im Angebot des Knotens. */
  modell?: string;
}

/**
 * Aus der Umgebung: `HERMES_ORDNER` und `CODE_MODELL`. Ungültige Werte → `ungueltig` (kein Start); fehlt Hermes
 * nur, bleibt Vibecoden ohne Motor (`fehlt`, Läufe mit `code-ohne-motor`).
 */
export function hermesAusUmgebung(env: { HERMES_ORDNER?: string; CODE_MODELL?: string }):
  { hermes: HermesEinstellung } | { fehlt: string } | { ungueltig: string } {
  const ordner = (env.HERMES_ORDNER || HERMES_ORDNER).trim().replace(/(.)\/+$/, "$1");
  if (!ordner.startsWith("/") || ordner === "/" || ordner.split("/").includes("..")) return { ungueltig: "HERMES_ORDNER muss ein absoluter Pfad sein" };
  const modell = env.CODE_MODELL?.trim();
  if (modell && !MODELL.test(modell)) return { ungueltig: "CODE_MODELL ist kein Modellname" };
  if (!existsSync(join(ordner, "bin", "python")) || !existsSync(join(ordner, "bin", "hermes-acp"))) {
    return { fehlt: `Hermes fehlt in ${ordner} (bin/python, bin/hermes-acp) – Vibecoden ohne Motor` };
  }
  return { hermes: { ordner, ...(modell ? { modell } : {}) } };
}

/**
 * `config.yaml` für Hermes – als JSON, das YAML liest. Nur Schlüssel, die Hermes 0.19 kennt: das Modell über die
 * Brücke (`custom`, Adresse in der Sandbox), Freedom-MCP über dieselbe Brücke (VKd – in der Konfiguration statt über ACP,
 * weil Hermes 0.19 MCP über HTTP in `initialize` nicht ankündigt), Freigaben `manual` (nie `smart`, das ein zweites Modell
 * fragte), keine Nachinstallation für Hermes selbst – Pakete holt seit VKd3 nur das Projekt, über den Spiegel der Brücke.
 * Server aus dem MCP-Katalog (VKk) startet Hermes selbst, als Kind in derselben Sandbox – nur mit den Werkzeugen ihrer Liste.
 */
export function hermesKonfiguration(modell: string, mcp: readonly McpServer[] = [], zeichen?: string): string {
  if (!MODELL.test(modell)) throw new Error("Modellname ungültig");
  if (mcp.some((s) => s.name === "freedom")) throw new Error("MCP-Name vergeben");
  if (zeichen !== undefined && !MCP_ZEICHEN.test(zeichen)) throw new Error("Zeichen ungültig");
  const bruecke = `http://127.0.0.1:${BRUECKE_IN_SANDBOX.port}`;
  return JSON.stringify({
    model: { provider: "custom", base_url: `${bruecke}/v1`, default: modell, api_key: "bruecke" },
    mcp_servers: {
      ...(zeichen ? { freedom: { url: `${bruecke}/mcp/${zeichen}` } } : {}),
      ...Object.fromEntries(mcp.map((s) => [s.name, hermesMcpEintrag(s)])),
    },
    approvals: { mode: "manual", cron_mode: "deny" },
    security: { allow_lazy_installs: false, redact_secrets: true },
  }, null, 2) + "\n";
}

/**
 * `.npmrc` und `pip.conf` (VKd3): npm und pip fragen die Brücke statt des Netzes; ohne Prüfung der Sicherheitslücken
 * (`audit`, an einen anderen Endpunkt von npm) und ohne Versionsabfrage von pip, die nur warten ließen.
 *
 * Dazu seit VKh1 ein Init-Skript für Gradle (`~/.gradle/init.d/`, Gradle liest es vor jedem Bau): Es lenkt die
 * Repositories des Projekts – `google()`, `mavenCentral()`, `gradlePluginPortal()` und dieselben Adressen von Hand – auf
 * den Spiegel (`allowInsecureProtocol`: http nur zu 127.0.0.1 in der Sandbox) und gibt den Plugins diese beiden statt des
 * Portals, das Gradle sonst ohne Liste fragte. Andere Repositories bleiben, wie sie sind – ohne Netz erreicht Gradle sie nicht.
 */
export function paketKonfiguration(): { npmrc: string; pip: string; gradle: string } {
  const bruecke = `http://127.0.0.1:${BRUECKE_IN_SANDBOX.port}`;
  return {
    npmrc: [`registry=${bruecke}/npm/`, "audit=false", "fund=false", "update-notifier=false", ""].join("\n"),
    pip: ["[global]", `index-url = ${bruecke}/pypi/simple/`, "trusted-host = 127.0.0.1", "disable-pip-version-check = true", ""].join("\n"),
    gradle: [
      "// FreedomStack (VKh1): Die Sandbox hat kein Netz. Bibliotheken und Plugins holt Gradle nur über den Spiegel des",
      "// Knotens – von Google Maven und Maven Central. Der Knoten schreibt diese Datei vor jedem Lauf neu.",
      `def spiegel = "${bruecke}/maven"`,
      "def ziele = [",
      '  "dl.google.com/dl/android/maven2": "google", "maven.google.com": "google",',
      '  "repo.maven.apache.org/maven2": "central", "repo1.maven.org/maven2": "central", "plugins.gradle.org/m2": "central",',
      "]",
      "def umlenken = { RepositoryHandler repos ->",
      "  repos.withType(MavenArtifactRepository).configureEach { r ->",
      "    def ziel = ziele[r.url.toString().replaceFirst('^https?://', '').replaceFirst('/+$', '')]",
      "    if (ziel != null) {",
      '      r.url = new URI("${spiegel}/${ziel}/")',
      "      r.allowInsecureProtocol = true",
      "    }",
      "  }",
      "}",
      "beforeSettings { settings ->",
      "  settings.pluginManagement.repositories {",
      '    maven { name = "FreedomGoogle"; url = new URI("${spiegel}/google/"); allowInsecureProtocol = true }',
      '    maven { name = "FreedomCentral"; url = new URI("${spiegel}/central/"); allowInsecureProtocol = true }',
      "  }",
      "  umlenken(settings.pluginManagement.repositories)",
      "  umlenken(settings.buildscript.repositories)",
      "  umlenken(settings.dependencyResolutionManagement.repositories)",
      "}",
      "allprojects { p ->",
      "  umlenken(p.buildscript.repositories)",
      "  umlenken(p.repositories)",
      "}",
      "",
    ].join("\n"),
  };
}

/** Home des Motors für ein Projekt – neben den Projekten, nie darin (`~/.freedom/hermes/<projekt>`). */
export function hermesHeim(ablage: Pick<ProjektAblage, "ordner">, projektOrdner: string): string {
  return join(dirname(ablage.ordner), "hermes", basename(projektOrdner));
}

/**
 * Der Motor für `CodeLaeufe`: vor jedem Start die Konfiguration ins Home des Projekts, dann Hermes über
 * `freedom_motor.py` in der Sandbox – Hermes, Startskript und Brücke nur lesbar, schreibbar nur Projekt und Home.
 */
export function hermesMotor(o: {
  hermes: HermesEinstellung; ablage: Pick<ProjektAblage, "ordner">; bruecke: Pick<ModellBruecke, "ordner">;
  modell: () => string | undefined; bwrap?: string;
  /** MCP-Server aus dem Katalog (VKk) – was sie brauchen, kommt nur lesbar in die Sandbox. */
  mcp?: readonly McpServer[];
  /** Freedom-MCP je Projekt (VKd2b1): das Zeichen des Projekts (Name des Ordners) – ohne kein Freedom-MCP. */
  mcpZeichen?: (projekt: string) => string;
  /** Bilder (VKd2b2): der Ordner mit den Bildern des Projekts – nur lesbar unter `/freedom/bilder`. */
  bilder?: (projekt: string) => string;
  /** Hinweise zum Bild (VKk5, `bildHinweise()`) – nur, wenn der Bildstrom an ist. */
  bild?: string;
  /** Gradle ist da (VKh2a, `gradleAusUmgebung()`) – dann sagt `SOUL.md`, wie man damit baut. Ohne Bild und Gradle kein `SOUL.md`. */
  gradle?: boolean;
}): MotorStart {
  const { ordner } = o.hermes;
  const start = sandboxMotor(
    [join(ordner, "bin", "python"), STARTSKRIPT_IN_SANDBOX, BRUECKE_IN_SANDBOX.sockel, String(BRUECKE_IN_SANDBOX.port), "--", join(ordner, "bin", "hermes-acp")],
    {
      home: (projekt) => hermesHeim(o.ablage, projekt),
      nurLesbar: (projekt) => [
        { quelle: ordner, ziel: ordner },
        { quelle: STARTSKRIPT, ziel: STARTSKRIPT_IN_SANDBOX },
        { quelle: o.bruecke.ordner, ziel: BRUECKE_IN_SANDBOX.ordner },
        ...(o.mcp ?? []).flatMap((s) => s.nurLesbar),
        ...(o.bilder ? [{ quelle: o.bilder(basename(projekt)), ziel: BILDER_IN_SANDBOX }] : []),
      ],
      ...(o.bwrap ? { bwrap: o.bwrap } : {}),
    },
  );
  return (projekt, lauf) => {
    const modell = o.hermes.modell ?? o.modell();
    if (!modell) throw Object.assign(new Error("kein Modell für Code-Läufe"), { name: "KeinModell" });
    const heim = hermesHeim(o.ablage, projekt);
    const pakete = paketKonfiguration();
    // im Modus „fragen“ (und ohne Angabe) nur, was nichts ändert – Änderungen gehen dort über Hermes, der vorher fragt
    const mcp = (o.mcp ?? []).map((s) => (lauf?.modus === "frei" || !s.beimFragen ? s : { ...s, werkzeuge: s.beimFragen }));
    schreibeInsHeim(heim, [".hermes", "config.yaml"], hermesKonfiguration(modell, mcp, o.mcpZeichen?.(basename(projekt))));
    schreibeInsHeim(heim, [".npmrc"], pakete.npmrc);
    // ohne den Ordner bände bubblewrap nichts ein und startete nicht
    if (o.bilder) mkdirSync(o.bilder(basename(projekt)), { recursive: true, mode: 0o700 });
    schreibeInsHeim(heim, [".config", "pip", "pip.conf"], pakete.pip);
    schreibeInsHeim(heim, [".gradle", "init.d", "freedom-spiegel.gradle"], pakete.gradle);
    // Hermes liest SOUL.md aus seinem Home als Identität (VKk5) – ohne Bild und Gradle keine, sonst versprächen alte Hinweise
    // ein Bild oder ein Programm
    if (o.bild !== undefined || o.gradle) schreibeInsHeim(heim, [".hermes", "SOUL.md"], hermesSeele(o.bild, { gradle: o.gradle === true }));
    else rmSync(join(heim, ".hermes", "SOUL.md"), { force: true });
    return start(projekt);
  };
}

/**
 * `SOUL.md` für Hermes (VKk5): Hermes 0.19 nimmt sie aus seinem Home als Identität (`load_soul_md()`) statt seiner eigenen –
 * daher steht die Rolle vorn, danach die Hinweise zum Bild. Ins Projekt schreibt der Knoten nie (dort läge eine `AGENTS.md`
 * im Commit).
 */
export function hermesSeele(bild: string | undefined, o: { gradle?: boolean } = {}): string {
  return [
    "You are Hermes Agent, a coding agent in a FreedomStack project. The project is /arbeit, a git repository; the node",
    "commits your changes. You work in a sandbox without network – use the tools you are given; npm, pip and Gradle get",
    "packages through the node's mirror (Gradle only from Google Maven and Maven Central).",
    ...(o.gradle ? ["", GRADLE_HINWEIS] : []),
    ...(bild !== undefined ? ["", bild] : []),
  ].join("\n");
}

/** Was der Motor über Gradle wissen muss (VKh2a) – nur, wenn der Knoten es hat. */
export const GRADLE_HINWEIS = [
  "# Building with Gradle",
  "",
  "Gradle and a JDK 17 are installed: run `gradle` (for example `gradle build`), not `./gradlew` – the wrapper downloads",
  "Gradle itself and fails without network. Libraries and plugins come from Google Maven and Maven Central only.",
].join("\n");

/** Gradle für Java-Projekte (VKh2a): nur, wo das Bild es ablegt (`GRADLE=1`, `scripts/gradle-holen.sh`) – kein eigener Pfad. */
export const GRADLE_ORTE: readonly string[] = ["/usr/local/bin/gradle"];

/** Gradle (VKh2a): der erste aus `GRADLE_ORTE`, der auf eine Datei zeigt; null mit `GRADLE=aus` oder ohne Fund. */
export function gradleAusUmgebung(env: { GRADLE?: string }, orte: readonly string[] = GRADLE_ORTE): string | null {
  if (env.GRADLE?.trim() === "aus") return null;
  return orte.find((p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  }) ?? null;
}

/** Ein echter Ordner (0700) – nie ein Verweis: Das Home ist in der Sandbox schreibbar. */
function echterOrdner(pfad: string): void {
  if (!existsSync(pfad)) mkdirSync(pfad, { recursive: true, mode: 0o700 });
  const s = lstatSync(pfad);
  if (!s.isDirectory() || s.isSymbolicLink()) throw Object.assign(new Error("Home des Motors ist kein Ordner"), { name: "HeimKaputt" });
}

/**
 * Eine Datei im Home neu schreiben (`config.yaml`, `.npmrc`, `pip.conf`, Init-Skript von Gradle), ohne Verweisen zu folgen: Der Motor des
 * letzten Laufs hätte sie durch einen Verweis ersetzen können (etwa auf `~/.freedom/node-key`) – der Knoten schriebe
 * sonst außerhalb der Sandbox. Jeder Ordner davor muss ein echter sein.
 */
function schreibeInsHeim(heim: string, pfad: string[], inhalt: string): void {
  echterOrdner(heim);
  let ordner = heim;
  for (const teil of pfad.slice(0, -1)) {
    ordner = join(ordner, teil);
    echterOrdner(ordner);
  }
  const datei = join(ordner, pfad[pfad.length - 1]!);
  rmSync(datei, { force: true });
  const fd = openSync(datei, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeSync(fd, inhalt);
  } finally {
    closeSync(fd);
  }
}
