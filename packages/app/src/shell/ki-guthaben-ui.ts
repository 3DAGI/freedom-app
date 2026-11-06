/**
 * Oberfläche des KI-Guthabens (RM2d, `docs/RM2-ENTWURF.md` V3, V6): Mint wählen, Guthaben laden, offene Ladungen
 * abholen – über den Cashu-Topf aus `ki-pfand.ts`. Kopf und Seitenleiste zeigen das Guthaben über
 * `setzeKiGuthabenAnzeige()` (`ui.ts` lädt den Topf nicht selbst). Verwahrt ist es von der Mint – die Karte sagt es.
 * Bezahlt wird nur über die Zahlschienen (Zweck „cashu“), nie von selbst wiederholt; Fehler nur über ihre Kennung.
 */
import { zahle } from "@freedomstack/protocol";
import { CASHU_HOECHST_SAT } from "../cashu-topf.js";
import { t } from "../i18n.js";
import { CASHU_TEXT, cashuFehlerText, guthabenStand, holeOffene, ladeGuthaben } from "../ki-guthaben.js";
import { satsText } from "../preis-anzeige.js";
import { ganzeSats } from "../shell-logic.js";
import { bestaetige, dialog, hinweis } from "./dialog.js";
import { cashuTopf } from "./ki-pfand.js";
import { tresorOffen, verlangeTresor } from "./tresor.js";
import { setzeKiGuthabenAnzeige, toast, updateSidebarBalances } from "./ui.js";
import { zahlschienen } from "./zahlschienen.js";

const stand = () => guthabenStand(cashuTopf);

/** Was Kopf und Seitenleiste zeigen: ohne Mint oder Tresor „—“, sonst das freie Guthaben. */
function anzeige(): { text: string; titel: string } {
  const s = stand();
  if (!s.mint || !tresorOffen()) return { text: "—", titel: t("cashu.ohneMint") };
  return { text: satsText(s.sats * 1000), titel: t("cashu.verwahrtVon", { mint: s.host! }) };
}

/** Die Karte auf der Wallet-Seite neu zeichnen – nur Text. */
export function zeigeKiGuthaben(): void {
  const s = stand();
  const offen = !!s.mint && tresorOffen();
  const setze = (id: string, text: string) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  setze("cashu-stand", offen ? satsText(s.sats * 1000) : "—");
  setze("cashu-mint", offen ? t("cashu.verwahrtVon", { mint: s.host! }) : t("cashu.ohneMint"));
  const teile = [
    ...(offen && s.imPfand > 0 ? [t("cashu.imPfand", { sats: satsText(s.imPfand * 1000) })] : []),
    ...(offen && s.offen > 0 ? [t("cashu.offen", { sats: satsText(s.offen * 1000) })] : []),
  ];
  setze("cashu-details", teile.join(" · "));
  document.getElementById("cashu-laden")?.toggleAttribute("disabled", !offen);
  document.getElementById("cashu-abholen")?.classList.toggle("hidden", !(offen && s.offen > 0));
  updateSidebarBalances();
}

async function waehleMint(): Promise<void> {
  if (!await verlangeTresor(t("cashu.wofuer"))) return;
  const w = await dialog({
    titel: t("cashu.mintTitel"), text: t("cashu.mintText"),
    felder: [{ art: "text", name: "mint", label: t("cashu.mintAdresse"), wert: cashuTopf.mint() ?? "", pflicht: true, mono: true }],
    ok: t("cashu.mintOk"),
  });
  if (!w) return;
  try {
    const { name } = await cashuTopf.waehleMint(String(w.mint));
    toast(t("cashu.mintGewaehlt", { name: name ?? stand().host ?? "" }));
  } catch (e) {
    await hinweis(t("cashu.mintTitel"), cashuFehlerText(e));
  }
  zeigeKiGuthaben();
}

async function lade(): Promise<void> {
  const s = stand();
  if (!s.mint || !await verlangeTresor(t("cashu.wofuer"))) return;
  const w = await dialog({
    titel: t("cashu.ladenTitel"), text: t("cashu.ladenText", { mint: s.host!, hoechst: satsText(CASHU_HOECHST_SAT * 1000) }),
    felder: [{ art: "text", name: "sats", label: t("cashu.betrag"), pflicht: true }],
    pruefe: (v) => ganzeSats(v.sats) ? null : t(CASHU_TEXT.betrag),
    ok: t("cashu.weiter"),
  });
  if (!w) return;
  const sats = ganzeSats(w.sats);
  const gebuehr = s.gebuehrPpk > 0 ? t("cashu.gebuehr", { ppk: String(s.gebuehrPpk) }) : "";
  if (!await bestaetige({ titel: t("cashu.ladenTitel"), text: `${t("cashu.ladenFrage", { sats: satsText(sats * 1000), mint: s.host! })}${gebuehr ? ` ${gebuehr}` : ""}` })) return;
  try {
    const r = await ladeGuthaben({
      topf: cashuTopf,
      zahle: (rechnung, msat) => zahle(zahlschienen(), { ziel: rechnung, betrag: { einheit: "msat", wert: msat }, zweck: "cashu" }),
    }, sats);
    if (r.art === "geladen") toast(t("cashu.geladen", { sats: satsText(r.sats * 1000) }));
    else await hinweis(t("cashu.ladenTitel"), t("cashu.ladungOffen"));
  } catch (e) {
    await hinweis(t("cashu.ladenTitel"), cashuFehlerText(e));
  }
  zeigeKiGuthaben();
}

async function abholen(): Promise<void> {
  try {
    const r = await holeOffene(cashuTopf);
    if (r.sats > 0) toast(t("cashu.geladen", { sats: satsText(r.sats * 1000) }));
    if (r.offen > 0) await hinweis(t("cashu.ladenTitel"), t("cashu.ladungOffen"));
  } catch (e) {
    await hinweis(t("cashu.ladenTitel"), cashuFehlerText(e));
  }
  zeigeKiGuthaben();
}

export function wireKiGuthaben(): void {
  setzeKiGuthabenAnzeige(anzeige);
  document.getElementById("cashu-mint-waehlen")?.addEventListener("click", () => void waehleMint());
  document.getElementById("cashu-laden")?.addEventListener("click", () => void lade());
  document.getElementById("cashu-abholen")?.addEventListener("click", () => void abholen());
  zeigeKiGuthaben();
}
