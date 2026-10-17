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
 */
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, rmSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MotorStart } from "./code-motor.js";
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
 * Brücke (`custom`, Adresse in der Sandbox), Freigaben `manual` (nie `smart`, das ein zweites Modell fragte),
 * keine Nachinstallation aus PyPI (die Sandbox hat ohnehin kein Netz).
 */
export function hermesKonfiguration(modell: string): string {
  if (!MODELL.test(modell)) throw new Error("Modellname ungültig");
  return JSON.stringify({
    model: { provider: "custom", base_url: `http://127.0.0.1:${BRUECKE_IN_SANDBOX.port}/v1`, default: modell, api_key: "bruecke" },
    approvals: { mode: "manual", cron_mode: "deny" },
    security: { allow_lazy_installs: false, redact_secrets: true },
  }, null, 2) + "\n";
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
}): MotorStart {
  const { ordner } = o.hermes;
  const start = sandboxMotor(
    [join(ordner, "bin", "python"), STARTSKRIPT_IN_SANDBOX, BRUECKE_IN_SANDBOX.sockel, String(BRUECKE_IN_SANDBOX.port), "--", join(ordner, "bin", "hermes-acp")],
    {
      home: (projekt) => hermesHeim(o.ablage, projekt),
      nurLesbar: [
        { quelle: ordner, ziel: ordner },
        { quelle: STARTSKRIPT, ziel: STARTSKRIPT_IN_SANDBOX },
        { quelle: o.bruecke.ordner, ziel: BRUECKE_IN_SANDBOX.ordner },
      ],
      ...(o.bwrap ? { bwrap: o.bwrap } : {}),
    },
  );
  return (projekt) => {
    const modell = o.hermes.modell ?? o.modell();
    if (!modell) throw Object.assign(new Error("kein Modell für Code-Läufe"), { name: "KeinModell" });
    schreibeKonfiguration(hermesHeim(o.ablage, projekt), hermesKonfiguration(modell));
    return start(projekt);
  };
}

/** Ein echter Ordner (0700) – nie ein Verweis: Das Home ist in der Sandbox schreibbar. */
function echterOrdner(pfad: string): void {
  if (!existsSync(pfad)) mkdirSync(pfad, { recursive: true, mode: 0o700 });
  const s = lstatSync(pfad);
  if (!s.isDirectory() || s.isSymbolicLink()) throw Object.assign(new Error("Home des Motors ist kein Ordner"), { name: "HeimKaputt" });
}

/**
 * `config.yaml` neu schreiben, ohne Verweisen zu folgen: Der Motor des letzten Laufs hätte sie durch einen Verweis
 * ersetzen können (etwa auf `~/.freedom/node-key`) – der Knoten schriebe sonst außerhalb der Sandbox.
 */
function schreibeKonfiguration(heim: string, inhalt: string): void {
  echterOrdner(heim);
  const konfig = join(heim, ".hermes");
  echterOrdner(konfig);
  const datei = join(konfig, "config.yaml");
  rmSync(datei, { force: true });
  const fd = openSync(datei, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeSync(fd, inhalt);
  } finally {
    closeSync(fd);
  }
}
