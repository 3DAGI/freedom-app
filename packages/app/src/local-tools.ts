/**
 * Lokale Werkzeuge (App-Seite, Browser): Websuche und Seitenabruf direkt aus
 * dem Browser, ohne Provider. Das Modell auf diesem Gerät fragt seit B-1
 * `ki-lokal.ts` (Protokoll `ki-lokal.ts`) – nur Adressen dieses Rechners.
 *
 * SANDBOX/SSRF (8.7): Der Browser ist die Sandbox. browser_use ruft nur
 * oeffentliche http(s)-Ziele ab – keine Zugangsdaten in der URL, kein
 * localhost, keine privaten Adressen (Router, Ollama, Metadaten) –, liest
 * hoechstens `LOKAL_MAX_BYTES` und nur Text. Im Browser laesst sich ein Name
 * nicht aufloesen: ein oeffentlicher Name, der auf eine private Adresse zeigt,
 * faellt hier nicht auf (CORS verhindert meist das Lesen der Antwort).
 * Weiterleitungen folgt das lokale Werkzeug nicht – ihr Ziel liesse sich im
 * Browser nicht vorher pruefen.
 */
import { isPrivateAddress } from "@freedomstack/protocol";
import { t } from "./i18n.js";
import { fehlerText } from "./protokoll-texte.js";

/** So viel liest ein lokales Werkzeug hoechstens von einer Antwort. */
export const LOKAL_MAX_BYTES = 1_000_000;

/** Darf das lokale Browser-Werkzeug dieses Ziel abrufen? Grund oder null. */
export function lokalesZielVerboten(roh: string): string | null {
  let u: URL;
  try {
    u = new URL(roh.trim());
  } catch {
    return t("bau.urlUngueltig");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return t("bau.nurHttp");
  if (u.username || u.password) return t("bau.keineZugangsdaten");
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return t("bau.lokalesZiel");
  // IP-Adressen (auch IPv6 mit eingebetteter IPv4, wie new URL sie schreibt) wie im Knoten pruefen
  if ((/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) && isPrivateAddress(h)) return t("bau.privateAdresse");
  return null;
}

async function leseText(res: Response): Promise<string> {
  const leser = res.body?.getReader();
  if (!leser) return "";
  const teile: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    if (n + value.length > LOKAL_MAX_BYTES) {
      teile.push(value.subarray(0, LOKAL_MAX_BYTES - n));
      await leser.cancel().catch(() => undefined);
      break;
    }
    teile.push(value);
    n += value.length;
  }
  const dec = new TextDecoder();
  return teile.map((t) => dec.decode(t, { stream: true })).join("") + dec.decode();
}

export interface LocalToolOutcome {
  name: string;
  kind: number;
  output: string;
  ok: boolean;
}

/** web_search lokal im Browser: DuckDuckGo Instant Answer (CORS-offen). */
export async function localWebSearch(query: string, timeoutMs = 8000): Promise<LocalToolOutcome> {
  const kind = 5060;
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = JSON.parse(await leseText(res)) as { AbstractText?: string; AbstractURL?: string; Heading?: string; Answer?: string };
    const out =
      d.Answer ? `${d.Answer}` :
      d.AbstractText ? `${d.Heading ?? ""}: ${d.AbstractText} (${d.AbstractURL ?? ""})`.trim() :
      t("bau.keineAntwort");
    return { name: "web_search", kind, output: out, ok: true };
  } catch (e) {
    return { name: "web_search", kind, output: t("bau.sucheFehler", { fehler: fehlerText(e) }), ok: false };
  }
}

/** browser_use lokal: HTTP-Fetch + Text-Extraktion. (CORS kann blockieren.) */
export async function localBrowserFetch(url: string, timeoutMs = 9000): Promise<LocalToolOutcome> {
  const kind = 5062;
  try {
    const verboten = lokalesZielVerboten(url);
    if (verboten) throw new Error(t("bau.abrufAbgelehnt", { grund: verboten }));
    const res = await fetch(url.trim(), { signal: AbortSignal.timeout(timeoutMs), credentials: "omit", redirect: "error" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const typ = (res.headers.get("content-type") ?? "").toLowerCase();
    if (typ && !/^(text\/|application\/(json|xml|xhtml\+xml))/.test(typ)) throw new Error(t("bau.keinText", { typ: typ.split(";")[0] ?? "" }));
    const html = await leseText(res);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { name: "browser_use", kind, output: text.slice(0, 3000), ok: true };
  } catch (e) {
    return { name: "browser_use", kind, output: t("bau.browserFehler", { fehler: fehlerText(e) }), ok: false };
  }
}

/** Fuehrt die angeforderten Tools lokal aus und gibt Kontext + Ergebnisse. */
export async function runLocalTools(
  tools: Array<{ kind: number; name: string; input: string }>,
): Promise<{ context: string; outcomes: LocalToolOutcome[] }> {
  const outcomes: LocalToolOutcome[] = [];
  let context = "";
  for (const w of tools) {
    let o: LocalToolOutcome;
    if (w.kind === 5060) o = await localWebSearch(w.input);
    else if (w.kind === 5062) o = await localBrowserFetch(w.input);
    else o = { name: w.name, kind: w.kind, output: t("bau.lokalNicht", { name: w.name }), ok: false };
    outcomes.push(o);
    // Kontext für das Modell, nicht für die Oberfläche
    context += `\n[Tool ${o.name} Ergebnis]:\n${o.output}\n`; // kein UI-Text
  }
  return { context, outcomes };
}
