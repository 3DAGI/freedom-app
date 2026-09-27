/**
 * Werben nach A+ (Schritt 5.1.3b), ohne DOM.
 *
 * Der Werbelink trägt neben dem Schlüssel die Lightning-Adresse des Werbers
 * (`?ref=<pk>&ln=<lud16>`). Die App des Geworbenen merkt sich beides und zahlt
 * ihm 0,5 % jeder KI-Zahlung direkt – ohne dass die Beziehung öffentlich wird.
 * Öffentlich nennen bleibt freiwillig und zählt nur für die
 * Statistik (8.1b). Es gilt der erste Werber; ein später geöffneter fremder
 * Link verdrängt ihn nicht.
 */
import { adresseFuer, type Zahlziel } from "@freedomstack/protocol";

export const LS_WERBER = "freedom.referrer";
export const LS_WERBER_LN = "freedom.referrer.ln";

type Speicher = Pick<Storage, "getItem" | "setItem">;

/** Werbelink: Schlüssel, dazu die Lightning-Adresse – nur eine plausible. */
export function werbeLink(basis: string, pk: string, lud16?: string): string {
  const url = new URL(basis);
  url.search = "";
  url.hash = "";
  url.searchParams.set("ref", pk);
  const ln = adresseFuer({ lud16 }, "lightning");
  if (ln) url.searchParams.set("ln", ln);
  return url.toString();
}

/**
 * Werber aus dem Link merken (Suchteil der Adresse). Nie überschreiben; die
 * Adresse nur zum selben Werber und nur, solange noch keine gemerkt ist.
 */
export function merkeWerber(suche: string, s: Speicher): void {
  const q = new URLSearchParams(suche);
  const ref = q.get("ref");
  if (!ref || !/^[0-9a-f]{64}$/.test(ref)) return;
  const gemerkt = s.getItem(LS_WERBER);
  if (gemerkt && gemerkt !== ref) return;
  if (!gemerkt) s.setItem(LS_WERBER, ref);
  const ln = adresseFuer({ lud16: q.get("ln") ?? undefined }, "lightning");
  if (ln && !s.getItem(LS_WERBER_LN)) s.setItem(LS_WERBER_LN, ln);
}

/** Wohin der Anteil des Werbers geht – nicht an sich selbst, nie ohne Werber. */
export function werberZahlziel(s: Pick<Storage, "getItem">, ich?: string): Zahlziel | undefined {
  const werber = s.getItem(LS_WERBER);
  if (!werber || werber === ich) return undefined;
  const lud16 = adresseFuer({ lud16: s.getItem(LS_WERBER_LN) ?? undefined }, "lightning");
  return lud16 ? { lud16 } : undefined;
}
