/**
 * Lokaler Chat-Fallback (App-Seite, Browser):
 * Wenn kein Netzwerk-Provider antwortet, fuehrt die App Tools (web_search)
 * + Inferenz LOKAL aus — direkt gegen ein erreichbares Ollama. So funktioniert
 * der Chat sofort, auch ohne Relay/Provider im Netz.
 *
 * WICHTIG: Das ist ein Convenience-Fallback fuer die Demo/eigenes Geraet.
 * Im dezentralen Modus laufen Tools+Inferenz beim PROVIDER (non-custodial).
 * Lokal heisst: der eigene Browser redet mit dem eigenen Ollama.
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

/** So viel liest ein lokales Werkzeug hoechstens von einer Antwort. */
export const LOKAL_MAX_BYTES = 1_000_000;

/** Darf das lokale Browser-Werkzeug dieses Ziel abrufen? Grund oder null. */
export function lokalesZielVerboten(roh: string): string | null {
  let u: URL;
  try {
    u = new URL(roh.trim());
  } catch {
    return "keine gültige URL";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "nur http und https";
  if (u.username || u.password) return "keine Zugangsdaten in der URL";
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return "lokales Ziel";
  // IP-Adressen (auch IPv6 mit eingebetteter IPv4, wie new URL sie schreibt) wie im Knoten pruefen
  if ((/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) && isPrivateAddress(h)) return "private Adresse";
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
      "keine Instant-Answer gefunden — versuche eine spezifischere Frage";
    return { name: "web_search", kind, output: out, ok: true };
  } catch (e) {
    return { name: "web_search", kind, output: `web_search fehler: ${(e as Error).message}`, ok: false };
  }
}

/** browser_use lokal: HTTP-Fetch + Text-Extraktion. (CORS kann blockieren.) */
export async function localBrowserFetch(url: string, timeoutMs = 9000): Promise<LocalToolOutcome> {
  const kind = 5062;
  try {
    const verboten = lokalesZielVerboten(url);
    if (verboten) throw new Error(`Abruf abgelehnt: ${verboten}`);
    const res = await fetch(url.trim(), { signal: AbortSignal.timeout(timeoutMs), credentials: "omit", redirect: "error" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const typ = (res.headers.get("content-type") ?? "").toLowerCase();
    if (typ && !/^(text\/|application\/(json|xml|xhtml\+xml))/.test(typ)) throw new Error(`kein Text (${typ.split(";")[0]})`);
    const html = await leseText(res);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { name: "browser_use", kind, output: text.slice(0, 3000), ok: true };
  } catch (e) {
    return { name: "browser_use", kind, output: `browser fehler (ggf. CORS): ${(e as Error).message}`, ok: false };
  }
}

/** Fuehrt die angeforderten Tools lokal aus und gibt Kontext + Ergebnisse. */
export async function runLocalTools(
  tools: Array<{ kind: number; name: string; input: string }>,
): Promise<{ context: string; outcomes: LocalToolOutcome[] }> {
  const outcomes: LocalToolOutcome[] = [];
  let context = "";
  for (const t of tools) {
    let o: LocalToolOutcome;
    if (t.kind === 5060) o = await localWebSearch(t.input);
    else if (t.kind === 5062) o = await localBrowserFetch(t.input);
    else o = { name: t.name, kind: t.kind, output: `${t.name} lokal nicht verfuegbar`, ok: false };
    outcomes.push(o);
    context += `\n[Tool ${o.name} Ergebnis]:\n${o.output}\n`;
  }
  return { context, outcomes };
}

export interface LocalInferenceResult {
  output: string;
  model: string;
  completionTokens: number;
  promptTokens: number;
}

/** Lokale Inferenz gegen Ollama (OpenAI-kompatibel /api/chat mit History). */
export async function localInfer(
  ollamaUrl: string,
  model: string,
  prompt: string,
  timeoutMs = 60_000,
): Promise<LocalInferenceResult> {
  // /api/chat mit system-prompt (ueberschreibt das modell-template — verhindert
  // dass das modell in ein domain-template faellt, z.B. Nostr/DVM-fakten).
  const res = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a helpful assistant. Answer the user's question directly and concisely in their language. Do not output JSON, quizzes, or structured formats unless asked. Just answer the question." },
        { role: "user", content: prompt },
      ],
      stream: false,
      options: { num_predict: 512 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const d = (await res.json()) as { message?: { content?: string }; eval_count?: number; prompt_eval_count?: number };
  return {
    output: d.message?.content ?? "",
    model,
    completionTokens: d.eval_count ?? 0,
    promptTokens: d.prompt_eval_count ?? 0,
  };
}

/** Prueft, ob ein lokales Ollama erreichbar ist. */
export async function localOllamaUp(ollamaUrl: string, timeoutMs = 3000): Promise<boolean> {
  try {
    const r = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch { return false; }
}
