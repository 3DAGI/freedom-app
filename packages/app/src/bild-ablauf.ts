/**
 * Bild eines Programms vom eigenen Knoten (VKg2b, `docs/VIBECODEN-ENTWURF.md` VKg2) – was ohne DOM und ohne WebRTC geht,
 * damit testbar: die Größe des Bildschirms auf dem Knoten, die Stelle eines Fingers oder Zeigers im Bild und die Nachrichten
 * auf dem Datenkanal `eingabe` (Format `PROTOCOL.md` §34). Die Verbindung selbst läuft nur über den eigenen TURN
 * (`iceTransportPolicy: "relay"`, wie Anrufe, B-13) – `shell/bild-ui.ts`.
 */
import { CODE_GRENZEN } from "@freedomstack/protocol";

/** So lange darf der Knoten für die Antwort brauchen (Sandbox, Bildschirm, Programm, Kandidaten über den TURN). */
export const BILD_ZEIT_MS = 30_000;
/** So lange sammelt die App Kandidaten – Chromium meldet das Ende oft erst nach Sekunden; nach dem ersten Relay-Kandidaten reicht kurz. */
export const SAMMELN_MS = { hoechstens: 5000, nachRelay: 300 } as const;
/** Längste Nachricht auf dem Datenkanal – mehr nimmt der Knoten nicht. */
export const EINGABE_ZEICHEN = 200;

const gerade = (n: number): number => Math.floor(n / 2) * 2;

/**
 * Größe des Bildschirms auf dem Knoten aus der Fläche, die das Bild in der App bekommt: in Gerätepixeln, im Seitenverhältnis
 * der Fläche, eingepasst in den Rahmen des Protokolls (`CODE_GRENZEN.bild`), gerade Zahlen (die Kodierer brauchen sie).
 */
export function bildGroesse(breite: number, hoehe: number, pixelDichte = 1): { breite: number; hoehe: number } {
  const [minB, maxB] = CODE_GRENZEN.bild.breite, [minH, maxH] = CODE_GRENZEN.bild.hoehe;
  const dichte = Number.isFinite(pixelDichte) && pixelDichte > 0 ? Math.min(pixelDichte, 3) : 1;
  let b = Number.isFinite(breite) && breite > 0 ? breite * dichte : 1280;
  let h = Number.isFinite(hoehe) && hoehe > 0 ? hoehe * dichte : 720;
  const kleiner = Math.min(1, maxB / b, maxH / h);
  b *= kleiner;
  h *= kleiner;
  const groesser = Math.max(1, minB / b, minH / h);
  b = Math.min(maxB, b * groesser);
  h = Math.min(maxH, h * groesser);
  return { breite: Math.max(minB, gerade(b)), hoehe: Math.max(minH, gerade(h)) };
}

/**
 * Stelle im Bild als Anteil (0 bis 1) – das Video zeigt das Bild eingepasst (`object-fit: contain`), mit Rändern oben und
 * unten oder links und rechts. Außerhalb des Bildes: null.
 */
export function zeigerAnteil(
  punkt: { x: number; y: number }, flaeche: { left: number; top: number; width: number; height: number }, bild: { breite: number; hoehe: number },
): { x: number; y: number } | null {
  if (flaeche.width <= 0 || flaeche.height <= 0 || bild.breite <= 0 || bild.hoehe <= 0) return null;
  const massstab = Math.min(flaeche.width / bild.breite, flaeche.height / bild.hoehe);
  const w = bild.breite * massstab, h = bild.hoehe * massstab;
  const x = (punkt.x - flaeche.left - (flaeche.width - w) / 2) / w;
  const y = (punkt.y - flaeche.top - (flaeche.height - h) / 2) / h;
  if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null;
  const rund = (n: number) => Math.round(n * 10_000) / 10_000;
  return { x: rund(x), y: rund(y) };
}

/** Tasten mit Namen, die der Knoten kennt (`KeyboardEvent.key`) – andere Namen schickt die App nicht. */
export const BENANNTE_TASTEN = new Set([
  "Enter", "Backspace", "Tab", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", // kein UI-Text
  "Shift", "Control", "Alt", "Meta", "CapsLock", "Delete", "Insert", "Home", "End", "PageUp", "PageDown", // kein UI-Text
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
]);

/** Ob eine Taste ins Bild geht: ein einzelnes Zeichen (auch ein Leerzeichen oder ein Umlaut) oder eine Taste mit Namen. */
export function gehtInsBild(key: string): boolean {
  return [...key].length === 1 || BENANNTE_TASTEN.has(key);
}

export type BildEingabe =
  | { t: "b"; x: number; y: number }
  | { t: "d" | "u"; x: number; y: number; k: 1 | 2 | 3 }
  | { t: "r"; dy: number }
  | { t: "kd" | "ku"; s: string };

/** Knopf der Maus (`MouseEvent.button`) → Knopf im Bild: links 1, Mitte 2, rechts 3; andere gibt es nicht. */
export function knopfImBild(button: number): 1 | 2 | 3 | null {
  return button === 0 ? 1 : button === 1 ? 2 : button === 2 ? 3 : null;
}

/** Nachricht für den Datenkanal – null, wenn sie nicht ins Format passt (dann schickt die App nichts). */
export function eingabeText(e: BildEingabe): string | null {
  const anteil = (n: unknown) => typeof n === "number" && n >= 0 && n <= 1;
  switch (e.t) {
    case "b":
      if (!anteil(e.x) || !anteil(e.y)) return null;
      break;
    case "d":
    case "u":
      if (!anteil(e.x) || !anteil(e.y) || ![1, 2, 3].includes(e.k)) return null;
      break;
    case "r":
      if (!Number.isFinite(e.dy) || e.dy === 0) return null;
      break;
    case "kd":
    case "ku":
      if (typeof e.s !== "string" || !gehtInsBild(e.s)) return null;
      break;
    default:
      return null;
  }
  const text = JSON.stringify(e);
  return text.length <= EINGABE_ZEICHEN ? text : null;
}
