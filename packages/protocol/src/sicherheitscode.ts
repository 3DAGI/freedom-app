/**
 * Kontakt prüfen (Sammlung Neuordnung, B-4).
 *
 * In Nostr ist ein Kontakt sein Schlüssel. Name und Bild im Profil kann jeder
 * nachmachen – wer einen Kontakt nachahmt, hat einen anderen Schlüssel. Der
 * Sicherheitscode entsteht aus beiden Schlüsseln, unabhängig davon, wer ihn
 * anzeigt: Beide sehen dieselben 60 Ziffern. Stimmen sie beim Vorlesen oder
 * per QR-Code überein, spricht man wirklich miteinander.
 *
 * Der Code verrät nichts, was nicht ohnehin öffentlich ist (die Schlüssel),
 * und reist nie über ein Relay: Verglichen wird von Mensch zu Mensch.
 */
import { sha256 } from "@noble/hashes/sha2.js";

/** Ändert sich die Rechnung, bekommt sie eine neue Fassung – alte Codes gelten dann nicht mehr. */
export const SICHERHEITSCODE_FASSUNG = "freedomstack-sicherheitscode-v1";
/** So beginnt der Inhalt des QR-Codes. */
export const SICHERHEITSCODE_QR = "freedomstack-pruefung:1:";

const HEX64 = /^[0-9a-f]{64}$/;
const GRUPPEN = 12;
const STELLEN = 5;

function bytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/**
 * Der Sicherheitscode zweier Schlüssel: 12 Gruppen zu 5 Ziffern, für beide
 * Seiten gleich. undefined bei ungültigen Schlüsseln oder zweimal demselben.
 */
export function sicherheitscode(a: string, b: string): string | undefined {
  if (!HEX64.test(a) || !HEX64.test(b) || a === b) return undefined;
  const [erster, zweiter] = [a, b].sort();
  const basis = new TextEncoder().encode(SICHERHEITSCODE_FASSUNG);
  // 60 Byte aus zwei Hashes (je Gruppe 5 Byte → eine Zahl unter 10^5)
  const teil = (n: number) => sha256(new Uint8Array([...basis, n, ...bytes(erster!), ...bytes(zweiter!)]));
  const roh = new Uint8Array([...teil(0), ...teil(1)]);
  const gruppen: string[] = [];
  for (let g = 0; g < GRUPPEN; g++) {
    let wert = 0;
    for (let i = 0; i < 5; i++) wert = wert * 256 + roh[g * 5 + i]!;
    gruppen.push(String(wert % 10 ** STELLEN).padStart(STELLEN, "0"));
  }
  return gruppen.join(" ");
}

/** Inhalt des QR-Codes: nur der Code, ohne Schlüssel. */
export function sicherheitscodeQr(code: string): string {
  return SICHERHEITSCODE_QR + code.replace(/\D/g, "");
}

/**
 * Stimmt eine Eingabe (vorgelesen, eingetippt oder gescannt) mit dem Code
 * überein? Leerzeichen, Striche und das QR-Präfix zählen nicht; es müssen
 * genau die 60 Ziffern sein.
 */
export function sicherheitscodeStimmt(eingabe: string, code: string): boolean {
  const roh = eingabe.trim().startsWith(SICHERHEITSCODE_QR) ? eingabe.trim().slice(SICHERHEITSCODE_QR.length) : eingabe;
  const ziffern = roh.replace(/[\s-]/g, "");
  const soll = code.replace(/\D/g, "");
  return /^\d{60}$/.test(ziffern) && soll.length === 60 && ziffern === soll;
}
