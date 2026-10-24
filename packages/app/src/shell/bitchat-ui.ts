/**
 * Bitchat in der Oberfläche (B-36c3, BC-W2–W4 A): nur in der Android-Hülle, unter Netz › Ohne Internet. Ein Knopf schaltet an
 * und aus – nur auf Klick, Android fragt dann nach den Rechten. Ein Dialog nimmt die Zustimmung, die eigenen Schlüssel an
 * Kontakte zu geben (nur als Person), und zeigt, wer gerade in der Nähe ist. Was das Gerät dabei im Funk zeigt, sagt die
 * Grenze „bitchat“ im Datenschutzbericht.
 */
import { t } from "../i18n.js";
import type { BitchatStandArt } from "./bitchat-huelle.js";
import { bitchatSchluesselStand, bitchatTeilenAn, setzeBitchatTeilen } from "./bitchat-kontakte.js";
import { bitchatInDerNaehe, bitchatLaeuft, starteBitchat, stoppeBitchat } from "./bitchat-weg.js";
import { dialog } from "./dialog.js";
import { alsGeraet } from "./state.js";
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
  const w = await dialog({
    titel: t("set.bitchatKontakte"),
    text: t("set.bitchatKontakteText"),
    felder: [
      ...(alsGeraet() ? [] : [
        { art: "mehrfach" as const, name: "teilen", label: t("set.bitchatTeilen"), werte: bitchatTeilenAn() ? ["ja"] : [],
          optionen: [{ wert: "ja", text: t("set.bitchatTeilenJa"), hinweis: t("set.bitchatTeilenHinweis") }] },
        { art: "nurlesen" as const, name: "stand", label: t("set.bitchatKontakteStand"), wert: t("set.bitchatKontakteZahl", bitchatSchluesselStand()) },
      ]),
      { art: "nurlesen" as const, name: "naehe", label: t("set.bitchatNaehe"), wert: naehe },
    ],
    ok: t("set.bitchatMerken"),
  });
  if (w && !alsGeraet()) await setzeBitchatTeilen(Array.isArray(w.teilen) && w.teilen.includes("ja"));
}
