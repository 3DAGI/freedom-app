import { randomBytes } from "node:crypto";

/**
 * Auftrags-Kommentar für TON-Zahlungen (serverseitig).
 *
 * Trennt: `freedom:<auftrag>:<nonce>` — eindeutig pro Auftrag, damit der
 * toncenter-Vergleich exakt treffen kann. 4-Byte-Präfix ist das TL-B-Format
 * (op 0x00000000 = Text-Kommentar); die Client-Seite kodiert denselben String.
 *
 * Die Nonce kommt aus `randomBytes` (TMA-2, vorher `Math.random`): Wer sie errät, könnte
 * eine fremde Zahlung als eigene ausgeben.
 */
export function auftragsKommentar(auftrag: string, nonce = randomBytes(8).toString("hex")): string {
  return `freedom:${auftrag}:${nonce}`;
}

/** Kommentar zerlegen (für Prüfungen). */
export function zerlegeKommentar(k: string): { auftrag: string; nonce: string } | undefined {
  const m = k.match(/^freedom:([^:]+):([^:]+)$/);
  return m ? { auftrag: m[1], nonce: m[2] } : undefined;
}
