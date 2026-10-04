/**
 * Seite Netz › Prüfung (Freedom-Prüfung P2b2, E7): je Provider Stand,
 * Verfügbarkeit, Antwortzeit und Quelle der Zahl (`pruefZeilen()`), dazu die
 * Prüfer, denen der Nutzer folgt. Geladen nur beim Öffnen des Reiters oder auf
 * Klick – nie beim Start. Nur DOM mit Text: Schlüssel und Zahlen sind Fremddaten.
 */
import { FREEDOM_PRUEFER } from "@freedomstack/protocol";
import { t, gebietsschema } from "../../i18n.js";
import { pruefZeilen, type PruefZeile } from "../../pruef-anzeige.js";
import { eigenePruefer, entfolgePruefer, folgePruefer, PRUEFER_MAX } from "../../pruefer-wahl.js";
import { pkShort, schluesselAusEingabe } from "../../shell-logic.js";
import { fehlerText } from "../../protokoll-texte.js";
import { providerMitStand } from "../state.js";
import { $, el, toast } from "../ui.js";

const STAND: Record<PruefZeile["stand"], string> = {
  normal: "pruef.standGeprueft", neu: "pruef.standNeu", herabgestuft: "pruef.standHerabgestuft", ausgefallen: "pruef.standAusgefallen",
};

function zeilenText(z: PruefZeile): string {
  const stand = t(STAND[z.stand]);
  if (z.quelle === "keine") return t("pruef.zeileOhne", { provider: pkShort(z.pk), stand });
  const quelle = z.quelle === "eigene" ? t("pruef.quelleEigene") : t("pruef.quellePruefer", { n: z.pruefer ?? 1 });
  const antwort = z.antwortMs === undefined ? t("pruef.antwortUnbekannt") : t("pruef.antwortSek", { s: (z.antwortMs / 1000).toLocaleString(gebietsschema(), { maximumFractionDigits: 1 }) });
  return t("pruef.zeile", { provider: pkShort(z.pk), stand, prozent: z.verfuegbarkeit ?? 0, antwort, quelle });
}

/** Provider und ihr Stand – nur auf Klick bzw. beim Öffnen des Reiters. */
export async function zeigePruefung(): Promise<void> {
  const box = $("#pruefung-liste");
  if (!box) return;
  box.replaceChildren(el("div", t("pruef.lade"), "muted"));
  try {
    const zeilen = pruefZeilen((await providerMitStand()).map((p) => ({ pk: p.caps.pubkey, messung: p.messung, pruefung: p.pruefung })));
    box.replaceChildren();
    if (zeilen.length === 0) box.append(el("div", t("pruef.keineProvider"), "muted"));
    for (const z of zeilen) box.append(el("div", zeilenText(z), "usage-row"));
  } catch (e) {
    box.replaceChildren(el("div", fehlerText(e), "muted"));
  }
  zeigePrueferListe();
}

function zeigePrueferListe(): void {
  const box = $("#pruefer-liste");
  if (!box) return;
  box.replaceChildren();
  for (const pk of FREEDOM_PRUEFER) box.append(el("div", t("pruef.standardPruefer", { pruefer: pkShort(pk) }), "usage-row"));
  const eigene = eigenePruefer(localStorage);
  if (FREEDOM_PRUEFER.length === 0 && eigene.length === 0) box.append(el("div", t("pruef.keinPruefer"), "muted"));
  for (const pk of eigene) {
    const zeile = el("div", pkShort(pk), "usage-row");
    const weg = el("button", t("pruef.entfolgen"), "ghost");
    weg.type = "button";
    weg.onclick = () => { entfolgePruefer(localStorage, pk); zeigePrueferListe(); };
    zeile.append(weg);
    box.append(zeile);
  }
}

export function wirePruefung(): void {
  document.querySelector<HTMLElement>('[data-subtab-group="netz"] [data-subtab="pruefung"]')?.addEventListener("click", () => void zeigePruefung());
  const laden = $("#pruefung-laden") as HTMLButtonElement | null;
  if (laden) laden.onclick = () => void zeigePruefung();
  const folgen = $("#pruefer-folgen") as HTMLButtonElement | null;
  const eingabe = $("#pruefer-neu") as HTMLInputElement | null;
  if (!folgen || !eingabe) return;
  folgen.onclick = async () => {
    const { decodeNpub } = await import("../../identity.js");
    const pk = schluesselAusEingabe(eingabe.value, decodeNpub);
    if (!pk) { toast(t("pruef.schluesselUngueltig"), true); return; }
    if (!folgePruefer(localStorage, pk)) { toast(t("pruef.zuViele", { n: PRUEFER_MAX }), true); return; }
    eingabe.value = "";
    zeigePrueferListe();
  };
}
