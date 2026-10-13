/**
 * Auftrags-Kommentar für TON-Zahlungen (serverseitig).
 *
 * Trennt: `freedom:<auftrag>:<nonce>` — eindeutig pro Auftrag, damit der
 * toncenter-Vergleich exakt treffen kann. 4-Byte-Präfix ist das TL-B-Format
 * (op 0x00000000 = Text-Kommentar); die Client-Seite kodiert denselben String.
 */
export function auftragsKommentar(auftrag: string, nonce = Math.random().toString(36).slice(2, 10)): string {
  return `freedom:${auftrag}:${nonce}`;
}

/** Kommentar zerlegen (für Prüfungen). */
export function zerlegeKommentar(k: string): { auftrag: string; nonce: string } | undefined {
  const m = k.match(/^freedom:([^:]+):([^:]+)$/);
  return m ? { auftrag: m[1], nonce: m[2] } : undefined;
}
