/**
 * Seite Netz › Prüfung (Freedom-Prüfung P2b2, E7): je Provider Stand,
 * Verfügbarkeit, Antwortzeit und Quelle der Zahl (`pruefZeilen()`) – aus der
 * eigenen Messung; Prüfer fielen mit P5a weg. Geladen nur beim Öffnen des
 * Reiters oder auf Klick – nie beim Start. Nur DOM mit Text: Schlüssel und
 * Zahlen sind Fremddaten.
 */
import { t, gebietsschema } from "../../i18n.js";
import { pruefZeilen, type PruefZeile } from "../../pruef-anzeige.js";
import { pkShort } from "../../shell-logic.js";
import { fehlerText } from "../../protokoll-texte.js";
import { providerMitStand } from "../state.js";
import { $, el } from "../ui.js";

const STAND: Record<PruefZeile["stand"], string> = {
  normal: "pruef.standGeprueft", neu: "pruef.standNeu", herabgestuft: "pruef.standHerabgestuft", ausgefallen: "pruef.standAusgefallen",
};

function zeilenText(z: PruefZeile): string {
  const stand = t(STAND[z.stand]);
  if (z.quelle === "keine") return t("pruef.zeileOhne", { provider: pkShort(z.pk), stand });
  const antwort = z.antwortMs === undefined ? t("pruef.antwortUnbekannt") : t("pruef.antwortSek", { s: (z.antwortMs / 1000).toLocaleString(gebietsschema(), { maximumFractionDigits: 1 }) });
  return t("pruef.zeile", { provider: pkShort(z.pk), stand, prozent: z.verfuegbarkeit ?? 0, antwort, quelle: t("pruef.quelleEigene") });
}

/** Provider und ihr Stand – nur auf Klick bzw. beim Öffnen des Reiters. */
export async function zeigePruefung(): Promise<void> {
  const box = $("#pruefung-liste");
  if (!box) return;
  box.replaceChildren(el("div", t("pruef.lade"), "muted"));
  try {
    const zeilen = pruefZeilen((await providerMitStand()).map((p) => ({ pk: p.caps.pubkey, messung: p.messung })));
    box.replaceChildren();
    if (zeilen.length === 0) box.append(el("div", t("pruef.keineProvider"), "muted"));
    for (const z of zeilen) box.append(el("div", zeilenText(z), "usage-row"));
  } catch (e) {
    box.replaceChildren(el("div", fehlerText(e), "muted"));
  }
}

export function wirePruefung(): void {
  document.querySelector<HTMLElement>('[data-subtab-group="netz"] [data-subtab="pruefung"]')?.addEventListener("click", () => void zeigePruefung());
  const laden = $("#pruefung-laden") as HTMLButtonElement | null;
  if (laden) laden.onclick = () => void zeigePruefung();
}
