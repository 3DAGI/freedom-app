/**
 * Umfragen und Termine im privaten Raum – Eingaben lesen und Anzeige
 * rechnen (Sammlung Neuordnung, B-15b), ohne DOM.
 *
 * Die Events baut und liest das Protokoll (`raum-planung.ts`); hier steht,
 * was die Dialoge daraus machen: Antworten je Zeile, das Ende einer Umfrage
 * aus einer festen Wahl, ein Termin aus Datum, Uhrzeit und Dauer in der
 * Ortszeit des Geräts, Anteile für die Balken und der Zeitpunkt als Text.
 */
import { PLANUNG_GRENZEN, type RaumTermin, type RaumUmfrage } from "@freedomstack/protocol";

/** Wahl für das Ende einer Umfrage, in Stunden – 0 heißt: ohne Ende. */
export const UMFRAGE_ENDEN = [0, 1, 24, 72, 168] as const;
/** Wahl für die Dauer eines Termins mit Uhrzeit, in Minuten – 0 heißt: ohne Ende. */
export const TERMIN_DAUERN = [0, 30, 60, 120, 240] as const;

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const UHRZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Antworten aus dem Textfeld: eine je Zeile, Leerzeilen fallen weg. */
export function antwortenAus(text: string): string[] {
  return text.split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
}

/** Was an der Umfrage nicht stimmt – `null`, wenn sie so hinaus darf. */
export function pruefeUmfrage(frage: string, antworten: readonly string[]): "frage" | "zahl" | "lang" | "doppelt" | null {
  if (!frage.trim() || frage.length > PLANUNG_GRENZEN.frage) return "frage";
  if (antworten.length < PLANUNG_GRENZEN.optionenMin || antworten.length > PLANUNG_GRENZEN.optionenMax) return "zahl";
  if (antworten.some((a) => a.length > PLANUNG_GRENZEN.option)) return "lang";
  if (new Set(antworten).size !== antworten.length) return "doppelt";
  return null;
}

/** Ende einer Umfrage aus der Wahl (Stunden als Text) – `undefined` ohne Ende. */
export function umfrageEnde(wahl: string, jetzt = Math.floor(Date.now() / 1000)): number | undefined {
  const h = Number(wahl);
  return (UMFRAGE_ENDEN as readonly number[]).includes(h) && h > 0 ? jetzt + h * 3600 : undefined;
}

/**
 * Beginn und Ende eines Termins: ohne Uhrzeit ganztägig (JJJJ-MM-TT), mit
 * Uhrzeit als Unix-Zeit in der Ortszeit des Geräts, Ende = Beginn + Dauer.
 */
export function terminAus(e: { datum: string; uhrzeit: string; dauer: string }): { beginn: number | string; ende?: number } | { fehler: "datum" | "uhrzeit" | "dauer" } {
  const datum = e.datum.trim();
  if (!DATUM.test(datum)) return { fehler: "datum" };
  const tag = new Date(`${datum}T00:00:00Z`);
  if (Number.isNaN(tag.getTime()) || tag.toISOString().slice(0, 10) !== datum) return { fehler: "datum" };
  const uhrzeit = e.uhrzeit.trim();
  if (!uhrzeit) return { beginn: datum };
  if (!UHRZEIT.test(uhrzeit)) return { fehler: "uhrzeit" };
  const dauer = Number(e.dauer || 0);
  if (!(TERMIN_DAUERN as readonly number[]).includes(dauer)) return { fehler: "dauer" };
  const beginn = Math.floor(new Date(`${datum}T${uhrzeit}:00`).getTime() / 1000);
  if (!Number.isSafeInteger(beginn) || beginn <= 0) return { fehler: "uhrzeit" };
  return dauer > 0 ? { beginn, ende: beginn + dauer * 60 } : { beginn };
}

/** Anteil je Antwort in Prozent (ganze Zahlen) – ohne Stimmen überall 0. */
export function anteile(u: Pick<RaumUmfrage, "optionen">): number[] {
  const summe = u.optionen.reduce((s, o) => s + o.stimmen, 0);
  return u.optionen.map((o) => (summe ? Math.round((o.stimmen / summe) * 100) : 0));
}

/** Neue Wahl bei Mehrfachwahl: eine Antwort dazu oder weg; einfach: nur diese. */
export function neueWahl(u: Pick<RaumUmfrage, "mehrfach" | "meine">, id: string): string[] {
  if (!u.mehrfach) return [id];
  const jetzt = new Set(u.meine ?? []);
  if (jetzt.has(id)) jetzt.delete(id);
  else jetzt.add(id);
  return [...jetzt];
}

/** Wann der Termin ist, als Text in der Sprache der Oberfläche. */
export function terminWann(t: Pick<RaumTermin, "ganztags" | "beginn" | "ende">, gebiet: string): string {
  if (t.ganztags) {
    const tag = (s: number | string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(gebiet, { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    return t.ende !== undefined && t.ende !== t.beginn ? `${tag(t.beginn)} – ${tag(t.ende)}` : tag(t.beginn);
  }
  const beginn = new Date(Number(t.beginn) * 1000);
  const wann = beginn.toLocaleString(gebiet, { weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  if (t.ende === undefined) return wann;
  const ende = new Date(Number(t.ende) * 1000);
  const gleicherTag = ende.toDateString() === beginn.toDateString();
  return `${wann} – ${gleicherTag ? ende.toLocaleTimeString(gebiet, { hour: "2-digit", minute: "2-digit" }) : ende.toLocaleString(gebiet, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`;
}
