/**
 * SOL-Adresse im öffentlichen Profil nur auf Wunsch (Schritt 12.6).
 *
 * Anders als bei der Lightning-Adresse (6.3) gab es vorher kein Feld dafür –
 * nichts zu übernehmen, es gilt „aus“. Ändern nur über das Häkchen im Profil,
 * eingeschaltet erst nach der Warnung (`bestaetige()` in `tabs/profil.ts`).
 */
export const LS_SOL_OEFFENTLICH = "freedom.profil.solOeffentlich";

type Speicher = Pick<Storage, "getItem" | "setItem">;

/** Geht die SOL-Adresse mit dem Profil hinaus? */
export function solOeffentlich(s: Pick<Storage, "getItem">): boolean {
  return s.getItem(LS_SOL_OEFFENTLICH) === "1";
}

export function setzeSolOeffentlich(s: Speicher, an: boolean): void {
  s.setItem(LS_SOL_OEFFENTLICH, an ? "1" : "0");
}
