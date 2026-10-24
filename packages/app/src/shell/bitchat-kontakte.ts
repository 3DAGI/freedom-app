/**
 * Bitchat-Schlüssel mit Kontakten in der App (B-36c2b1, BC-W3 A, BC-W4 A) – wie die Reticulum-Adresse (`funk-kontakte.ts`).
 *
 * Versand: nur mit Zustimmung (`freedom.bitchat.teilen`, in `geheim`), im Abruftakt je Schlag höchstens ein Umschlag (Kind
 * 38083, `FunkAdressVersand` mit `BITCHAT_SCHLUESSEL`), an den Posteingang des Kontakts. Als Gerät nicht – Kontakte kennen nur
 * die Person. Die eigene Identität (eine je Gerät, `bitchatIdentitaet()`) entsteht erst, wenn es etwas zu senden gibt.
 * Empfang: `alsBitchatSchluessel()` am Ende der Kette in `oeffneUmschlag()`; nur Kontakte zählen, gemerkt in `geheim`.
 */
import { bitchatIdentitaet, bitchatSchluesselVon, oeffneBitchatSchluesselUmschlag, type NostrEvent } from "@freedomstack/protocol";
import { BITCHAT_SCHLUESSEL, FunkAdressBuch, FunkAdressVersand } from "../funk-adressen.js";
import { kontakteJetzt } from "./quittungen.js";
import { alsGeraet, posteingangVon, state, veroeffentlicheAn } from "./state.js";
import { geheim } from "./tresor.js";

export const LS_BITCHAT_TEILEN = "freedom.bitchat.teilen";

export const bitchatTeilenAn = (): boolean => geheim.getItem(LS_BITCHAT_TEILEN) === "1";

export const bitchatSchluesselBuch = new FunkAdressBuch(geheim, BITCHAT_SCHLUESSEL);

const versand = new FunkAdressVersand({
  art: BITCHAT_SCHLUESSEL,
  zustimmung: bitchatTeilenAn,
  signer: () => (alsGeraet() ? null : state.signer),
  kontakte: kontakteJetzt,
  adresse: async () => {
    const k = bitchatSchluesselVon(await bitchatIdentitaet(geheim));
    return `${k.noise}:${k.signier}`;
  },
  sende: async (wrap, an) => {
    const ziele = await posteingangVon(an).catch(() => [] as string[]);
    return ziele.length > 0 && (await veroeffentlicheAn(wrap, ziele)) > 0;
  },
  speicher: geheim,
  jetzt: () => Math.floor(Date.now() / 1000),
});

/** Zustimmung setzen – eingeschaltet geht es beim nächsten Schlag los. Wer die Schlüssel schon hat, behält sie. */
export async function setzeBitchatTeilen(an: boolean): Promise<void> {
  if (an) {
    await geheim.setItem(LS_BITCHAT_TEILEN, "1");
    versand.bald();
  } else {
    await geheim.removeItem(LS_BITCHAT_TEILEN);
  }
}

/** Für den Dialog: mit wie vielen Kontakten geteilt, von wie vielen Schlüssel da sind. */
export function bitchatSchluesselStand(): { geteilt: number; erhalten: number } {
  const kontakte = new Set(kontakteJetzt());
  return { geteilt: (versand.verteilt()?.an ?? []).filter((k) => kontakte.has(k)).length, erhalten: bitchatSchluesselBuch.zahl(kontakte) };
}

/** Ein Schlag des Abruftakts. */
export async function bitchatSchluesselTakt(): Promise<void> {
  await versand.takt().catch(() => null); // kaputte Identität: nichts senden, nie eine neue anlegen
}

/** Die Bitchat-Schlüssel eines Kontakts? Merken – in der Unterhaltung erscheint nichts. */
export async function alsBitchatSchluessel(w: NostrEvent): Promise<null> {
  if (!state.signer) return null;
  const r = await oeffneBitchatSchluesselUmschlag(w, state.signer, new Set(kontakteJetzt()));
  if (r) await bitchatSchluesselBuch.nimm({ von: r.von, zeit: r.zeit, adresse: `${r.noise}:${r.signier}` }).catch(() => false);
  return null;
}
