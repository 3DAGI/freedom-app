/**
 * Übersetzungen (8.16, Entscheidung MENSCH 27.09.2026: Variante B): Deutsch
 * und Englisch vollständig, die übrigen sechs Sprachen gibt es nicht mehr –
 * halb übersetzte Oberflächen versprachen mehr, als da war.
 *
 * Die Texte stehen je Bereich in `texte/*.ts`, jeder Schlüssel mit beiden
 * Sprachen (fehlt eine, meldet das der Compiler). In der Oberfläche über
 * `data-i18n` (Text), `data-i18n-ph` (Platzhalter), `data-i18n-title`
 * (Tooltip) und `data-i18n-aria` (aria-label), im Code über `t()`.
 * `app/test/i18n.test.ts` findet fehlende, unbenutzte und rohe Texte.
 */
import { rahmen } from "./texte/rahmen.js";
import { agent } from "./texte/agent.js";
import { kommunikation } from "./texte/kommunikation.js";
import { earn } from "./texte/earn.js";
import { profil } from "./texte/profil.js";
import { settings } from "./texte/settings.js";
import { einstieg } from "./texte/einstieg.js";
import { bausteine } from "./texte/bausteine.js";
import { datenschutz } from "./texte/datenschutz.js";
import { protokollsaetze } from "./texte/protokollsaetze.js";
import { pruefgruende } from "./texte/pruefgruende.js";
import { waehrung } from "./texte/waehrung.js";
import { zahlung } from "./texte/zahlung.js";
import { navigation } from "./texte/navigation.js";

export type Lang = "de" | "en";
export type Texte = Record<string, { de: string; en: string }>;

export const LANGS: Array<{ code: Lang; label: string }> = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
];

/** Je Bereich eine Datei – ein Schlüssel gehört genau einem Bereich (Test). */
export const BEREICHE: Record<string, Texte> = { rahmen, navigation, agent, kommunikation, waehrung, zahlung, earn, profil, settings, einstieg, bausteine, datenschutz, protokollsaetze, pruefgruende };
const TEXTE: Texte = Object.assign({}, ...Object.values(BEREICHE));

let current: Lang = "en";

export function setLang(l: Lang): void { current = l; }
export function getLang(): Lang { return current; }

/**
 * Text in der aktuellen Sprache; `{name}` wird aus `werte` eingesetzt. Ein
 * unbekannter Schlüssel erscheint als er selbst – sichtbar statt still leer.
 */
export function t(key: string, werte?: Record<string, string | number>): string {
  const s = TEXTE[key]?.[current] ?? key;
  return werte ? s.replace(/\{(\w+)\}/g, (m, n: string) => (n in werte ? String(werte[n]) : m)) : s;
}

/** Gebietsschema für Zahlen und Daten in der aktuellen Sprache. */
export const gebietsschema = (): string => (current === "de" ? "de-DE" : "en-US");

/** Browser-Sprache: Deutsch, wenn der Browser Deutsch bevorzugt, sonst Englisch. */
export function detectLang(sprache: string = typeof navigator !== "undefined" ? navigator.language : "en"): Lang {
  return sprache.toLowerCase().startsWith("de") ? "de" : "en";
}

/** Gespeicherte Wahl nur, wenn es die Sprache noch gibt (bis 8.16 waren es acht). */
export function gespeicherteSprache(roh: string | null): Lang | null {
  return LANGS.some((l) => l.code === roh) ? (roh as Lang) : null;
}
