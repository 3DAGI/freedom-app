/**
 * Eigene Messung in der App (Freedom-Prüfung P2a, E7): ein Buch im Tresor
 * (`freedom.messungen`, nie in der Sicherung), geschrieben nach jedem Lauf
 * über die Provider (`askWithFailover()`), gelesen bei jeder Auswahl
 * (`findProviders()` → `mitMessung()`).
 */
import { type Messpunkt } from "@freedomstack/protocol";
import { MessBuch } from "../messbuch.js";
import { geheim } from "./tresor.js";

export const messBuch = new MessBuch(geheim);

/** Ergebnisse eines Laufs merken – Tresor gesperrt: dann fehlt die Messung, nie offen ablegen. */
export async function merkeMessung(punkte: ReadonlyArray<[string, Messpunkt]>): Promise<void> {
  for (const [pk, p] of punkte) await messBuch.merke(pk, p).catch(() => {});
}
