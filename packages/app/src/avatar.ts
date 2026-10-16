/**
 * Personen ohne Bild (C-44, Oberflächen-Review 15.10.2026): der Anfangsbuchstabe in einem Kreis,
 * die Farbe aus dem Schlüssel – so unterscheiden sich Personen auch ohne Namen und ohne Bild.
 * Ein Bild aus dem Netz lädt die App dafür nie (das nennte dem Server die IP, Regel aus C.5a).
 */
import { pkShort } from "./shell-logic.js";

/** So viele Farben gibt es (`.avatar[data-farbe]` in `app.css`, jede mit weißer Schrift ab 4,5:1). */
export const AVATAR_FARBEN = 8;

/** Die Farbe aus den ersten zwei Hex-Zeichen des Schlüssels – ohne gültigen Schlüssel die erste. */
export function avatarFarbe(pk: string): number {
  return /^[0-9a-f]{2}/i.test(pk) ? parseInt(pk.slice(0, 2), 16) % AVATAR_FARBEN : 0;
}

/**
 * Der Buchstabe aus dem Namen – nie das „~“ eines Profilnamens und nie ein Zeichen des Schlüssels:
 * Ohne eigenen Namen steht „?“ (die Farbe unterscheidet die Personen trotzdem).
 */
export function personInitiale(name: string, pk: string): string {
  const n = name.trim().replace(/^~/, "").trim();
  if (!n || n === pkShort(pk) || n === pk) return "?";
  // Nach Zeichen, nicht nach UTF-16-Einheiten – sonst zerfällt ein Emoji zur Hälfte
  return (Array.from(n)[0] ?? "?").toUpperCase();
}
