/**
 * MCP-Katalog für den Motor (VKk, `docs/VIBECODEN-ENTWURF.md` „MCP für gängige Programme“): Programme und ihre
 * MCP-Server, die der Knoten Hermes in `config.yaml` mitgibt – je Server ein Schritt, gepinnt, Name, Zweck, Größe und
 * Lizenz im Pull Request.
 *
 * - Jeder Server läuft als Kind des Motors in dessen Sandbox (`sandboxMotor()`: ohne Netz, Grenzen, seccomp); was er
 *   braucht, kommt nur lesbar hinein (`nurLesbar`). Nie außerhalb der Sandbox.
 * - Der Motor bekommt nur die Werkzeuge aus `werkzeuge` (Liste zum Erlauben, `tools.include` bei Hermes) – nie eines,
 *   das beliebigen Code im Server ausführt: Befehle laufen über das Terminal von Hermes, das vorher fragt.
 *
 * VKk1: Browser – Playwright MCP (Microsoft, Apache-2.0). Er steckt in `playwright-core`, das der Knoten schon für die
 * Web-Werkzeuge hat (8.7, optional) – kein neues Paket. Der Agent klickt damit durch, was er baut: Seiten von einem
 * Server in derselben Sandbox (`python3 -m http.server`, `npm run dev`), nie das Netz.
 *
 * VKd2a: Kiwix – dieselbe Brücke (`mcp/kiwix-bruecke.mjs`) und dieselben ZIM-Dateien wie für Aufträge (B-31b,
 * `mcp.json`), kein zweiter Ort zum Einrichten. `kiwix-serve` hört nur auf 127.0.0.1 der Sandbox des Motors.
 *
 * VKk2a: Jupyter-Notebooks – die eigene Brücke (`mcp/jupyter-bruecke.mjs`, nur Node): Zellen lesen, anlegen, ändern und
 * löschen, nur unter `/arbeit`, geschrieben wie nbformat. Sie führt nichts aus – Code läuft nur über das Terminal von
 * Hermes, das vorher fragt. VKk2b: dort mit `notebook_ausfuehren.py` neben der Brücke und dem Kernel der Distribution
 * (python3-ipykernel, python3-nbclient); nur wenn es ihn gibt, nennt die Brücke den Befehl.
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WERKZEUGE as JUPYTER_WERKZEUGE } from "../mcp/jupyter-bruecke.mjs";
import { WERKZEUGE as KIWIX_WERKZEUGE } from "../mcp/kiwix-bruecke.mjs";
import { KIWIX_BRUECKE, KIWIX_SERVE } from "./mcp-client.js";

/** Ein MCP-Server für `mcp_servers` in `config.yaml` – Pfade so, wie die Sandbox sie sieht. */
export interface McpServer {
  name: string;
  befehl: string;
  argumente: string[];
  /** Nur diese Werkzeuge bekommt der Motor. */
  werkzeuge: readonly string[];
  /**
   * Im Modus „fragen“ nur diese (VKk2a): Was Dateien ändert, geht dort über die Werkzeuge von Hermes, die vorher fragen –
   * vor MCP-Aufrufen fragt Hermes nicht. Ohne Angabe alle.
   */
  beimFragen?: readonly string[];
  /** Was der Server braucht, nur lesbar in die Sandbox (`SandboxOrt.nurLesbar`). */
  nurLesbar: Array<{ quelle: string; ziel: string }>;
}

/** Wo `playwright-core` in der Sandbox liegt – nie unter `/arbeit`. */
export const PLAYWRIGHT_IN_SANDBOX = "/freedom/mcp/playwright-core";
/** Selbst benannte Ausgaben (Bildschirmfotos ohne Namen) – im tmpfs, nicht im Projekt, sonst landeten sie im Commit. */
const AUSGABE_IN_SANDBOX = "/tmp/playwright-mcp";

/**
 * Werkzeuge des Browsers, die der Motor bekommt: alle aus der Grundausstattung (`core`) – sehen, klicken, tippen,
 * prüfen – außer `browser_run_code_unsafe` (beliebiger Code im Server, nach Playwright „RCE-equivalent“). Weitere
 * Fähigkeiten (`--caps`) schaltet der Knoten nicht frei. Die Liste gilt für die gepinnte Fassung; ein Test vergleicht
 * sie mit dem, was der Server meldet – ein neues Werkzeug kommt erst nach einem Blick darauf dazu.
 */
