/**
 * Modellkataloge in der App (Schritt 5.7 mit 8.8): welche Kataloge der Nutzer
 * abonniert hat und wie ein eigener Katalog eingegeben wird.
 *
 * Voreingestellt ist kein Katalog – die Auswahl trifft der Nutzer. Die App holt
 * alle Kataloge und filtert selbst; die Relays erfahren so nicht, welche
 * abonniert sind.
 */
import { leseKatalogAdresse, type KatalogEintrag, type ModellKatalog } from "@freedomstack/protocol";
import { t } from "./i18n.js";

export const LS_KATALOGE = "freedom.kataloge";
export const ABOS_MAX = 20;

/** Abonnierte Katalog-Adressen aus dem Speicher – Unbrauchbares fällt weg. */
export function leseAbos(roh: string | null): string[] {
  let liste: unknown;
  try {
    liste = JSON.parse(roh ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(liste)) return [];
  const gut = liste.filter((a): a is string => typeof a === "string" && leseKatalogAdresse(a) !== null);
  return [...new Set(gut)].slice(0, ABOS_MAX);
}

export function mitAbo(abos: readonly string[], adresse: string): string[] {
  if (leseKatalogAdresse(adresse) === null) throw new Error(t("agent.keineKatalogAdresse"));
  if (abos.includes(adresse)) return [...abos];
  if (abos.length >= ABOS_MAX) throw new Error(t("agent.hoechstensKataloge", { n: ABOS_MAX }));
  return [...abos, adresse];
}

export function ohneAbo(abos: readonly string[], adresse: string): string[] {
  return abos.filter((a) => a !== adresse);
}

/** In wie vielen abonnierten Katalogen steht ein Modell? (Schlüssel: Kleinschreibung) */
export function katalogRang(kataloge: readonly ModellKatalog[]): Map<string, number> {
  const rang = new Map<string, number>();
  for (const k of kataloge) for (const e of k.modelle) rang.set(e.modell.toLowerCase(), (rang.get(e.modell.toLowerCase()) ?? 0) + 1);
  return rang;
}

/**
 * Eigene Eingabe: Modelle getrennt durch „;“ oder Zeilen, je Modell optional
 * eine Notiz dahinter („qwen3.5:9b gut für Code; llama3.2:3b“) – ein
 * `prompt()` kennt keine Zeilenumbrüche.
 */
export function leseKatalogEingabe(eingabe: string): KatalogEintrag[] {
  return eingabe.split(/[\n;]/).map((z) => z.trim()).filter(Boolean).map((z) => {
    const [modell, ...rest] = z.split(/\s+/);
    const notiz = rest.join(" ");
    return notiz ? { modell: modell!, notiz } : { modell: modell! };
  });
}

/** Kennung (`d`) für einen neuen Katalog aus dem Titel. */
export function katalogKennung(titel: string): string {
  const d = titel.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return d || "katalog";
}
