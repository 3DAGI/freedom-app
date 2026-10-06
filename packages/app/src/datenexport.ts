/**
 * Datenexport (Sammlung Neuordnung, B-6), ohne DOM – das Gegenstück zur
 * Notfall-Löschung: alles, was ein neues Gerät oder eine andere App braucht,
 * als eine Datei, die nur der Nutzer mit seiner Passphrase öffnet.
 *
 * Drin ist, was auch die Zustandssicherung enthält (`waehleSicherung()`:
 * Unterhaltungen, Räume, Namen, Profil, Einstellungen, Mandate, Kataloge,
 * Werber, geprüfte Kontakte), dazu, was bewusst nie auf ein Relay geht:
 * die KI-Verläufe und die Quittungen. Nie drin sind Schlüssel, Wallet- und
 * Relay-Zugänge, Geld-Geheimnisse (Preimages, Sperren, Kanäle), Anteile der
 * Nachfolge und Gruppenschlüssel (`SICHERUNG_NIE`) – auch nicht beim
 * Einlesen einer fremden oder veränderten Datei.
 *
 * Verschlüsselt wie der Tresor (`verschluesseleMitPassphrase()`); die Datei
 * verlässt das Gerät nur, wohin der Nutzer sie legt.
 */
import { filtereWiederherstellung, waehleSicherung } from "@freedomstack/protocol";
import { t } from "./i18n.js";
import { entschluesseleMitPassphrase, verschluesseleMitPassphrase } from "./vault.js";

export const EXPORT_ART = "freedomstack-export";
export const EXPORT_FASSUNG = 1;
/** Zusätzlich zur Sicherung – nur in die eigene, verschlüsselte Datei, nie auf ein Relay. */
export const EXPORT_ZUSAETZLICH: readonly string[] = ["freedom.agentHistory", "freedom.quittungen", "freedom.zahlungen"];
/** Größer liest die App keine Datei ein. */
export const EXPORT_MAX_BYTES = 20_000_000;

/** Was in den Export gehört; `lese` holt einen Wert (localStorage oder Tresor). */
export function waehleExport(schluessel: readonly string[], lese: (k: string) => string | null): Record<string, string> {
  const out = waehleSicherung(schluessel, lese);
  for (const k of EXPORT_ZUSAETZLICH) {
    const v = lese(k);
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** Aus einer (auch fremden oder veränderten) Datei nur, was dazugehört. */
export function filtereExport(daten: Record<string, unknown>): Record<string, string> {
  const out = filtereWiederherstellung(daten);
  for (const k of EXPORT_ZUSAETZLICH) if (typeof daten[k] === "string") out[k] = daten[k] as string;
  return out;
}

/** Die Datei als Text: Kennung, Fassung, Zeit, dazu die verschlüsselten Daten. */
export async function baueExport(daten: Record<string, string>, passphrase: string, jetzt = Math.floor(Date.now() / 1000)): Promise<string> {
  const tresor = await verschluesseleMitPassphrase(JSON.stringify(daten), passphrase);
  return JSON.stringify({ art: EXPORT_ART, v: EXPORT_FASSUNG, zeit: jetzt, tresor });
}

/**
 * Eine Datei einlesen: Form prüfen, entschlüsseln, filtern. Wirft mit einem
 * Text für die Oberfläche; eine falsche Passphrase meldet der Tresor selbst.
 */
export async function leseExport(text: string, passphrase: string): Promise<{ daten: Record<string, string>; zeit: number }> {
  if (text.length > EXPORT_MAX_BYTES) throw new Error(t("set.exportZuGross"));
  let huelle: { art?: unknown; v?: unknown; zeit?: unknown; tresor?: unknown };
  try { huelle = JSON.parse(text) ?? {}; } catch { throw new Error(t("set.exportUngueltig")); }
  if (huelle.art !== EXPORT_ART || huelle.v !== EXPORT_FASSUNG || typeof huelle.tresor !== "string" || !Number.isSafeInteger(huelle.zeit)) {
    throw new Error(t("set.exportUngueltig"));
  }
  const klartext = await entschluesseleMitPassphrase(huelle.tresor, passphrase);
  let roh: unknown;
  try { roh = JSON.parse(klartext); } catch { throw new Error(t("set.exportUngueltig")); }
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) throw new Error(t("set.exportUngueltig"));
  return { daten: filtereExport(roh as Record<string, unknown>), zeit: huelle.zeit as number };
}

/** Dateiname mit Datum (UTC), ohne Schlüssel oder Namen. */
export function exportDateiname(jetzt = Math.floor(Date.now() / 1000)): string {
  return `freedom-export-${new Date(jetzt * 1000).toISOString().slice(0, 10)}.json`; // kein UI-Text
}
