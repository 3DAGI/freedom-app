/**
 * Kontakt prüfen im Chat (Sammlung Neuordnung, B-4).
 *
 * Der Dialog zeigt den Sicherheitscode aus beiden Schlüsseln – als Ziffern
 * zum Vorlesen und als QR-Code zum Scannen. Wer den Code des Kontakts
 * einscannt oder eintippt, bekommt den Vergleich von der App; wer vorliest,
 * bestätigt selbst. Erst dann merkt die App den Kontakt als geprüft.
 * Gesehen wird nur, was ohnehin öffentlich ist; nichts geht über ein Relay.
 */
import { sicherheitscode, sicherheitscodeQr, sicherheitscodeStimmt } from "@freedomstack/protocol";
import { gebietsschema, t } from "../i18n.js";
import { geprueftAm, merkeGeprueft } from "../kontakt-pruefung.js";
import { dialog } from "./dialog.js";
import { sprichtFuer } from "./state.js";
import { geheim } from "./tresor.js";
import { toast } from "./ui.js";

/** Stand für die Kopfzeile der Unterhaltung. */
export function pruefStand(pk: string): string {
  const am = geprueftAm(geheim, pk);
  return am ? t("komm.geprueftAm", { datum: new Date(am * 1000).toLocaleDateString(gebietsschema()) }) : t("komm.nichtGeprueft");
}

/** Den Dialog öffnen – für eine 1:1-Unterhaltung mit diesem Schlüssel. */
export async function pruefeKontakt(pk: string, name: string): Promise<boolean> {
  const ich = sprichtFuer();
  const code = ich ? sicherheitscode(ich, pk) : undefined;
  if (!code) {
    toast(t("komm.pruefUnmoeglich"), true);
    return false;
  }
  const w = await dialog({
    titel: t("komm.pruefTitel", { name }),
    text: `${t("komm.pruefText")} ${pruefStand(pk)}`,
    felder: [
      { name: "code", label: t("komm.pruefCode"), art: "nurlesen", wert: code },
      { name: "qr", label: t("komm.pruefQr"), art: "qr", wert: sicherheitscodeQr(code) },
      { name: "eingabe", label: t("komm.pruefEingabe"), art: "text", mono: true, scannen: true },
    ],
    ok: t("komm.pruefOk"),
    pruefe: (werte) => {
      const eingabe = String(werte.eingabe ?? "").trim();
      return eingabe && !sicherheitscodeStimmt(eingabe, code) ? t("komm.pruefFalsch") : null;
    },
  });
  if (!w) return false;
  await merkeGeprueft(geheim, pk);
  const stand = document.querySelector("#chat-thread .pruef-stand");
  if (stand) stand.textContent = pruefStand(pk);
  toast(t("komm.pruefGemerkt", { name }));
  return true;
}