export const PLAYWRIGHT_WERKZEUGE = [
  "browser_navigate", "browser_navigate_back", "browser_snapshot", "browser_find", "browser_take_screenshot",
  "browser_click", "browser_hover", "browser_drag", "browser_drop", "browser_type", "browser_press_key",
  "browser_fill_form", "browser_select_option", "browser_handle_dialog", "browser_file_upload", "browser_wait_for",
  "browser_evaluate", "browser_console_messages", "browser_network_requests", "browser_network_request", "browser_tabs",
  "browser_resize", "browser_close",
] as const;

/** Browser, die der Knoten von selbst sucht: Chromium aus Debian (das Bild mit `VIBECODEN=1`), sonst Google Chrome. */
export const BROWSER_ORTE = ["/usr/lib/chromium/chromium", "/opt/google/chrome/chrome"] as const;

/** Wo die Kiwix-Brücke in der Sandbox liegt – nie unter `/arbeit`. */
export const KIWIX_IN_SANDBOX = "/freedom/mcp/kiwix";
/** Die Jupyter-Brücke (VKk2a) und wo sie in der Sandbox liegt – nie unter `/arbeit`. */
export const JUPYTER_BRUECKE = fileURLToPath(new URL("../mcp/jupyter-bruecke.mjs", import.meta.url));
export const JUPYTER_IN_SANDBOX = "/freedom/mcp/jupyter";
/** Das Skript zum Ausführen (VKk2b), wie der Motor es in der Sandbox sieht – neben der Brücke. */
export const NOTEBOOK_AUSFUEHREN_IN_SANDBOX = join(JUPYTER_IN_SANDBOX, "notebook_ausfuehren.py");

let ausfuehrbar: boolean | undefined;

/**
 * Hat die Python der Distribution nbclient und einen Kernel `python3` (VKk2b)? Einmal je Prozess gefragt – mit
 * `/usr/bin/python3`, wie das Skript und der Kernel selbst; in die Sandbox kommt davon nichts, `/usr` sieht sie schon.
 */
export function notebooksAusfuehrbar(): boolean {
  ausfuehrbar ??= spawnSync("/usr/bin/python3", ["-c",
    "import nbclient, nbformat\nfrom jupyter_client.kernelspec import KernelSpecManager\nassert 'python3' in KernelSpecManager().find_kernel_specs()"],
  { stdio: "ignore", timeout: 30_000, env: { PATH: "/usr/bin:/bin" } }).status === 0;
  return ausfuehrbar;
}

/** Was für einen Server des Katalogs fehlt – ins Log nur diese Kennungen. */
export type McpFehlt = "mcp.playwright-fehlt" | "mcp.browser-fehlt" | "mcp.kiwix-fehlt" | "mcp.jupyter-kernel-fehlt";

/**
 * `playwright-core` des Knotens (optionale Abhängigkeit). `null`, wenn es fehlt oder die Fassung den MCP-Einstieg
 * nicht hat.
 */
export function playwrightOrdner(): string | null {
  try {
    const ordner = dirname(createRequire(import.meta.url).resolve("playwright-core/package.json"));
    return existsSync(join(ordner, "lib", "entry", "mcp.js")) ? ordner : null;
  } catch {
    return null;
  }
}

/**
 * Den Browser-Server bauen: `node` des Knotens mit dem MCP-Einstieg von `playwright-core`, ohne Kopf, Profil nur im
 * Speicher, Chromium ohne eigene Sandbox (es liefe in unserer und dürfte darin keine Namensräume anlegen – seccomp).
 * Programme außerhalb von `/usr` kommen nur lesbar unter demselben Pfad hinein.
 */
