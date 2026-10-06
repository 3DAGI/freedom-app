/**
 * Prüfrunden (P5c, Entscheidung 05./06.10.2026), ohne DOM.
 *
 * Etwa jede 400. Antwort (`PRUEFRUNDE`, `PruefBudget.faellig()`) geht die echte
 * Anfrage zusätzlich an zwei andere Provider – Pflicht, ohne Schalter, bezahlt
 * aus dem Prüfbudget. Der Nutzer sieht nur die Antwort seines Providers; die
 * App vergleicht alle drei (`evaluateConsensus()`) und merkt sich, wer mit der
 * Mehrheit einig war (`Messpunkt.einig`). Ausgenommen sind Wege ohne Netz oder
 * Zahlung (Gerät, eigener Knoten, Funk) – die laufen gar nicht hierher.
 *
 * Übereinstimmung heißt nie „richtig“: Provider mit demselben Basismodell
 * teilen dessen Irrtümer. Erkannt wird nur Abweichung. Gehen die Antworten
 * auseinander (offene Fragen werden oft verschieden formuliert), gibt es keine
 * Aussage – lieber keine als eine falsche.
 */
import { evaluateConsensus, sichererZufall } from "@freedomstack/protocol";
import { PRUEFRUNDE } from "./pruefbudget.js";

export interface ZusatzKandidat { pk: string; modelle: readonly string[] }

/**
 * Die zusätzlichen Provider einer Prüfrunde: nie der gewählte, nie eigene
 * Knoten; mit dem gefragten Modell zuerst (sonst wären die Antworten kaum
 * vergleichbar), darunter zufällig – ein Provider soll nicht vorhersagen
 * können, wann er Prüfer ist.
 */
export function waehleZusatz(
  kandidaten: readonly ZusatzKandidat[],
  p: { haupt: string; modell?: string; eigene?: ReadonlySet<string>; anzahl?: number; zufall?: () => number },
): string[] {
  const zufall = p.zufall ?? sichererZufall;
  const anzahl = p.anzahl ?? PRUEFRUNDE.zusatz;
  const gesehen = new Set<string>([p.haupt]);
  const frei = kandidaten.filter((k) => {
    if (gesehen.has(k.pk) || p.eigene?.has(k.pk)) return false;
    gesehen.add(k.pk);
    return true;
  });
  const mische = <T>(liste: T[]): T[] => {
    const a = [...liste];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(zufall() * (i + 1)));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };
  const gleich = frei.filter((k) => p.modell !== undefined && k.modelle.includes(p.modell));
  const andere = frei.filter((k) => !gleich.includes(k));
  return [...mische(gleich), ...mische(andere)].slice(0, Math.max(0, anzahl)).map((k) => k.pk);
}

/**
 * Eine Prüfrunde auswerten: je Provider, der geantwortet hat, ob er mit der
 * Mehrheit einig war. Nur bei Einstimmigkeit oder klarer Mehrheit eine Aussage;
 * bei Streit oder weniger als zwei Antworten keine (leere Karte). Wer nicht
 * geantwortet hat, zählt hier nicht – das misst die Verfügbarkeit.
 */
export function werteRundeAus(antworten: ReadonlyArray<{ pk: string; output: string }>): Map<string, boolean> {
  const aus = new Map<string, boolean>();
  const gueltig = antworten.filter((a) => a.output.trim().length > 0);
  if (new Set(gueltig.map((a) => a.pk)).size !== gueltig.length || gueltig.length < 2) return aus;
  const r = evaluateConsensus(gueltig.map((a) => ({ providerPubkey: a.pk, output: a.output })));
  if (r.verdict === "unanimous") for (const a of gueltig) aus.set(a.pk, true);
  if (r.verdict === "majority") {
    for (const pk of r.agreeing) aus.set(pk, true);
    for (const pk of r.outliers) aus.set(pk, false);
  }
  return aus;
}
