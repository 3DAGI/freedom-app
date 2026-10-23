/**
 * Reticulum über die RNode in der App (B-32b2–B-32c2, `docs/RETICULUM-ENTWURF.md`): die Gegenstelle, die Ziele einer
 * Direktnachricht und das Sendezeitkonto der Sitzung. Den Kern (`starteReticulum()`) und den Umschlag nimmt die App seit
 * B-32d1 aus dem Protokoll (`reticulum-kern.ts`, `reticulum-umschlag.ts`).
 */
import { ReticulumFehler, Sendezeitkonto } from "@freedomstack/protocol";

/**
 * Die Gegenstelle (B-32b3): die LXMF-Adresse, an die die App über Reticulum sendet – eine andere App mit Netz, die
 * weiterreicht, später der eigene Knoten (B-32d). Nur in `geheim`: Sie verrät, mit wem man funkt.
 */
export const LS_RETICULUM_GEGENSTELLE = "freedom.reticulum.gegenstelle";

/** Wohin eine Direktnachricht über Reticulum geht (B-32c2, W3 A). */
export interface FunkZiel {
  art: "kontakt" | "gegenstelle";
  an: Uint8Array;
}

/** Erst direkt an die Adresse des Kontakts (B-32c1), dann an die Gegenstelle, die weiterreicht – je Adresse einmal. */
export function funkZiele(kontakt: Uint8Array | null, gegenstelle: Uint8Array | null): FunkZiel[] {
  const ziele: FunkZiel[] = [];
  if (kontakt?.length === 16) ziele.push({ art: "kontakt", an: kontakt });
  if (gegenstelle?.length === 16 && !(kontakt && kontakt.every((b, i) => b === gegenstelle[i]))) ziele.push({ art: "gegenstelle", an: gegenstelle });
  return ziele;
}

/**
 * Die Ziele nacheinander versuchen; Ergebnis: wer die Nachricht nahm. Scheitert eines, kommt das nächste – außer bei
 * „sendezeit“: Reicht sie für das erste nicht, reicht sie für das zweite auch nicht. Scheitern alle, wirft der letzte Fehler.
 */
export async function stelleUeberFunkZu(ziele: readonly FunkZiel[], sende: (an: Uint8Array) => Promise<void>): Promise<FunkZiel["art"]> {
  let fehler: unknown = new ReticulumFehler("adresse");
  for (const z of ziele) {
    try {
      await sende(z.an);
      return z.art;
    } catch (e) {
      fehler = e;
      if (e instanceof ReticulumFehler && e.fall === "sendezeit") break;
    }
  }
  throw fehler;
}

/** Konto für die RNode – eines je Sitzung, auch über Trennen und neu Verbinden hinweg. */
export const RETICULUM_KONTO = new Sendezeitkonto();