export function playwrightMcp(o: { playwright: string; browser: string; node?: string; heim?: string }): McpServer {
  const node = o.node ?? process.execPath;
  for (const p of [o.playwright, o.browser, node]) if (!isAbsolute(p) || normalize(p) !== p) throw new Error("Pfad ungültig");
  // Programme unter /usr sieht die Sandbox schon; sonst ihr Ordner (Chrome: alles neben der Datei, Node: das Präfix)
  const heim = o.heim ?? homedir();
  const nurLesbar = [
    { quelle: o.playwright, ziel: PLAYWRIGHT_IN_SANDBOX },
    ...(o.browser.startsWith("/usr/") ? [] : lesbarerOrdner(dirname(o.browser), heim)),
    ...(node.startsWith("/usr/") ? [] : lesbarerOrdner(dirname(dirname(node)), heim)),
    ...schriften(),
  ];
  return {
    name: "browser",
    befehl: node,
    argumente: [
      join(PLAYWRIGHT_IN_SANDBOX, "lib", "entry", "mcp.js"),
      "--headless", "--isolated", "--no-sandbox", "--executable-path", o.browser, "--output-dir", AUSGABE_IN_SANDBOX,
    ],
    werkzeuge: PLAYWRIGHT_WERKZEUGE,
    nurLesbar,
  };
}

/**
 * Den Kiwix-Server für den Motor bauen (VKd2a): `node` des Knotens mit der Brücke, `kiwix-serve` und den ZIM-Dateien aus
 * `mcp.json` – deren Ordner nur lesbar unter demselben Pfad (`mcpAusDatei()` hat sie schon geprüft: absolut, nie die
 * Wurzel, das Home oder ~/.freedom). Der Motor bekommt genau die Werkzeuge der Brücke: suchen und lesen.
 */
function kiwixMcp(o: { zim: readonly string[]; kiwixServe: string; node?: string; heim?: string }): McpServer {
  const node = o.node ?? process.execPath;
  for (const p of [o.kiwixServe, node, ...o.zim]) if (!isAbsolute(p) || normalize(p) !== p) throw new Error("Pfad ungültig");
  const heim = o.heim ?? homedir();
  const nurLesbar = [
    { quelle: dirname(KIWIX_BRUECKE), ziel: KIWIX_IN_SANDBOX },
    ...[...new Set(o.zim.map((z) => dirname(z)))].flatMap((d) => lesbarerOrdner(d, heim)),
    ...(o.kiwixServe.startsWith("/usr/") ? [] : lesbarerOrdner(dirname(o.kiwixServe), heim)),
    ...(node.startsWith("/usr/") ? [] : lesbarerOrdner(dirname(dirname(node)), heim)),
  ];
  return {
    name: "kiwix",
    befehl: node,
    argumente: [join(KIWIX_IN_SANDBOX, "kiwix-bruecke.mjs"), o.kiwixServe, ...o.zim],
    werkzeuge: KIWIX_WERKZEUGE.map((w) => w.name),
    nurLesbar,
  };
}

/**
 * Die Jupyter-Brücke für den Motor (VKk2a): `node` des Knotens, das Projekt als Wurzel – geschrieben wird nur dort, wo
 * die Sandbox ohnehin schreiben darf. Der Motor bekommt genau die Werkzeuge der Brücke.
 */
export function jupyterMcp(o: { node?: string; heim?: string; ausfuehren?: boolean } = {}): McpServer {
  const node = o.node ?? process.execPath;
  if (!isAbsolute(node) || normalize(node) !== node) throw new Error("Pfad ungültig");
  return {
    name: "jupyter",
    befehl: node,
    argumente: [join(JUPYTER_IN_SANDBOX, basename(JUPYTER_BRUECKE)), "/arbeit", ...(o.ausfuehren ? [`--ausfuehren=${NOTEBOOK_AUSFUEHREN_IN_SANDBOX}`] : [])],
    werkzeuge: JUPYTER_WERKZEUGE.map((w) => w.name),
    beimFragen: ["notebook_read"],
    nurLesbar: [
      { quelle: dirname(JUPYTER_BRUECKE), ziel: JUPYTER_IN_SANDBOX },
      ...(node.startsWith("/usr/") ? [] : lesbarerOrdner(dirname(dirname(node)), o.heim ?? homedir())),
    ],
  };
}

