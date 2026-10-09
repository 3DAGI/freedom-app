/**
 * Ersatzschlüssel als Datei (B-28, Nutzertest T-2): „Diebstahl vorbeugen“
 * speicherte ihn bisher nur als Klartext. Jetzt auf Wunsch mit Passphrase –
 * im Format des Tresors und des Datenexports (`verschluesseleMitPassphrase()`).
 * Beim Widerruf nimmt die App beides an: den Schlüssel als Hex oder den Inhalt
 * der verschlüsselten Datei samt Passphrase.
 */
import { entschluesseleMitPassphrase, verschluesseleMitPassphrase } from "./vault.js";

/** Kennung der verschlüsselten Datei – nur sie wird als Ersatz-Datei gelesen. */
export const ERSATZ_ART = "freedom-ersatzschluessel";
const HEX64 = /^[0-9a-f]{64}$/;

export interface ErsatzDatei { name: string; typ: string; inhalt: string }

/**
 * Die Datei zum Ersatzschlüssel: mit Passphrase verschlüsselt (JSON, der
 * öffentliche Schlüssel offen – er steht ohnehin im Mandat), sonst wie bisher
 * der Klartext aus `klartext`.
 */
export async function baueErsatzDatei(skHex: string, pkHex: string, klartext: string, passphrase?: string): Promise<ErsatzDatei> {
  // Nie erreichbar: die Schlüssel kommen aus generateKeypair()
  if (!HEX64.test(skHex) || !HEX64.test(pkHex)) throw new Error("ersatz"); // kein UI-Text
  if (!passphrase) return { name: "freedom-ersatzschluessel.txt", typ: "text/plain", inhalt: klartext };
  const chiffre = await verschluesseleMitPassphrase(skHex, passphrase);
  return { name: "freedom-ersatzschluessel.json", typ: "application/json", inhalt: JSON.stringify({ art: ERSATZ_ART, version: 1, oeffentlich: pkHex, chiffre }) };
}

/** Ist die Eingabe der Inhalt einer verschlüsselten Ersatz-Datei? */
export function istErsatzDatei(eingabe: string): boolean {
  try {
    const d = JSON.parse(eingabe.trim()) as { art?: unknown; version?: unknown; chiffre?: unknown };
    return d?.art === ERSATZ_ART && d.version === 1 && typeof d.chiffre === "string";
  } catch {
    return false;
  }
}

/**
 * Den privaten Ersatzschlüssel aus der Eingabe: 64 Zeichen Hex, oder der Inhalt
 * der verschlüsselten Datei mit ihrer Passphrase. `null`, wenn es keins von
 * beiden ist; eine falsche Passphrase wirft (wie beim Tresor).
 */
export async function leseErsatz(eingabe: string, passphrase = ""): Promise<string | null> {
  const roh = eingabe.trim();
  if (HEX64.test(roh.toLowerCase())) return roh.toLowerCase();
  if (!istErsatzDatei(roh)) return null;
  const { chiffre } = JSON.parse(roh) as { chiffre: string };
  const sk = (await entschluesseleMitPassphrase(chiffre, passphrase)).trim().toLowerCase();
  return HEX64.test(sk) ? sk : null;
}
