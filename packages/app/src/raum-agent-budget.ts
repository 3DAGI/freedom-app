/**
 * Budget eines Agenten auf dem Gerät für einen Raum (11.3e1, Entwurf
 * `docs/AGENTEN-RAUM-ENTWURF.md` P5, F3 B) – Eingabe im Dialog in sats oder SOL,
 * gespeichert in msat oder Lamports (`agenten-buch.ts`). Ohne DOM, damit Tests es lesen.
 *
 * - sats: ganze Zahlen ab 1; SOL: höchstens neun Nachkommastellen (`solZuLamports()`),
 *   ohne Gleitkomma. Kein Kurs nötig – das Budget bleibt in seiner Einheit.
 * - Die Tagesgrenze ist größer als 0 und höchstens das Monatsbudget – wie im Buch.
 */
import type { BudgetEinheit } from "./agenten-buch.js";
import { lamportsZuSol, solZuLamports } from "./zahlungs-anforderung.js";

export type BudgetFehler = "monat" | "tag" | "tag-groesser";

/** Ein Betrag aus dem Feld in der kleinsten Einheit (msat bzw. Lamports), sonst `undefined`. */
function budgetBetrag(text: string, einheit: BudgetEinheit): number | undefined {
  const s = text.trim();
  if (einheit === "lamports") return solZuLamports(s);
  if (!/^\d{1,12}$/.test(s)) return undefined;
  const sats = Number(s);
  return sats > 0 ? sats * 1000 : undefined;
}

/** Monat und Tag aus dem Dialog – oder welches Feld nicht passt. */
export function leseBudgetEingabe(
  e: { einheit: BudgetEinheit; monat: string; tag: string },
): { ok: true; budget: { einheit: BudgetEinheit; monat: number; tag: number } } | { ok: false; fehler: BudgetFehler } {
  const monat = budgetBetrag(e.monat, e.einheit);
  if (monat === undefined) return { ok: false, fehler: "monat" };
  const tag = budgetBetrag(e.tag, e.einheit);
  if (tag === undefined) return { ok: false, fehler: "tag" };
  if (tag > monat) return { ok: false, fehler: "tag-groesser" };
  return { ok: true, budget: { einheit: e.einheit, monat, tag } };
}

/** Ein gespeicherter Betrag als Text fürs Feld, in seiner Einheit (11.3e2: Budget ändern). */
export function budgetText(wert: number, einheit: BudgetEinheit): string {
  return einheit === "lamports" ? lamportsZuSol(wert) : String(Math.floor(wert / 1000));
}

/** Verbraucht in diesem Monat und heute (UTC) – ein vergangener Zeitraum zählt nicht mehr (wie im Buch). */
export function verbraucht(b: { imMonat: { zeit: string; wert: number }; amTag: { zeit: string; wert: number } }, jetztSek: number): { monat: number; tag: number } {
  const iso = new Date(jetztSek * 1000).toISOString();
  return { monat: b.imMonat.zeit === iso.slice(0, 7) ? b.imMonat.wert : 0, tag: b.amTag.zeit === iso.slice(0, 10) ? b.amTag.wert : 0 };
}
