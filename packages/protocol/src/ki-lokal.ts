/**
 * KI auf diesem Gerät (Sammlung Neuordnung, B-1).
 *
 * Die App fragt ein Modell auf dem eigenen Rechner direkt – über die
 * OpenAI-kompatible Schnittstelle (`/v1/models`, `/v1/chat/completions`), die
 * Ollama, llama.cpp und LM Studio anbieten. Kein Relay, kein Provider, keine
 * Zahlung, kein Nostr-Event.
 *
 * Damit das stimmt, nimmt die App nur Adressen dieses Rechners an
 * (`localhost`, `127.0.0.1`, `[::1]`). Ein Modell im Heimnetz oder im
 * Internet ist nicht „dieses Gerät“ – dafür gibt es später „Mein Knoten“.
 * Alles, was vom Modell zurückkommt, ist Fremdtext: nur geprüft und begrenzt
 * weitergeben, anzeigen nur als Text.
 */

/** Ollama hört hier; llama.cpp und LM Studio nennen ihren Port selbst. */
export const LOKAL_STANDARD_ADRESSE = "http://localhost:11434";
/** Mehr Modelle zeigt die Auswahl nicht. */
export const LOKAL_MAX_MODELLE = 50;
/** Länge einer Antwort, die die App annimmt (Zeichen). */
export const LOKAL_MAX_ANTWORT = 100_000;
/** So viele Tokens darf das Modell höchstens erzeugen. */
export const LOKAL_MAX_TOKENS = 1024;

const DIESER_RECHNER = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MODELL = /^[A-Za-z0-9._:/@+-]{1,200}$/;

/** Anweisung an das Modell – verhindert, dass es in ein fremdes Format verfällt. */
const ANWEISUNG = "You are a helpful assistant. Answer the user's question directly and concisely in their language. Do not output JSON, quizzes, or structured formats unless asked. Just answer the question.";

export interface LokalesModell {
  name: string;
}

/**
 * Die Adresse eines Modells auf diesem Rechner, als Ursprung
 * (`http://localhost:11434`) – oder undefined, wenn sie woanders hinzeigt,
 * Zugangsdaten trägt oder kein http(s) ist.
 */
export function lokaleKiAdresse(roh: string): string | undefined {
  let u: URL;
  try {
    u = new URL(roh.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  if (u.username || u.password) return undefined;
  if (!DIESER_RECHNER.has(u.hostname.toLowerCase())) return undefined;
  return u.origin;
}

/** Gültiger Modellname – Fremdtext, deshalb eng. */
export function istLokalerModellname(name: unknown): name is string {
  return typeof name === "string" && MODELL.test(name);
}

/** Wo die App die Modelle abfragt – nur für eine Adresse dieses Rechners. */
export function lokaleModellListe(adresse: string): string | undefined {
  const a = lokaleKiAdresse(adresse);
  return a ? `${a}/v1/models` : undefined;
}

/** Die Modelle aus der Antwort von `/v1/models` – nur gültige Namen, ohne Doppelte, begrenzt. */
export function leseLokaleModelle(json: unknown): LokalesModell[] {
  const daten = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(daten)) return [];
  const namen = new Set<string>();
  for (const m of daten) {
    const id = (m as { id?: unknown } | null)?.id;
    if (istLokalerModellname(id)) namen.add(id);
    if (namen.size >= LOKAL_MAX_MODELLE) break;
  }
  return [...namen].map((name) => ({ name }));
}

/**
 * Die Anfrage an das Modell: Adresse und Inhalt. undefined, wenn die Adresse
 * nicht auf diesem Rechner liegt oder der Modellname ungültig ist – dann geht
 * nichts hinaus.
 */
export function lokaleKiAnfrage(p: { adresse: string; modell: string; frage: string; maxTokens?: number }): { url: string; body: string } | undefined {
  const a = lokaleKiAdresse(p.adresse);
  if (!a || !istLokalerModellname(p.modell) || typeof p.frage !== "string" || p.frage.length === 0) return undefined;
  const maxTokens = Number.isSafeInteger(p.maxTokens) && p.maxTokens! > 0 ? Math.min(p.maxTokens!, LOKAL_MAX_TOKENS) : LOKAL_MAX_TOKENS;
  return {
    url: `${a}/v1/chat/completions`,
    body: JSON.stringify({
      model: p.modell,
      messages: [{ role: "system", content: ANWEISUNG }, { role: "user", content: p.frage }],
      stream: false,
      max_tokens: maxTokens,
    }),
  };
}

const zahl = (x: unknown): number => (Number.isSafeInteger(x) && (x as number) >= 0 ? (x as number) : 0);

/** Die Antwort des Modells – Text begrenzt, Zählwerte nur als ganze Zahlen; undefined ohne Text. */
export function leseLokaleAntwort(json: unknown): { text: string; modell?: string; promptTokens: number; completionTokens: number } | undefined {
  const d = json as { choices?: Array<{ message?: { content?: unknown } }>; model?: unknown; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | null;
  const inhalt = Array.isArray(d?.choices) ? d!.choices[0]?.message?.content : undefined;
  if (typeof inhalt !== "string" || inhalt.length === 0) return undefined;
  return {
    text: inhalt.slice(0, LOKAL_MAX_ANTWORT),
    ...(istLokalerModellname(d!.model) ? { modell: d!.model } : {}),
    promptTokens: zahl(d!.usage?.prompt_tokens),
    completionTokens: zahl(d!.usage?.completion_tokens),
  };
}