/**
 * Aus der Umgebung (nur mit Vibecoden):
 * - `MCP_BROWSER` – Pfad zu Chromium oder Chrome, `aus` schaltet den Browser ab; ohne Angabe sucht der Knoten in
 *   `BROWSER_ORTE`.
 * - `MCP_KIWIX` – nur `aus`: Die ZIM-Dateien (`zim`) kommen aus `mcp.json` (B-31b); stehen dort welche, bekommt der Motor
 *   Kiwix von selbst.
 * - `MCP_JUPYTER` – nur `aus`: Die Jupyter-Brücke braucht nichts außer Node, der Motor bekommt sie von selbst; ohne
 *   Kernel (`notebooks`, sonst `notebooksAusfuehrbar()`) liest und ändert er Notebooks nur.
 *
 * Eine Angabe, die nicht stimmt, heißt kein Start (`ungueltig`); fehlt nur etwas, läuft der Motor ohne den Server (`fehlt`).
 */
export function mcpAusUmgebung(
  env: { MCP_BROWSER?: string; MCP_KIWIX?: string; MCP_JUPYTER?: string },
  o: { playwright?: string | null; orte?: readonly string[]; zim?: readonly string[]; kiwixServe?: string; node?: string; heim?: string; notebooks?: boolean } = {},
): { server: McpServer[]; fehlt: McpFehlt[] } | { ungueltig: string } {
  const ohneJupyter = katalogOhneJupyter(env, o);
  if ("ungueltig" in ohneJupyter) return ohneJupyter;
  const jupyter = env.MCP_JUPYTER?.trim();
  if (jupyter === "aus") return ohneJupyter;
  if (jupyter) return { ungueltig: "MCP_JUPYTER kennt nur „aus“" };
  const ausfuehren = o.notebooks ?? notebooksAusfuehrbar();
  try {
    const s = jupyterMcp({ ...(o.node ? { node: o.node } : {}), ...(o.heim ? { heim: o.heim } : {}), ausfuehren });
    return { server: [...ohneJupyter.server, s], fehlt: [...ohneJupyter.fehlt, ...(ausfuehren ? [] : ["mcp.jupyter-kernel-fehlt" as const])] };
  } catch {
    return { ungueltig: "Node liegt direkt im Home oder in der Wurzel – die Sandbox bekäme zu viel zu sehen (Jupyter)" };
  }
}

function katalogOhneJupyter(
  env: { MCP_BROWSER?: string; MCP_KIWIX?: string },
  o: { playwright?: string | null; orte?: readonly string[]; zim?: readonly string[]; kiwixServe?: string; node?: string; heim?: string },
): { server: McpServer[]; fehlt: McpFehlt[] } | { ungueltig: string } {
  const browser = browserWahl(env, o);
  if ("ungueltig" in browser) return browser;
  const kiwix = env.MCP_KIWIX?.trim();
  if (kiwix && kiwix !== "aus") return { ungueltig: "MCP_KIWIX kennt nur „aus“ – die ZIM-Dateien stehen in mcp.json" };
  const zim = [...new Set(o.zim ?? [])];
  if (kiwix === "aus" || zim.length === 0) return browser;
  const kiwixServe = o.kiwixServe ?? KIWIX_SERVE;
  if (!istDatei(kiwixServe)) return { server: browser.server, fehlt: [...browser.fehlt, "mcp.kiwix-fehlt"] };
  try {
    return { server: [...browser.server, kiwixMcp({ zim, kiwixServe, ...(o.node ? { node: o.node } : {}), ...(o.heim ? { heim: o.heim } : {}) })], fehlt: browser.fehlt };
  } catch {
    return { ungueltig: "Node, kiwix-serve oder eine ZIM-Datei liegen direkt im Home oder in der Wurzel – die Sandbox bekäme zu viel zu sehen (Kiwix)" };
  }
}

