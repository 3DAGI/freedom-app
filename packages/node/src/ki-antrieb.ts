/**
 * KI-Antrieb des Knotens (Sammlung B-29a, Anhang E): Ollama wie bisher oder ein
 * Dienst mit OpenAI-kompatibler Schnittstelle – vLLM, SGLang, TensorFold. Ollama
 * arbeitet gleichzeitige Anfragen standardmäßig nacheinander ab; diese Dienste
 * bündeln sie. Welcher auf dem GX10 läuft, entscheidet eine Messung (MENSCH).
 *
 * Gewählt wird über die Umgebung:
 * - `KI_ANTRIEB=ollama` (Vorgabe): `OLLAMA_URL` wie bisher.
 * - `KI_ANTRIEB=openai`: `KI_URL` mit `/v1` (vLLM `http://127.0.0.1:8000/v1`,
 *   SGLang `…:30000/v1`, TensorFold `…:8080/v1`), dazu `KI_SCHLUESSEL`, wenn der
 *   Dienst einen verlangt (`--api-key`). Der Schlüssel geht nie ins Log.
 *
 * `KI_URL` zeigt nur auf diesen Rechner oder ins Heimnetz – ein Dienst im
 * Internet ist kein Antrieb: Die Fragen der Kunden gingen sonst an einen Dritten.
 * Ungültig → kein Start, nie still auf Ollama ausweichen.
 */
import { isPrivateAddress } from "@freedomstack/protocol";
import { ollamaTags } from "./modell-laden.js";
import { leseBegrenzt } from "./url-guard.js";

export type AntriebArt = "ollama" | "openai";
export interface KiAntrieb {
  art: AntriebArt;
  /** Ollama: Basis ohne Pfad; OpenAI-kompatibel: Basis mit `/v1`, ohne Schrägstrich am Ende. */
  url: string;
  /** Bearer-Schlüssel des Dienstes – nie ins Log, nie nach außen. */
  schluessel?: string;
}

/** Namen, die nur dieser Rechner oder das Heimnetz auflöst – ohne Punkt (Docker-Dienst) oder mit lokaler Endung. */
const LOKALE_ENDUNG = /\.(local|lan|internal|home\.arpa)$/;

/** Adresse eines Antriebs: http(s), ohne Zugangsdaten, nur dieser Rechner oder das Heimnetz – sonst undefined. */
export function lokaleAntriebAdresse(roh: string): string | undefined {
  let u: URL;
  try {
    u = new URL(roh.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  if (u.username || u.password || u.search || u.hash) return undefined;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const lokal = host === "localhost" || /^[0-9.]+$/.test(host) || host.includes(":")
    ? host === "localhost" || isPrivateAddress(host)
    : !host.includes(".") || LOKALE_ENDUNG.test(host);
  if (!lokal) return undefined;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

export function antriebAusUmgebung(env: { KI_ANTRIEB?: string; KI_URL?: string; KI_SCHLUESSEL?: string; OLLAMA_URL?: string }):
  { antrieb: KiAntrieb; grund?: undefined } | { antrieb?: undefined; grund: string } {
  const art = (env.KI_ANTRIEB || "ollama").trim().toLowerCase();
  if (art === "ollama") return { antrieb: { art: "ollama", url: (env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, "") } };
  if (art !== "openai") return { grund: "KI_ANTRIEB ist weder ollama noch openai" };
  const url = lokaleAntriebAdresse(env.KI_URL || "http://127.0.0.1:8000/v1");
  if (!url) return { grund: "KI_URL muss auf diesen Rechner oder ins Heimnetz zeigen (http, ohne Zugangsdaten)" };
  const schluessel = env.KI_SCHLUESSEL?.trim();
  return { antrieb: { art: "openai", url, ...(schluessel ? { schluessel } : {}) } };
}

/** Kopfzeilen für den OpenAI-kompatiblen Dienst – mit Schlüssel, wenn gesetzt. */
export function antriebKopf(a: Pick<KiAntrieb, "schluessel">): Record<string, string> {
  return { "content-type": "application/json", ...(a.schluessel ? { authorization: `Bearer ${a.schluessel}` } : {}) };
}

/** Grenzen für die Modellliste eines OpenAI-kompatiblen Dienstes – Fremdtext. */
const MODELLE_GRENZEN = { bytes: 256 * 1024, anzahl: 200, zeichen: 200 } as const;
const STEUERZEICHEN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** `/v1/models`: nur Kennungen als Namen, ohne Doppelte, begrenzt. */
export function leseOpenAiModelle(json: unknown): string[] {
  const daten = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(daten)) return [];
  const namen = daten.map((m) => (m as { id?: unknown } | null)?.id)
    .filter((n): n is string => typeof n === "string" && n.length >= 1 && n.length <= MODELLE_GRENZEN.zeichen && !STEUERZEICHEN.test(n));
  return [...new Set(namen)].slice(0, MODELLE_GRENZEN.anzahl);
}

/**
 * Welche Modelle der Antrieb jetzt kennt: Ollama mit Fingerabdruck (`/api/tags`),
 * ein OpenAI-kompatibler Dienst nur mit Namen (`/v1/models`, Fingerabdruck leer).
 */
export async function antriebModelle(a: KiAntrieb): Promise<Array<{ name: string; digest: string }>> {
  if (a.art === "ollama") return ollamaTags(a.url);
  const r = await fetch(`${a.url}/models`, { headers: antriebKopf(a), redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { name: "AntriebFehler" });
  const { text, abgeschnitten } = await leseBegrenzt(r, MODELLE_GRENZEN.bytes);
  if (abgeschnitten) throw Object.assign(new Error("Modellliste zu lang"), { name: "AntriebFehler" });
  return leseOpenAiModelle(JSON.parse(text)).map((name) => ({ name, digest: "" }));
}
