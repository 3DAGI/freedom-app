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
 */
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize } from "node:path";

/** Ein MCP-Server für `mcp_servers` in `config.yaml` – Pfade so, wie die Sandbox sie sieht. */
export interface McpServer {
  name: string;
  befehl: string;
  argumente: string[];
  /** Nur diese Werkzeuge bekommt der Motor. */
  werkzeuge: readonly string[];
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

/** Was für den Browser-Server fehlt – ins Log nur diese Kennungen. */
export type McpFehlt = "mcp.playwright-fehlt" | "mcp.browser-fehlt";

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
  const nurLesbar = [{ quelle: o.playwright, ziel: PLAYWRIGHT_IN_SANDBOX }];
  // Programme unter /usr sieht die Sandbox schon; sonst ihr Ordner (Chrome: alles neben der Datei, Node: das Präfix) –
  // nie die Wurzel, das Home oder etwas darüber: Darin läge ~/.freedom mit dem Schlüssel des Knotens
  const heim = o.heim ?? homedir();
  for (const ordner of [o.browser.startsWith("/usr/") ? null : dirname(o.browser), node.startsWith("/usr/") ? null : dirname(dirname(node))]) {
    if (ordner === null) continue;
    if (ordner === "/" || heim === ordner || heim.startsWith(`${ordner}/`)) throw Object.assign(new Error("Ordner zu weit"), { name: "OrdnerZuWeit" });
    nurLesbar.push({ quelle: ordner, ziel: ordner });
  }
  // Schriften: ohne die Einstellungen von fontconfig zeigten Bildschirmfotos keine Buchstaben (nichts Geheimes darin)
  if (existsSync("/etc/fonts")) nurLesbar.push({ quelle: "/etc/fonts", ziel: "/etc/fonts" });
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
 * Aus der Umgebung (nur mit Vibecoden): `MCP_BROWSER` – Pfad zu Chromium oder Chrome, `aus` schaltet den Browser ab;
 * ohne Angabe sucht der Knoten in `BROWSER_ORTE`. Ein angegebener Pfad, der nicht stimmt, heißt kein Start (`ungueltig`);
 * fehlt nur etwas, läuft der Motor ohne den Server (`fehlt`).
 */
export function mcpAusUmgebung(env: { MCP_BROWSER?: string }, o: { playwright?: string | null; orte?: readonly string[] } = {}):
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
};

/** Der Eintrag für `mcp_servers` in `config.yaml` (Hermes 0.19: `command`, `args`, `tools.include`). */
export function hermesMcpEintrag(s: McpServer): Record<string, unknown> {
  return {
    command: s.befehl, args: s.argumente, env: {},
    tools: { include: [...s.werkzeuge], resources: false, prompts: false },
    timeout: 120, connect_timeout: 60,
  };
}