function browserWahl(env: { MCP_BROWSER?: string }, o: { playwright?: string | null; orte?: readonly string[] }):
  { server: McpServer[]; fehlt: McpFehlt[] } | { ungueltig: string } {
  const wahl = env.MCP_BROWSER?.trim();
  if (wahl === "aus") return { server: [], fehlt: [] };
  if (wahl && (!isAbsolute(wahl) || normalize(wahl) !== wahl || !istDatei(wahl))) return { ungueltig: "MCP_BROWSER muss der absolute Pfad zu Chromium sein (oder „aus“)" };
  const playwright = o.playwright === undefined ? playwrightOrdner() : o.playwright;
  const browser = wahl || (o.orte ?? BROWSER_ORTE).find(istDatei);
  const fehlt: McpFehlt[] = [];
  if (!playwright) fehlt.push("mcp.playwright-fehlt");
  if (!browser) fehlt.push("mcp.browser-fehlt");
  if (!playwright || !browser) return { server: [], fehlt };
  try {
    return { server: [playwrightMcp({ playwright, browser })], fehlt };
  } catch {
    return { ungueltig: "Browser oder Node liegen direkt im Home oder in der Wurzel – die Sandbox bekäme zu viel zu sehen (MCP_BROWSER)" };
  }
}

/** Ein Programm außerhalb von `/usr` braucht seinen Ordner – nie die Wurzel, das Home oder etwas darüber: Darin läge ~/.freedom mit dem Schlüssel des Knotens. */
function lesbarerOrdner(ordner: string, heim: string): Array<{ quelle: string; ziel: string }> {
  if (ordner === "/" || heim === ordner || heim.startsWith(`${ordner}/`)) throw Object.assign(new Error("Ordner zu weit"), { name: "OrdnerZuWeit" });
  return [{ quelle: ordner, ziel: ordner }];
}

/** Schriften: ohne die Einstellungen von fontconfig zeigte der Browser keine Buchstaben (nichts Geheimes darin). */
function schriften(): Array<{ quelle: string; ziel: string }> {
  return existsSync("/etc/fonts") ? [{ quelle: "/etc/fonts", ziel: "/etc/fonts" }] : [];
}

/** Was eine Sandbox vom Browser lesen muss – für Chromium im Bild (VKg2c1, `bildstrom.ts`), wie beim Motor. */
export function browserLesbar(browser: string, heim = homedir()): Array<{ quelle: string; ziel: string }> {
  if (!isAbsolute(browser) || normalize(browser) !== browser) throw new Error("Pfad ungültig");
  return [...(browser.startsWith("/usr/") ? [] : lesbarerOrdner(dirname(browser), heim)), ...schriften()];
}

/**
 * Der Browser aus der Umgebung – derselbe wie für den Motor: `MCP_BROWSER`, sonst der erste aus `BROWSER_ORTE`; null mit
 * `aus`, mit einem Pfad, der nicht stimmt, oder ohne Fund.
 */
export function browserAusUmgebung(env: { MCP_BROWSER?: string }, orte: readonly string[] = BROWSER_ORTE): string | null {
  const wahl = env.MCP_BROWSER?.trim();
  if (wahl === "aus") return null;
  if (wahl) return isAbsolute(wahl) && normalize(wahl) === wahl && istDatei(wahl) ? wahl : null;
  return orte.find(istDatei) ?? null;
}

function istDatei(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Feste Sätze fürs Log. */
export const MCP_TEXT: Record<McpFehlt, string> = {
  "mcp.playwright-fehlt": "Browser für den Motor fehlt: playwright-core ist nicht installiert (optionale Abhängigkeit) – der Motor läuft ohne",
  "mcp.browser-fehlt": "Browser für den Motor fehlt: kein Chromium gefunden (MCP_BROWSER) – der Motor läuft ohne",
  "mcp.kiwix-fehlt": "Kiwix für den Motor fehlt: kiwix-serve ist nicht installiert (Paket kiwix-tools) – der Motor läuft ohne",
  "mcp.jupyter-kernel-fehlt": "Notebooks ausführen fehlt: python3-ipykernel und python3-nbclient sind nicht installiert – der Motor liest und ändert Notebooks nur",
};

/** Der Eintrag für `mcp_servers` in `config.yaml` (Hermes 0.19: `command`, `args`, `tools.include`). */
export function hermesMcpEintrag(s: McpServer): Record<string, unknown> {
  return {
    command: s.befehl, args: s.argumente, env: {},
    tools: { include: [...s.werkzeuge], resources: false, prompts: false },
    timeout: 120, connect_timeout: 60,
  };
}
