/**
 * Text aus Sprache auf diesem Gerät (Sammlung B-38c3, SP-W1 A, `docs/SPRACHE-ENTWURF.md` V2), ohne DOM: ein
 * `whisper-server` (whisper.cpp) auf diesem Rechner – nur Adressen aus `lokaleKiAdresse()` (localhost, 127.0.0.1, [::1]).
 * Der Ton geht als WAV in der Form von `baueWav()` dorthin und sonst nirgends hin: kein Relay, kein Knoten.
 *
 * Gefragt wird erst, wenn der Nutzer die Adresse in den Einstellungen prüft – Browser fragen beim ersten Zugriff auf den
 * eigenen Rechner um Erlaubnis. Gemerkt wird nur die geprüfte Adresse (nicht geheim, `localStorage`).
 */
import { SPRACHE_GRENZEN, lokaleKiAdresse, type SpracheWahl } from "@freedomstack/protocol";
import { t } from "./i18n.js";

export const LS_SPRACHE_LOKAL = "freedom.sprache.lokal";
/** Vorgabe von `whisper-server` (`--host 127.0.0.1 --port 8080`). */
export const SPRACHE_LOKAL_STANDARD = "http://127.0.0.1:8080";
/** Auf der CPU dauert ein langer Ton – Zeit lassen wie bei lokaler KI. */
export const SPRACHE_LOKAL_ZEIT_MS = 180_000;

type Holen = (url: string, init?: RequestInit) => Promise<Response>;
const holenStandard: Holen = (u, i) => fetch(u, i);

/** Die gemerkte Adresse – nur eine dieses Rechners; sonst null (dann gibt es „Dieses Gerät“ nicht). */
export function lokaleSprachAdresse(s: Pick<Storage, "getItem">): string | null {
  return lokaleKiAdresse(s.getItem(LS_SPRACHE_LOKAL) ?? "") ?? null;
}

/** Wie es um den Server steht: bereit, lädt noch sein Modell, nicht erreichbar oder keine Adresse dieses Rechners. */
export type SprachServerStand = "bereit" | "laedt" | "nicht-erreichbar" | "fremd";

/** Den Server fragen (`GET /health`) – nur auf Klick. */
export async function pruefeSprachServer(roh: string, holen: Holen = holenStandard, zeitMs = 4000): Promise<SprachServerStand> {
  const a = lokaleKiAdresse(roh);
  if (!a) return "fremd";
  try {
    const r = await holen(`${a}/health`, { signal: AbortSignal.timeout(zeitMs), credentials: "omit", cache: "no-store" });
    if (r.status === 503) return "laedt";
    const j = (await r.json().catch(() => null)) as { status?: unknown } | null;
    return r.ok && j?.status === "ok" ? "bereit" : "nicht-erreichbar";
  } catch {
    return "nicht-erreichbar";
  }
}

/** Die Antwort streng lesen (`response_format=json`: `{"text": …}`) – sonst null. Wie `leseTranskript()` begrenzt. */
export function leseSprachServerAntwort(j: unknown): string | null {
  if (typeof j !== "object" || j === null || Array.isArray(j)) return null;
  const { text } = j as Record<string, unknown>;
  if (typeof text !== "string" || text.length > SPRACHE_GRENZEN.textZeichen || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) return null;
  return text.trim();
}

/** Text aus einer WAV-Datei (Form aus `baueWav()`) vom Server auf diesem Rechner. Wirft mit einem Text für die Oberfläche. */
export async function textAufDiesemGeraet(p: {
  adresse: string; wav: Uint8Array; sprache: SpracheWahl; holen?: Holen; zeitMs?: number;
}): Promise<string> {
  const a = lokaleKiAdresse(p.adresse);
  if (!a) throw new Error(t("set.spracheLokalFremd"));
  const form = new FormData();
  form.append("file", new Blob([p.wav as BlobPart], { type: "audio/wav" }), "ton.wav");
  form.append("language", p.sprache);
  form.append("response_format", "json");
  let r: Response;
  try {
    r = await (p.holen ?? holenStandard)(`${a}/inference`, {
      method: "POST", body: form, signal: AbortSignal.timeout(p.zeitMs ?? SPRACHE_LOKAL_ZEIT_MS), credentials: "omit", cache: "no-store",
    });
  } catch {
    throw new Error(t("set.spracheLokalNichtErreichbar", { adresse: a }));
  }
  if (!r.ok) throw new Error(t("set.spracheLokalHttp", { status: r.status }));
  const text = leseSprachServerAntwort(await r.json().catch(() => null));
  if (text === null) throw new Error(t("komm.alsTextUnlesbarAntwort"));
  return text;
}
