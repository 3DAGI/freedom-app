/**
 * Bestätigung der Merkphrase per Wort-Chips (C-55b, Oberflächen-Review 15.10.2026) – ohne DOM. Bis jetzt tippte man
 * drei Wörter ab; am Handy mit Autokorrektur scheiterte das oft an Kleinigkeiten. Jetzt wählt man je Stelle aus vier
 * Wörtern der eigenen Merkphrase – wer sie nicht aufgeschrieben hat, rät bei drei Stellen nur mit 1 : 64 richtig.
 * Geprüft wird weiter mit `verifyMnemonicChallenge()`.
 */

/** Zufall in [0, n) – im Browser aus `crypto.getRandomValues`, in Tests vorgegeben. */
export type Zufall = (n: number) => number;

export const sichererZufall: Zufall = (n) => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
};

/**
 * Die Auswahl für Stelle `pos`: das richtige Wort und bis zu `anzahl - 1` andere Wörter derselben Merkphrase (ohne
 * Doppelte), gemischt. Gleiche Wörter an mehreren Stellen zählen einmal.
 */
export function wortAuswahl(woerter: readonly string[], pos: number, zufall: Zufall = sichererZufall, anzahl = 4): string[] {
  const richtig = woerter[pos];
  if (richtig === undefined) return [];
  const andere = [...new Set(woerter.filter((w) => w !== richtig))];
  const wahl = [richtig];
  while (wahl.length < anzahl && andere.length > 0) wahl.push(andere.splice(zufall(andere.length), 1)[0]!);
  // Fisher-Yates
  for (let i = wahl.length - 1; i > 0; i--) {
    const j = zufall(i + 1);
    [wahl[i], wahl[j]] = [wahl[j]!, wahl[i]!];
  }
  return wahl;
}
