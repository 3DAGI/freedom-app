/**
 * Verlauf in Währung › Übersicht (Schritt 12.7c): die eigenen Zahlungen aus dem
 * Zahlungsbuch (Tresor, `zahlungsbuch.ts`) – gezeigt, sobald die Seite offen
 * ist, ohne Netz. Der Verlauf der Lightning-Wallet (NWC, auch Eingänge) nur
 * auf Klick; was die Wallet schickt, steht nur als Text da.
 */
import type { Zweck } from "@freedomstack/protocol";
import { gebietsschema, t } from "../i18n.js";
import { satsText, solText } from "../preis-anzeige.js";
import { fehlerText } from "../protokoll-texte.js";
import { leseZahlungen, type Zahlung } from "../zahlungsbuch.js";
import { geheim } from "./tresor.js";
import { $, el } from "./ui.js";
import { lightningVerlauf } from "./zahlschienen.js";

const wann = (s: number): string => new Date(s * 1000).toLocaleString(gebietsschema());

const ZWECK: Record<Zweck, string> = {
  zap: "verlauf.zweck.zap", job: "verlauf.zweck.job", sitzung: "verlauf.zweck.sitzung", deposit: "verlauf.zweck.deposit",
  trinkgeld: "verlauf.zweck.trinkgeld", gebuehr: "verlauf.zweck.gebuehr", swap: "verlauf.zweck.swap", relay: "verlauf.zweck.relay",
  anforderung: "verlauf.zweck.anforderung", senden: "verlauf.zweck.senden",
};

/** Ziel zum Anzeigen: Adressen ganz, Rechnungen gekürzt. */
function ziel(z: Zahlung): string {
  return z.rail === "lightning" && !z.ziel.includes("@") ? `${z.ziel.slice(0, 16)}…` : z.ziel;
}

/** Das Zahlungsbuch zeigen – beim Öffnen der Seite. */
export function zeigeZahlungen(): void {
  const box = $("#verlauf-liste");
  if (!box) return;
  const alle = leseZahlungen(geheim);
  box.replaceChildren(...(alle.length === 0 ? [el("div", t("verlauf.leer"), "muted")] : alle.map((z) => {
    const zeile = el("div", t("verlauf.zeile", {
      wann: wann(z.zeit), zweck: t(ZWECK[z.zweck]),
      betrag: z.einheit === "msat" ? satsText(z.wert) : solText(z.wert), an: ziel(z),
    }), "verlauf-zeile");
    zeile.title = z.ref;
    return zeile;
  })));
}

async function ladeLightning(): Promise<void> {
  const box = $("#verlauf-ln-liste");
  if (!box) return;
  box.textContent = "…";
  try {
    const liste = await lightningVerlauf();
    if (!liste) return void (box.textContent = t("verlauf.lnOhne"));
    if (liste.length === 0) return void (box.textContent = t("verlauf.lnLeer"));
    box.replaceChildren(...liste.map((b) => {
      const zeile = el("div", t(b.richtung === "ein" ? "verlauf.lnEin" : "verlauf.lnAus", { wann: wann(b.zeit), betrag: satsText(b.msat) }), "verlauf-zeile");
      if (b.notiz) zeile.append(el("span", ` · ${b.notiz}`, "muted"));
      return zeile;
    }));
  } catch (e) {
    box.textContent = t("verlauf.lnFehler", { fehler: fehlerText(e) });
  }
}

export function wireVerlauf(): void {
  const knopf = $("#verlauf-ln") as HTMLButtonElement | null;
  if (knopf) knopf.onclick = () => void ladeLightning();
}
