/**
 * Platzhalter in KI-Anfragen (D1a, `docs/DATENSCHUTZ-PROVIDER.md`).
 *
 * Vor dem Versiegeln ersetzt `buildJobEvent()` persönliche Angaben in Frage und
 * Verlauf (`maskiere()`), die Antwort bekommt sie in `handleAnswer()` zurück
 * (`entmaskiere()`). Die Zuordnung gilt je Unterhaltung und liegt nur im
 * Speicher; eine neue oder gewechselte Unterhaltung beginnt mit einer neuen
 * (`neueZuordnung()`). Nie beim eigenen Knoten – dort liest niemand mit.
 * Standard an; aus nur über Settings › Datenschutz (`freedom.platzhalter`).
 */
import { Zuordnung, ersetzeAngaben } from "@freedomstack/protocol";
import { conversations } from "./tabs/kommunikation.js";

export const LS_PLATZHALTER = "freedom.platzhalter";

/** An, solange der Nutzer es nicht ausgeschaltet hat. */
export const platzhalterAn = (): boolean => localStorage.getItem(LS_PLATZHALTER) !== "aus";

/** Nur aus Settings › Datenschutz. */
export function setzePlatzhalter(an: boolean): void {
  if (an) localStorage.removeItem(LS_PLATZHALTER);
  else localStorage.setItem(LS_PLATZHALTER, "aus");
}

let zuordnung = new Zuordnung();
/** Wie viele Angaben je Anfrage ersetzt wurden – nur die Zahl, für die Anzeige unter der Antwort. */
const ersetztJe = new Map<string, number>();

/** Neue oder gewechselte Unterhaltung: neue Zuordnung, die alte fällt weg. */
export function neueZuordnung(): void {
  zuordnung = new Zuordnung();
}

/** Namen aus dem eigenen Adressbuch und der eigene Profilname – nur lokal bekannt. */
function bekannteNamen(): string[] {
  const namen = conversations.filter((c) => c.type === "dm" && typeof c.name === "string").map((c) => c.name);
  try {
    const profil = JSON.parse(localStorage.getItem("freedom.profile") ?? "{}") as { name?: unknown; display_name?: unknown };
    for (const n of [profil.name, profil.display_name]) if (typeof n === "string") namen.push(n);
  } catch { /* kein Profil */ }
  return namen;
}

/** Text für eine Anfrage ins Netz – mit Platzhaltern, wenn eingeschaltet. */
export function maskiere(text: string): { text: string; ersetzt: number } {
  return platzhalterAn() ? ersetzeAngaben(text, zuordnung, bekannteNamen()) : { text, ersetzt: 0 };
}

export function merkeErsetzt(requestId: string, n: number): void {
  if (n > 0) ersetztJe.set(requestId, n);
  if (ersetztJe.size > 200) ersetztJe.delete(ersetztJe.keys().next().value!);
}

export const ersetztFuer = (requestId: string): number => ersetztJe.get(requestId) ?? 0;

/**
 * Für einen Auftrag eines Agenten auf dem Gerät (11.3c2): eine eigene Zuordnung
 * je Auftrag, nie die der Unterhaltung. Zurückgesetzt wird nur in seine Antwort im
 * Raum – dort stand der Wert schon.
 */
export function maskiereEinzeln(text: string): { text: string; zurueck: (s: string) => string } {
  const z = new Zuordnung();
  return { text: platzhalterAn() ? ersetzeAngaben(text, z, bekannteNamen()).text : text, zurueck: (s) => z.setzeEin(s) };
}

/** Die Werte in die Antwort zurücksetzen – nur für Anzeige und eigenen Verlauf. */
export const entmaskiere = (text: string): string => zuordnung.setzeEin(text);
