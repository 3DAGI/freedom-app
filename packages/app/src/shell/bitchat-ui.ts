/**
 * Bitchat in der Oberfläche (B-36c3, BC-W2–W4 A): nur in der Android-Hülle, unter Netz › Ohne Internet. Ein Knopf schaltet an
 * und aus – nur auf Klick, Android fragt dann nach den Rechten. Ein Dialog nimmt die Zustimmung, die eigenen Schlüssel an
 * Kontakte zu geben (nur als Person), und zeigt, wer gerade in der Nähe ist. Was das Gerät dabei im Funk zeigt, sagt die
 * Grenze „bitchat“ im Datenschutzbericht. Beim Treffen (B-36e2, BC-W5 A, BC-W6 A) zeigt er den eigenen Code und nimmt den des
 * Gegenübers – ist es noch kein Kontakt, erst nach Rückfrage.
 */
import { leseBitchatKarte, type BitchatSchluesselVonKontakt } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import type { BitchatStandArt } from "./bitchat-huelle.js";
import { bitchatSchluesselStand, bitchatTeilenAn, eigeneBitchatKarte, nimmBitchatKarte, setzeBitchatTeilen } from "./bitchat-kontakte.js";
import { bitchatInDerNaehe, bitchatLaeuft, starteBitchat, stoppeBitchat, wennBitchatHaelt } from "./bitchat-weg.js";
import { bestaetige, dialog } from "./dialog.js";
import { kontakteJetzt } from "./quittungen.js";
import { alsGeraet, sprichtFuer } from "./state.js";
import { kontaktName } from "./tabs/raeume.js";
import { tresorEingerichtet, tresorOffen } from "./tresor.js";
import { toast } from "./ui.js";

/** Je Stand der Hülle nach dem Start ein Satz */
const STAND_TEXT: Record<BitchatStandArt, string> = {
  an: "set.bitchatAn",
  bereit: "set.bitchatBereit",
  erlaubnis: "set.bitchatErlaubnis",
  ausgeschaltet: "set.bitchatAusgeschaltet",
  "kein-bluetooth": "set.bitchatKeinBluetooth",
};

/** An oder aus. Die Identität liegt in `geheim` – mit gesperrtem Tresor erst entsperren. */
export async function bitchatKnopf(knopf: HTMLElement, status: HTMLElement | null): Promise<void> {
  const zeige = (text: string): void => {
    if (status) status.textContent = text;
    knopf.dataset.i18n = bitchatLaeuft() ? "set.bitchatAnhalten" : "set.bitchat";
    knopf.textContent = t(knopf.dataset.i18n);
  };
  if (bitchatLaeuft()) {
    await stoppeBitchat();
    return zeige(t("set.bitchatAus"));
  }
  if (tresorEingerichtet() && !tresorOffen()) return toast(t("ein.tresorGesperrt"), true);
  // Hält die Hülle von selbst an, folgt der Knopf (B-36c4)
  wennBitchatHaelt((vonSelbst) => {
    if (vonSelbst) zeige(t("set.bitchatVonSelbstAus"));
  });
  try {
    const s = await starteBitchat();
    zeige(t(s ? STAND_TEXT[s] : "set.bitchatNicht"));
  } catch {
    // eine kaputte Identität (`identitaet-kaputt`) wird nie ersetzt – Bluetooth wieder aus
    await stoppeBitchat();
    zeige(t("set.bitchatIdentitaet"));
  }
}

/** Zustimmung und wer in der Nähe ist. Als Gerät ohne Zustimmung – Kontakte kennen nur die Person. */
export async function bitchatKontakteDialog(): Promise<void> {
  if (tresorEingerichtet() && !tresorOffen()) return toast(t("ein.tresorGesperrt"), true);
  const naehe = bitchatLaeuft() ? bitchatInDerNaehe().map(kontaktName).join(", ") || t("set.bitchatNiemand") : t("set.bitchatAus");
  // Der eigene Code nur als Person; antwortet der Signer nicht (Bunker ohne Netz), fehlt er – scannen geht trotzdem
  const karte = await eigeneBitchatKarte().catch(() => null);
  const ich = sprichtFuer();
  const w = await dialog({
    titel: t("set.bitchatKontakte"),
    text: t("set.bitchatKontakteText"),
    felder: [
      ...(alsGeraet() ? [] : [
        { art: "mehrfach" as const, name: "teilen", label: t("set.bitchatTeilen"), werte: bitchatTeilenAn() ? ["ja"] : [],
          optionen: [{ wert: "ja", text: t("set.bitchatTeilenJa"), hinweis: t("set.bitchatTeilenHinweis") }] },
        { art: "nurlesen" as const, name: "stand", label: t("set.bitchatKontakteStand"), wert: t("set.bitchatKontakteZahl", bitchatSchluesselStand()) },
      ]),
      ...(karte ? [{ art: "qr" as const, name: "karte", label: t("set.bitchatKarte"), wert: karte }] : []),
      { art: "text" as const, name: "gescannt", label: t("set.bitchatKarteScannen"), mono: true, scannen: true },
      { art: "nurlesen" as const, name: "naehe", label: t("set.bitchatNaehe"), wert: naehe },
    ],
    pruefe: (w) => {
      const roh = String(w.gescannt ?? "").trim();
      if (!roh) return null;
      const r = leseBitchatKarte(roh);
      return !r ? t("set.bitchatKarteFalsch") : r.von === ich ? t("set.bitchatKarteEigene") : null;
    },
    ok: t("set.bitchatMerken"),
  });
  if (!w) return;
  if (!alsGeraet()) await setzeBitchatTeilen(Array.isArray(w.teilen) && w.teilen.includes("ja"));
  const r = leseBitchatKarte(String(w.gescannt ?? ""));
  if (r && r.von !== ich) await uebernimmKarte(r);
}

/** Schlüssel aus dem Code des Gegenübers übernehmen – ist es noch kein Kontakt, erst nach Rückfrage anlegen (BC-W6 A). */
async function uebernimmKarte(r: BitchatSchluesselVonKontakt): Promise<void> {
  const name = kontaktName(r.von);
  if (!kontakteJetzt().includes(r.von)) {
    if (!(await bestaetige({ titel: t("set.bitchatKarteNeuTitel"), text: t("set.bitchatKarteNeuText", { name }), ok: t("set.bitchatKarteAnlegen") }))) return;
    const { legeKontaktAn } = await import("./tabs/kommunikation.js");
    legeKontaktAn(r.von);
  }
  await nimmBitchatKarte(r);
  toast(t("set.bitchatKarteUebernommen", { name }));
}
