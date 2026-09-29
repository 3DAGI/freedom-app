/**
 * KI auf diesem Gerät in der App (Sammlung Neuordnung, B-1), ohne DOM.
 *
 * In der Modellwahl steht neben den Modellen der Provider „Dieses Gerät“: ein
 * Modell auf dem eigenen Rechner (Ollama, llama.cpp, LM Studio). Die Frage
 * geht nur dorthin – kein Relay, kein Provider, keine Zahlung, kein Event.
 * Ist das Modell nicht erreichbar, sagt die App das; sie weicht nie still ins
 * Netz aus.
 *
 * Gesucht wird erst, wenn der Nutzer es verlangt: Browser fragen beim ersten
 * Zugriff auf den eigenen Rechner um Erlaubnis. Danach merkt sich die App
 * nur, dass gesucht werden darf, und die Adresse – beides ist nicht geheim
 * (`localStorage`, Präfix `freedom.`).
 */
import {
  LOKAL_STANDARD_ADRESSE, leseLokaleAntwort, leseLokaleModelle, lokaleKiAdresse, lokaleKiAnfrage, lokaleModellListe, type LokalesModell,
} from "@freedomstack/protocol";
import { t } from "./i18n.js";

export const LS_LOKAL_ADRESSE = "freedom.lokal.adresse";
export const LS_LOKAL_AKTIV = "freedom.lokal.aktiv";
/** So beginnt der Wert der Modellwahl für ein Modell auf diesem Gerät. */
export const LOKAL_PRAEFIX = "lokal:";
/** Lokale Modelle rechnen oft auf der CPU – Zeit lassen. */
export const LOKAL_ZEIT_MS = 180_000;

type Speicher = Pick<Storage, "getItem">;
type Holen = (url: string, init?: RequestInit) => Promise<Response>;
const holenStandard: Holen = (u, i) => fetch(u, i);

/** Die gemerkte Adresse – ungültige oder fremde fallen auf den Standard zurück. */
export function lokaleAdresse(s: Speicher): string {
  return lokaleKiAdresse(s.getItem(LS_LOKAL_ADRESSE) ?? "") ?? LOKAL_STANDARD_ADRESSE;
}

/** Adresse setzen – nur eine auf diesem Rechner; sonst undefined und nichts gemerkt. */
export function setzeLokaleAdresse(roh: string, s: Pick<Storage, "setItem">): string | undefined {
  const a = lokaleKiAdresse(roh);
  if (a) s.setItem(LS_LOKAL_ADRESSE, a);
  return a;
}

/** Hat der Nutzer die Suche schon einmal verlangt? Erst dann sucht die App beim Öffnen der Wahl. */
export function lokalAktiv(s: Speicher): boolean {
  return s.getItem(LS_LOKAL_AKTIV) === "1";
}

/** Der Wert der Modellwahl für ein Modell auf diesem Gerät. */
export function lokalerWahlwert(modell: string): string {
  return LOKAL_PRAEFIX + modell;
}

/** Das Modell auf diesem Gerät, wenn die Wahl eines ist. */
export function lokalesModellAus(wahl: string | undefined | null): string | undefined {
  return wahl?.startsWith(LOKAL_PRAEFIX) ? wahl.slice(LOKAL_PRAEFIX.length) || undefined : undefined;
}

/** Die Modelle auf diesem Rechner. Wirft mit einem Text für die Oberfläche, wenn nichts antwortet. */
export async function lokaleModelle(adresse: string, holen: Holen = holenStandard, zeitMs = 4000): Promise<LokalesModell[]> {
  const url = lokaleModellListe(adresse);
  if (!url) throw new Error(t("agent.lokalAdresseFremd"));
  let r: Response;
  try {
    r = await holen(url, { signal: AbortSignal.timeout(zeitMs), credentials: "omit", cache: "no-store" });
  } catch {
    throw new Error(t("agent.lokalNichtErreichbar", { adresse }));
  }
  if (!r.ok) throw new Error(t("agent.lokalHttp", { status: r.status }));
  return leseLokaleModelle(await r.json().catch(() => null));
}

/**
 * Eine Frage an das Modell auf diesem Rechner. Wirft mit einem Text für die
 * Oberfläche – nie still ins Netz. `signal` bricht ab (Knopf „Stopp“).
 */
export async function frageLokal(p: {
  adresse: string; modell: string; frage: string; signal?: AbortSignal; holen?: Holen; zeitMs?: number;
}): Promise<{ text: string; modell: string; promptTokens: number; completionTokens: number }> {
  const anfrage = lokaleKiAnfrage({ adresse: p.adresse, modell: p.modell, frage: p.frage });
  if (!anfrage) throw new Error(t("agent.lokalAdresseFremd"));
  const zeit = AbortSignal.timeout(p.zeitMs ?? LOKAL_ZEIT_MS);
  const signal = p.signal ? AbortSignal.any([p.signal, zeit]) : zeit;
  let r: Response;
  try {
    r = await (p.holen ?? holenStandard)(anfrage.url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: anfrage.body, signal, credentials: "omit", cache: "no-store",
    });
  } catch (e) {
    if (p.signal?.aborted) throw new Error(t("agent.lokalAbgebrochen"));
    if (zeit.aborted) throw new Error(t("agent.lokalZeit"));
    throw new Error(t("agent.lokalNichtErreichbar", { adresse: p.adresse }), { cause: e });
  }
  if (!r.ok) throw new Error(t("agent.lokalHttp", { status: r.status }));
  const antwort = leseLokaleAntwort(await r.json().catch(() => null));
  if (!antwort) throw new Error(t("agent.lokalLeer"));
  return { ...antwort, modell: antwort.modell ?? p.modell };
}
