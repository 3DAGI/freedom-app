/**
 * Senden aus der Wallet (Schritt 12.7a): Knopf „Senden“ in Währung › Übersicht.
 *
 * Ein Dialog für Ziel und Betrag (Ziel auch per QR-Code), dann die
 * Bestätigung mit dem Betrag in beiden Einheiten und dem ganzen Ziel – erst
 * dann `zahle(zahlschienen(), …)`. Die Schiene folgt dem Ziel (`senden.ts`);
 * ein unklarer Ausgang wird nie von selbst wiederholt.
 */
import { zahle } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { ausLamports, ausMsat } from "../preis-anzeige.js";
import { fehlerText } from "../protokoll-texte.js";
import { geltenderBetrag, leseSendeZiel, zielAnzeige, type SendeFall, type SendeZiel } from "../senden.js";
import { bestaetige, dialog, hinweis } from "./dialog.js";
import { aktualisiereKurs, aktuellerKurs } from "./marktkurs.js";
import { $ } from "./ui.js";
import { zahlschienen } from "./zahlschienen.js";

const FALL: Record<SendeFall, string> = {
  leer: "senden.fallLeer", unbekannt: "senden.fallUnbekannt", "rechnung-unlesbar": "senden.fallRechnungUnlesbar",
  "rechnung-ohne-betrag": "senden.fallOhneBetrag", "nur-sol": "senden.fallNurSol", referenz: "senden.fallReferenz", betrag: "senden.fallBetrag",
};

/** Was am Dialog nicht stimmt – null, wenn Ziel und Betrag passen. */
function fehlerIm(an: string, betrag: string): string | null {
  const z = leseSendeZiel(an);
  if ("fall" in z) return t(FALL[z.fall]);
  const b = geltenderBetrag(z, betrag);
  if (b === "widerspruch") return t("senden.widerspruch", { betrag: anzeige(z, z.betrag!.wert) });
  if (!b) return t(z.rail === "lightning" ? "senden.betragSats" : "senden.betragSol");
  return null;
}

function anzeige(z: SendeZiel, wert: number): string {
  const kurs = aktuellerKurs();
  return z.rail === "lightning" ? ausMsat(wert, kurs) : ausLamports(wert, kurs);
}

/** Senden: Dialog, Bestätigung, zahlen. */
export async function sende(): Promise<void> {
  void aktualisiereKurs().catch(() => undefined);
  const w = await dialog({
    titel: t("senden.titel"),
    text: t("senden.text"),
    felder: [
      { art: "text", name: "an", label: t("senden.an"), pflicht: true, mono: true, scannen: true },
      { art: "text", name: "betrag", label: t("senden.betrag") },
    ],
    pruefe: (w) => fehlerIm(String(w.an ?? ""), String(w.betrag ?? "")),
    ok: t("senden.weiter"),
  });
  if (!w) return;
  const z = leseSendeZiel(String(w.an));
  const betrag = "fall" in z ? undefined : geltenderBetrag(z, String(w.betrag ?? ""));
  if ("fall" in z || !betrag || betrag === "widerspruch") return;
  const text = anzeige(z, betrag.wert);
  const frage = t(z.rail === "lightning" ? "senden.bestaetigenLn" : "senden.bestaetigenSol", { betrag: text, an: zielAnzeige(z) });
  if (!(await bestaetige({ titel: t("senden.titel"), text: frage, ok: t("senden.senden") }))) return;
  try {
    const beleg = await zahle(zahlschienen(), { ziel: z.ziel, betrag, zweck: "senden", ...(z.referenz ? { referenz: z.referenz } : {}) });
    await hinweis(t("senden.titel"), t(z.rail === "lightning" ? "senden.gesendetLn" : "senden.gesendetSol", { betrag: text, ref: beleg.ref }));
  } catch (e) {
    await hinweis(t("senden.titel"), t("senden.fehler", { fehler: fehlerText(e) }));
  }
}

export function wireSenden(): void {
  const knopf = $("#wallet-senden") as HTMLButtonElement | null;
  if (knopf) knopf.onclick = () => void sende();
}
