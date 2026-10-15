/**
 * Öffentliche Kennung kopieren, privaten Schlüssel zeigen (C-41, Oberflächen-Review 15.10.2026).
 *
 * Bis C-41 kopierte ein Klick auf die kurze Kennung im Profil den *privaten* Schlüssel – eine
 * gefährliche Aktion auf einem harmlos aussehenden Element; ohne Zwischenablage stand er sogar als
 * Meldung unten im Bild. Jetzt kopiert der Klick nur die öffentliche Kennung (npub, wie „Teilen“).
 * Den privaten Schlüssel zeigt ein eigener Knopf erst nach einer Warnung, nur im Dialog – nie als
 * Meldung, nie gespeichert; kopiert wird er nur über den Knopf im Dialog.
 */
import { t } from "../i18n.js";
import { bestaetige, dialog } from "./dialog.js";
import { mitBunker, mitRohemSchluessel, state } from "./state.js";
import { toast } from "./ui.js";

/** Die öffentliche Kennung als npub in die Zwischenablage – ohne Zwischenablage zum Markieren im Dialog. */
export async function kopiereKennung(): Promise<void> {
  if (!state.keypair) return;
  const { encodeNpub } = await import("../identity.js");
  const npub = encodeNpub(state.keypair.pk);
  try {
    await navigator.clipboard.writeText(npub);
    toast(t("ein.pubkeyKopiert"));
  } catch {
    await dialog({ titel: t("ein.pubkeyTitel"), felder: [{ art: "nurlesen", name: "pk", label: t("ein.pubkey"), wert: npub }], ok: t("dlg.schliessen"), abbrechen: false });
  }
}

/** Den privaten Schlüssel (nsec) zeigen – erst die Warnung, dann nur im Dialog. Mit Bunker gibt es ihn nicht. */
export async function zeigePrivatenSchluessel(): Promise<void> {
  if (!state.keypair) return;
  if (mitBunker()) { toast(t("ein.nurImSigner"), true); return; }
  if (!(await bestaetige({ titel: t("ein.skTitel"), text: t("ein.skWarnung"), ok: t("ein.skZeigen"), gefahr: true }))) return;
  const { encodeNsec } = await import("../identity.js");
  const nsec = mitRohemSchluessel(t("ein.fuerExport"), encodeNsec);
  await dialog({
    titel: t("ein.skTitel"), text: t("ein.skHinweis"), ok: t("dlg.schliessen"), abbrechen: false,
    felder: [{ art: "nurlesen", name: "sk", label: t("ein.skFeld"), wert: nsec }],
  });
}
