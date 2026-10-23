/**
 * Reticulum-Adressen mit Kontakten in der App (B-32c1, W2 A).
 *
 * Versand: nur mit Zustimmung (`freedom.reticulum.teilen`, in `geheim`), im Abruftakt je Schlag höchstens ein Umschlag
 * (`FunkAdressVersand`), an den Posteingang des Kontakts. Als Gerät nicht – Kontakte kennen nur die Person. Die eigene
 * Adresse rechnet die App erst, wenn es etwas zu senden gibt (die Bibliothek von Reticulum lädt nur dann).
 * Empfang: `alsFunkAdresse()` am Ende der Kette in `oeffneUmschlag()`; nur Kontakte zählen, gemerkt in `geheim`.
 */
import { oeffneFunkAdresseUmschlag, toHex, type NostrEvent } from "@freedomstack/protocol";
import { FunkAdressBuch, FunkAdressVersand, LS_FUNK_TEILEN } from "../funk-adressen.js";
import { kontakteJetzt } from "./quittungen.js";
import { alsGeraet, posteingangVon, state, veroeffentlicheAn } from "./state.js";
import { geheim } from "./tresor.js";

export const funkTeilenAn = (): boolean => geheim.getItem(LS_FUNK_TEILEN) === "1";

export const funkAdressBuch = new FunkAdressBuch(geheim);

const versand = new FunkAdressVersand({
  zustimmung: funkTeilenAn,
  signer: () => (alsGeraet() ? null : state.signer),
  kontakte: kontakteJetzt,
  adresse: async () => {
    const { reticulumIdentitaet, lxmfAdresse } = await import("../reticulum-umschlag.js");
    return toHex(await lxmfAdresse(await reticulumIdentitaet(geheim)));
  },
  sende: async (wrap, an) => {
    const ziele = await posteingangVon(an).catch(() => [] as string[]);
    return ziele.length > 0 && (await veroeffentlicheAn(wrap, ziele)) > 0;
  },
  speicher: geheim,
  jetzt: () => Math.floor(Date.now() / 1000),
});

/** Zustimmung setzen – eingeschaltet geht es beim nächsten Schlag los. Wer die Adresse schon hat, behält sie. */
export async function setzeFunkTeilen(an: boolean): Promise<void> {
  if (an) {
    await geheim.setItem(LS_FUNK_TEILEN, "1");
    versand.bald();
  } else {
    await geheim.removeItem(LS_FUNK_TEILEN);
  }
}

/** Ein Schlag des Abruftakts. */
export async function funkAdressTakt(): Promise<void> {
  await versand.takt();
}

/** Für den Dialog: mit wie vielen Kontakten geteilt, von wie vielen eine Adresse da ist. */
export function funkAdressStand(): { geteilt: number; erhalten: number } {
  const kontakte = new Set(kontakteJetzt());
  return { geteilt: (versand.verteilt()?.an ?? []).filter((k) => kontakte.has(k)).length, erhalten: funkAdressBuch.zahl(kontakte) };
}

/** Die Adresse eines Kontakts? Merken – in der Unterhaltung erscheint nichts. */
export async function alsFunkAdresse(w: NostrEvent): Promise<null> {
  if (!state.signer) return null;
  const r = await oeffneFunkAdresseUmschlag(w, state.signer, new Set(kontakteJetzt()));
  if (r) await funkAdressBuch.nimm(r).catch(() => false);
  return null;
}
