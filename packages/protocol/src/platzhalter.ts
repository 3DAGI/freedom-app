/**
 * Platzhalter für persönliche Angaben (D1a, `docs/DATENSCHUTZ-PROVIDER.md`), ohne DOM.
 *
 * Der Provider liest Frage und Verlauf im Klartext – er muss sie rechnen. Was
 * eine klare Form hat (E-Mail, Telefon, IBAN, Kartennummer, IP, Nostr-Schlüssel,
 * Lightning-Rechnung) und die Namen aus dem eigenen Adressbuch ersetzt die App
 * vorher durch Platzhalter wie `[EMAIL_1]` und setzt die Werte in der Antwort
 * zurück. Die Zuordnung bleibt nur im Speicher. Kein Raten: keine Erkennung per
 * KI, keine Liste von Vornamen – was nicht erkannt wird, geht unverändert hinaus.
 */

type Art = "email" | "rechnung" | "nostr" | "iban" | "karte" | "ip" | "telefon" | "name";

/** Platzhalter je Art – gehen ans Modell, nicht in die Oberfläche. */
const MARKE: Record<Art, string> = {
  email: "EMAIL", rechnung: "LN_INVOICE", nostr: "NOSTR_KEY", iban: "IBAN", // kein UI-Text
  karte: "CARD", ip: "IP", telefon: "PHONE", name: "NAME", // kein UI-Text
};

/** Grenzen: kurze Namen nicht ersetzen (zu viele Fehltreffer), höchstens so viele Namen im Muster. Die Muster laufen linear – keine Grenze der Länge, sonst ginge der Rest unmaskiert hinaus. */
const PLATZHALTER_GRENZEN = Object.freeze({ nameMin: 3, namen: 500 });

/** Je Unterhaltung: derselbe Wert ergibt immer denselben Platzhalter. */
export class Zuordnung {
  readonly #wert = new Map<string, string>(); // Platzhalter → Wert
  readonly #marke = new Map<string, string>(); // Art + Wert → Platzhalter
  readonly #zahl = new Map<Art, number>();

  platzhalter(art: Art, wert: string): string {
    const schluessel = `${art}\u0000${art === "name" ? wert.toLocaleLowerCase() : wert}`;
    const da = this.#marke.get(schluessel);
    if (da) return da;
    const n = (this.#zahl.get(art) ?? 0) + 1;
    this.#zahl.set(art, n);
    const p = `[${MARKE[art]}_${n}]`;
    this.#marke.set(schluessel, p);
    this.#wert.set(p, wert);
    return p;
  }

  /** Die Werte in einen Text zurücksetzen (Antwort, eigener Verlauf). */
  setzeEin(text: string): string {
    return text.replace(/\[(?:EMAIL|LN_INVOICE|NOSTR_KEY|IBAN|CARD|IP|PHONE|NAME)_\d{1,4}\]/g, (p) => this.#wert.get(p) ?? p);
  }

  get anzahl(): number {
    return this.#wert.size;
  }
}

const ziffern = (s: string): string => s.replace(/\D/g, "");

/** IBAN-Prüfziffer (ISO 13616, mod 97) – ohne BigInt, stückweise. */
function ibanGueltig(roh: string): boolean {
  const s = roh.replace(/ /g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const umgestellt = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const c of umgestellt) rest = (rest * 10 + Number(c)) % 97;
  return rest === 1;
}

/** Luhn-Prüfung für Kartennummern (13–19 Ziffern). */
function luhnGueltig(roh: string): boolean {
  const z = ziffern(roh);
  if (z.length < 13 || z.length > 19 || /^(\d)\1+$/.test(z)) return false;
  let summe = 0;
  for (let i = 0; i < z.length; i++) {
    let d = Number(z[z.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    summe += d;
  }
  return summe % 10 === 0;
}

const OKTETT = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const HEX = "[0-9a-fA-F]{1,4}";

/** Muster in fester Reihenfolge – das Längere und Strengere zuerst, damit sich Treffer nicht überschneiden. */
const MUSTER: ReadonlyArray<{ art: Art; re: RegExp; pruefe?: (w: string) => boolean }> = [
  { art: "email", re: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}/g },
  { art: "rechnung", re: /\bln(?:bc|tb|bcrt|tbs)[0-9a-z]{20,}\b/gi },
  { art: "nostr", re: /\b(?:npub|nsec|nprofile)1[02-9ac-hj-np-z]{20,}\b/g },
  { art: "iban", re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g, pruefe: ibanGueltig },
  { art: "karte", re: /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g, pruefe: luhnGueltig },
  { art: "ip", re: new RegExp(`(?<![\\d.])${OKTETT}(?:\\.${OKTETT}){3}(?![\\d.])`, "g") },
  { art: "ip", re: new RegExp(`(?<![\\w:])(?:(?:${HEX}:){7}${HEX}|(?:${HEX}:){1,6}:(?:${HEX}:){0,5}${HEX})(?![\\w:])`, "g") },
  // Nicht mitten in einer Zifferngruppe (z. B. Teil einer IBAN mit Tippfehler)
  { art: "telefon", re: /(?<![\w+])(?<!\d[ /-])(?:\+|00|0)\d[\d ()/-]{5,20}\d(?!\w)/g, pruefe: (w) => ziffern(w).length >= 7 && ziffern(w).length <= 15 },
];

const regexText = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Namen als ganze Wörter: voller Name und jeder Teil ab `nameMin` Zeichen, längste zuerst. */
function namensMuster(namen: readonly string[]): RegExp | null {
  const teile = new Set<string>();
  for (const roh of namen.slice(0, PLATZHALTER_GRENZEN.namen)) {
    const n = roh.trim().replace(/\s+/g, " ");
    if (n.length >= PLATZHALTER_GRENZEN.nameMin) teile.add(n);
    for (const t of n.split(" ")) if (t.length >= PLATZHALTER_GRENZEN.nameMin) teile.add(t);
  }
  if (teile.size === 0) return null;
  const alle = [...teile].sort((a, b) => b.length - a.length).map(regexText);
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alle.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
}

/**
 * Persönliche Angaben in einem Text durch Platzhalter ersetzen. `namen` sind
 * die Namen aus dem eigenen Adressbuch und der eigene Profilname. Liefert den
 * neuen Text und wie viele Stellen ersetzt wurden.
 */
export function ersetzeAngaben(text: string, z: Zuordnung, namen: readonly string[] = []): { text: string; ersetzt: number } {
  let aus = text;
  let ersetzt = 0;
  const ersetze = (art: Art, re: RegExp, pruefe?: (w: string) => boolean) => {
    // Schon eingesetzte Platzhalter nie noch einmal anfassen
    aus = aus.split(/(\[[A-Z_]+_\d{1,4}\])/).map((stueck, i) => i % 2 === 1 ? stueck : stueck.replace(re, (w) => {
      if (pruefe && !pruefe(w)) return w;
      ersetzt++;
      return z.platzhalter(art, w);
    })).join("");
  };
  for (const m of MUSTER) ersetze(m.art, m.re, m.pruefe);
  const nm = namensMuster(namen);
  if (nm) ersetze("name", nm);
  return { text: aus, ersetzt };
}
