/**
 * Verlauf eines Raums gruppiert (Schritt C.2b2) – ohne DOM.
 *
 * Aufeinanderfolgende Nachrichten desselben Absenders stehen unter einem Kopf
 * (Name, Uhrzeit), solange zwischen zweien höchstens fünf Minuten liegen und
 * derselbe Tag ist. Zeitstempel sind nur behauptet: Geht einer rückwärts,
 * beginnt eine neue Gruppe, statt eine Nachricht unter einen fremden Kopf zu
 * ziehen.
 */
export const GRUPPE_ABSTAND = 5 * 60;

export interface Gruppe<N> {
  autor: string;
  /** Erste Gruppe eines Tages – davor steht das Datum. */
  neuerTag: boolean;
  nachrichten: N[];
}

/** Tag in der Zeitzone des Geräts. */
const ortsTag = (s: number): string => new Date(s * 1000).toDateString();

export function gruppiereVerlauf<N extends { authorPubkey: string; createdAt: number }>(
  liste: readonly N[], tagVon: (s: number) => string = ortsTag, abstand = GRUPPE_ABSTAND,
): Gruppe<N>[] {
  const gruppen: Gruppe<N>[] = [];
  let vorige: N | undefined;
  for (const n of liste) {
    const neuerTag = !vorige || tagVon(n.createdAt) !== tagVon(vorige.createdAt);
    const g = gruppen[gruppen.length - 1];
    const dazu = g && vorige && !neuerTag && g.autor === n.authorPubkey
      && n.createdAt >= vorige.createdAt && n.createdAt - vorige.createdAt <= abstand;
    if (dazu) g.nachrichten.push(n);
    else gruppen.push({ autor: n.authorPubkey, neuerTag, nachrichten: [n] });
    vorige = n;
  }
  return gruppen;
}
