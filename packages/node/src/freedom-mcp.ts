/**
 * Freedom-MCP (VKd, `docs/VIBECODEN-ENTWURF.md`: „Freedom statt Nous Portal“): Werkzeuge des Knotens für den Motor in der
 * Sandbox als MCP-Server – erreichbar nur über die Brücke (`modell-bruecke.ts`, `POST /mcp`), nie über ein Netz. Schlank und
 * ohne Abhängigkeit (Vorschlag MC1-Größe B): Streamable HTTP nach MCP 2025-06-18 mit JSON-Antworten – `initialize`, `ping`,
 * `tools/list`, `tools/call`; Benachrichtigungen bekommen 202, ein Strom vom Server (GET) gibt es nicht.
 *
 * Ausgeführt wird nur über die `ToolRegistry` (Grenzen aus `WERKZEUG_GRENZEN`, Netz nur über `safeFetch`): heute Websuche und
 * Seite lesen. Bilder und Sprache kommen dazu, wenn der Knoten sie hat; Kiwix bekommt der Motor seit VKd2a als eigenen
 * Server aus dem Katalog (`mcp-katalog.ts`, in seiner Sandbox). Was durchfließt, ist Inhalt des eigenen Projekts: nie ins Log.
 *
 * Gefragt wird nie (VKd-W1, MENSCH 18.10.: „wie Claude und OpenAI“). Lesen darf der Motor nur Adressen, die im Auftrag
 * standen oder die eine Suche geliefert hat – die Regel von `web_fetch` bei Claude (seit Juli 2026 ohne Links aus schon
 * gelesenen Seiten). Eine Adresse, die sich der Agent selbst baut, etwa mit Inhalt des Projekts in der Anfrage, liest er
 * nicht (`LeseFreigaben`).
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
  { name: "read_page", description: "Fetch a public web page through the owner's Freedom node and return its text (http or https, no private addresses, text only, size-limited). Only URLs that appear in the task or in web_search results can be read – not links found inside pages.", feld: "url", kind: KIND_DVM_BROWSER },
];

/** Höchstens so viele freigegebene Adressen – die ältesten fallen heraus. */
export const LESE_FREIGABEN_MAX = 500;

/** Eine Adresse vergleichbar machen: nur http und https, ohne Anker; sonst null. */
function adresse(roh: string): string | null {
  try {
    const u = new URL(roh);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

/** Adressen in einem Text – auch mit Klammern darin (Wikipedia), ohne Satzzeichen und Klammer am Ende. */
export function adressenIn(text: string): string[] {
  const aus: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'`\[\]{}]+/g)) {
    let s = m[0].replace(/[.,;:!?]+$/, "");
    while (s.endsWith(")") && s.split(")").length > s.split("(").length) s = s.slice(0, -1).replace(/[.,;:!?]+$/, "");
    const a = adresse(s);
    if (a) aus.push(a);
  }
  return aus;
}

/**
 * Welche Seiten der Motor lesen darf (VKd-W1): Adressen aus dem Auftrag des Besitzers (`ausAuftrag()`, aus `CodeLaeufe`)
 * und aus Ergebnissen der Suche (`ausSuche()`), genau so geschrieben. Nur im Speicher, je Knoten – alle Läufe gehören dem
 * Besitzer. Gelesene Seiten geben nichts frei.
 */
export class LeseFreigaben {
  private readonly erlaubt = new Set<string>();

  ausAuftrag(text: string): void { this.nimm(adressenIn(text)); }
  ausSuche(ergebnis: string): void { this.nimm(adressenIn(ergebnis)); }

  darf(roh: string): boolean {
    const a = adresse(roh.trim());
    return a !== null && this.erlaubt.has(a);
  }

  private nimm(liste: string[]): void {
    for (const a of liste) {
      this.erlaubt.delete(a);
      this.erlaubt.add(a);
      if (this.erlaubt.size > LESE_FREIGABEN_MAX) this.erlaubt.delete(this.erlaubt.values().next().value!);
    }
  }
}

type JsonRpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

const antwort = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const fehler = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const istId = (id: unknown): boolean => typeof id === "string" || (typeof id === "number" && Number.isSafeInteger(id));

/**
 * Eine Nachricht des Clients beantworten – `null` für Benachrichtigungen (dann 202 ohne Inhalt). Nur Einzelnachrichten: Seit
 * 2025-06-18 gibt es keine Stapel mehr. Wirft nie; Fehler der Werkzeuge stehen im Ergebnis (`isError`), nie mit Text von außen
 * im Log.
 */
export async function mcpAntwort(nachricht: unknown, werkzeuge: Pick<ToolRegistry, "run">, freigaben: LeseFreigaben): Promise<object | null> {
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
      if (w.name === "read_page" && !freigaben.darf(eingabe)) {
        return antwort(m.id, { content: [{ type: "text", text: "not allowed: read_page only reads URLs from the task or from web_search results" }], isError: true });
      }
      const r = await werkzeuge.run({ kind: w.kind, name: w.name, input: eingabe }).catch((e: unknown) => ({ ok: false, output: `error: ${(e as Error).name}` }));
      if (w.name === "web_search" && r.ok) freigaben.ausSuche(r.output);
      return antwort(m.id, { content: [{ type: "text", text: r.output }], isError: !r.ok });
    }
    default:
      return fehler(m.id, -32601, "method not found");
  }
}
