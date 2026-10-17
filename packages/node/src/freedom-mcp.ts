/**
 * Freedom-MCP (VKd, `docs/VIBECODEN-ENTWURF.md`: „Freedom statt Nous Portal“): Werkzeuge des Knotens für den Motor in der
 * Sandbox als MCP-Server – erreichbar nur über die Brücke (`modell-bruecke.ts`, `POST /mcp`), nie über ein Netz. Schlank und
 * ohne Abhängigkeit (Vorschlag MC1-Größe B): Streamable HTTP nach MCP 2025-06-18 mit JSON-Antworten – `initialize`, `ping`,
 * `tools/list`, `tools/call`; Benachrichtigungen bekommen 202, ein Strom vom Server (GET) gibt es nicht.
 *
 * Ausgeführt wird nur über die `ToolRegistry` (Grenzen aus `WERKZEUG_GRENZEN`, Netz nur über `safeFetch`): heute Websuche und
 * Seite lesen. Bilder, Sprache und Kiwix kommen dazu, wenn der Knoten sie hat. Was durchfließt, ist Inhalt des eigenen
 * Projekts: nie ins Log.
 */
import { KIND_DVM_BROWSER, KIND_DVM_WEB_SEARCH } from "@freedomstack/protocol";
import { WERKZEUG_GRENZEN, type ToolRegistry } from "./tools.js";

/** Fassungen von MCP, die der Server spricht – die neueste zuletzt. */
export const MCP_FASSUNGEN = ["2024-11-05", "2025-03-26", "2025-06-18"] as const;

interface Werkzeug {
  name: string;
  description: string;
  feld: string;
  kind: number;
}

/** Namen und Beschreibungen sind Text für das Modell (englisch, wie die Werkzeuge von Hermes). */
const WERKZEUGE: readonly Werkzeug[] = [
  { name: "web_search", description: "Search the web through the owner's Freedom node (DuckDuckGo instant answers only, no result lists). Returns a short answer with its source.", feld: "query", kind: KIND_DVM_WEB_SEARCH },
  { name: "read_page", description: "Fetch a public web page through the owner's Freedom node and return its text (http or https, no private addresses, text only, size-limited).", feld: "url", kind: KIND_DVM_BROWSER },
];

type JsonRpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

const antwort = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const fehler = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const istId = (id: unknown): boolean => typeof id === "string" || (typeof id === "number" && Number.isSafeInteger(id));

/**
 * Eine Nachricht des Clients beantworten – `null` für Benachrichtigungen (dann 202 ohne Inhalt). Nur Einzelnachrichten: Seit
 * 2025-06-18 gibt es keine Stapel mehr. Wirft nie; Fehler der Werkzeuge stehen im Ergebnis (`isError`), nie mit Text von außen
 * im Log.
 */
export async function mcpAntwort(nachricht: unknown, werkzeuge: Pick<ToolRegistry, "run">): Promise<object | null> {
  if (typeof nachricht !== "object" || nachricht === null || Array.isArray(nachricht)) return fehler(null, -32600, "invalid request");
  const m = nachricht as JsonRpc;
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") return fehler(m.id, -32600, "invalid request");
  if (m.id === undefined) return null;
  if (!istId(m.id)) return fehler(null, -32600, "invalid request");
  const p = (typeof m.params === "object" && m.params !== null ? m.params : {}) as Record<string, unknown>;
  switch (m.method) {
    case "initialize": {
      const gewuenscht = p.protocolVersion;
      const fassung = (MCP_FASSUNGEN as readonly unknown[]).includes(gewuenscht) ? gewuenscht : MCP_FASSUNGEN.at(-1);
      return antwort(m.id, { protocolVersion: fassung, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "freedom-knoten", version: "1" } });
    }
    case "ping":
      return antwort(m.id, {});
    case "tools/list":
      return antwort(m.id, {
        tools: WERKZEUGE.map((w) => ({
          name: w.name, description: w.description,
          inputSchema: { type: "object", properties: { [w.feld]: { type: "string", maxLength: WERKZEUG_GRENZEN.eingabeZeichen } }, required: [w.feld], additionalProperties: false },
        })),
      });
    case "tools/call": {
      const w = WERKZEUGE.find((x) => x.name === p.name);
      if (!w) return fehler(m.id, -32602, "unknown tool");
      const args = (typeof p.arguments === "object" && p.arguments !== null ? p.arguments : {}) as Record<string, unknown>;
      const eingabe = args[w.feld];
      if (typeof eingabe !== "string" || eingabe.trim() === "") return fehler(m.id, -32602, `${w.feld} missing`);
      const r = await werkzeuge.run({ kind: w.kind, name: w.name, input: eingabe }).catch((e: unknown) => ({ ok: false, output: `error: ${(e as Error).name}` }));
      return antwort(m.id, { content: [{ type: "text", text: r.output }], isError: !r.ok });
    }
    default:
      return fehler(m.id, -32601, "method not found");
  }
}
