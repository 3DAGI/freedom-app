/**
 * Ruf mit Kontakten in der App (Schritt 5.5c).
 *
 * Versand: nur mit Zustimmung (`freedom.ruf.teilen`), im Abruftakt je Schlag
 * höchstens ein Umschlag (`RufVersand`), an den Posteingang des Kontakts.
 * Als Gerät nicht – Kontakte kennen nur die Person, nicht den Geräteschlüssel.
 * Empfang: `alsRufZusammenfassung()` am Ende der Kette in `oeffneUmschlag()`;
 * nur Kontakte zählen, gemerkt im Tresor, danach über `aktuellerRuf()`.
 */
import { oeffneRufUmschlag, type NostrEvent } from "@freedomstack/protocol";
import { LS_RUF_TEILEN, RufVersand } from "../ruf-teilen.js";
import { eigeneZeilen, kontakteJetzt, rufVonKontakten } from "./quittungen.js";
import { alsGeraet, posteingangVon, state, veroeffentlicheAn } from "./state.js";
import { geheim } from "./tresor.js";

export const rufTeilenAn = (): boolean => localStorage.getItem(LS_RUF_TEILEN) === "1";

export function setzeRufTeilen(an: boolean): void {
  if (an) localStorage.setItem(LS_RUF_TEILEN, "1");
  else localStorage.removeItem(LS_RUF_TEILEN);
}

const versand = new RufVersand({
  zustimmung: rufTeilenAn,
  signer: () => (alsGeraet() ? null : state.signer),
  kontakte: kontakteJetzt,
  zeilen: eigeneZeilen,
  sende: async (wrap, an) => {
    const ziele = await posteingangVon(an).catch(() => [] as string[]);
    return ziele.length > 0 && (await veroeffentlicheAn(wrap, ziele)) > 0;
  },
  speicher: geheim,
  jetzt: () => Math.floor(Date.now() / 1000),
});

/** Ein Schlag des Abruftakts. */
export async function rufTakt(): Promise<void> {
  await versand.takt();
}

/** Stand für die Settings: mit wie vielen Kontakten geteilt, von wie vielen erhalten. */
export function rufStand(): { geteilt: number; erhalten: number } {
  const kontakte = new Set(kontakteJetzt());
  return { geteilt: (versand.stand()?.an ?? []).filter((k) => kontakte.has(k)).length, erhalten: rufVonKontakten.alle(kontakte).length };
}

/** Eine Zusammenfassung von einem Kontakt? Merken – angezeigt wird sie nicht. */
export async function alsRufZusammenfassung(w: NostrEvent): Promise<null> {
  if (!state.signer) return null;
  const r = await oeffneRufUmschlag(w, state.signer, new Set(kontakteJetzt()));
  if (r) await rufVonKontakten.nimm(r).catch(() => false);
  return null;
}
