/**
 * Lightning-Adresse im öffentlichen Profil nur auf Wunsch (Schritt 6.3).
 *
 * Bis 6.3 ging jede eingetragene Lightning-Adresse mit dem Profil hinaus. Wer
 * damals eine gespeichert hatte, hat sie veröffentlicht: Beim ersten Lesen
 * übernimmt die Einstellung das („1“), sonst gilt „aus“. Danach ändert sie nur
 * das Häkchen im Profil.
 */
export const LS_LN_OEFFENTLICH = "freedom.profil.lnOeffentlich";

type Speicher = Pick<Storage, "getItem" | "setItem">;

/** Geht die Lightning-Adresse mit dem Profil hinaus? */
export function lnOeffentlich(s: Speicher): boolean {
  let w = s.getItem(LS_LN_OEFFENTLICH);
  if (w !== "1" && w !== "0") {
    let lud16: unknown;
    try { lud16 = (JSON.parse(s.getItem("freedom.profile") ?? "{}") as { lud16?: unknown }).lud16; } catch { /* kein Profil */ }
    w = typeof lud16 === "string" && lud16.trim() ? "1" : "0";
    s.setItem(LS_LN_OEFFENTLICH, w);
  }
  return w === "1";
}

export function setzeLnOeffentlich(s: Speicher, an: boolean): void {
  s.setItem(LS_LN_OEFFENTLICH, an ? "1" : "0");
}
