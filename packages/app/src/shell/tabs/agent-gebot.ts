/**
 * Gebot und Schalter „sats / SOL“ auf der Agent-Seite (Schritt 12.4b, Sammlung A-1).
 *
 * Der Schalter wählt die Schiene für KI (`ki-schiene.ts`, gemerkt in
 * `freedom.ki.schiene`); ohne Wahl gilt die Standard-Schiene. Das Gebot steht in
 * der gewählten Einheit und wird nur über `kurs.ts` umgerechnet – ohne Kurs kein
 * Gebot in SOL. Sichtbar nur, wo gezahlt werden kann: nicht im Tarif „Free“,
 * nicht für dieses Gerät oder den eigenen Knoten.
 *
 * Mit SOL ohne Kanal bietet die Fehlerblase „Kanal anbieten“ an: Währung ›
 * Hinterlegen mit diesem Provider, dort öffnet `oeffneZahlkanal()` den Kanal.
 */
import { t } from "../../i18n.js";
import { gebotAlsText, gebotInSats, kiSchiene, waehleKiSchiene, type Schiene } from "../../ki-schiene.js";
import { knotenModellAus } from "../../knoten-wahl.js";
import { lokalesModellAus } from "../../ki-lokal.js";
import { ausMsat } from "../../preis-anzeige.js";
import { aktualisiereKurs, aktuellerKurs } from "../marktkurs.js";
import { $, toast } from "../ui.js";

const feld = (): HTMLInputElement => $("#ai-bid") as HTMLInputElement;
const schalter = (): HTMLSelectElement | null => $("#ai-schiene") as HTMLSelectElement | null;

/** Das Gebot in ganzen sats – `undefined`, wenn das Feld keins ergibt (mit SOL auch: kein Kurs). */
export function leseGebot(): number | undefined {
  return gebotInSats(feld().value, kiSchiene(), aktuellerKurs()?.satsProSol);
}

/** Ein Gebot in sats ins Feld schreiben, in der gewählten Einheit (Erneut-Knopf, Umschalten). */
export function setzeGebot(sats: number): void {
  feld().value = gebotAlsText(sats, kiSchiene(), aktuellerKurs()?.satsProSol);
}

/** Feld, Einheit und Sichtbarkeit nach Tarif und Modell. */
export function zeigeGebot(): void {
  const huelle = $("#bid-wrap") as HTMLElement | null;
  if (!huelle) return;
  const tarif = ($("#ai-tier") as HTMLSelectElement | null)?.value ?? "auto";
  const modell = ($("#ai-model") as HTMLInputElement | null)?.value;
  const gratis = tarif === "free" || !!lokalesModellAus(modell) || knotenModellAus(modell) !== null;
  huelle.style.display = gratis ? "none" : "";
  const schiene = kiSchiene();
  const wahl = schalter();
  if (wahl) wahl.value = schiene;
  const f = feld();
  f.step = schiene === "solana" ? "any" : "1";
  f.min = schiene === "solana" ? "0" : "1";
  f.title = t(schiene === "solana" ? "agent.gebotSolTitel" : "agent.gebotSatsTitel");
}

/** Schiene umschalten: das Gebot in die neue Einheit umrechnen (nur über `kurs.ts`), dann merken. */
async function wechsleSchiene(neu: Schiene): Promise<void> {
  const vorher = leseGebot();
  waehleKiSchiene(neu);
  // Erst die Einheit, dann warten: das alte Feld darf nie in der neuen Einheit gelesen werden
  feld().value = "";
  zeigeGebot();
  if (neu === "solana" && !aktuellerKurs()) await aktualisiereKurs();
  // Ohne Kurs bleibt das Feld in SOL leer – gesendet wird dann nichts (askAi sagt es)
  if (!feld().value) setzeGebot(vorher ?? GEBOT_VORGABE_SATS);
}

/**
 * „Kanal anbieten“ (12.4b, E3 A): zu Währung › Hinterlegen, der Provider steht
 * schon im Feld, der Betrag ist dran. Öffnen tut erst der Knopf dort.
 */
export function kanalAnbieten(provider: string, zuWaehrung: () => void): void {
  zuWaehrung();
  document.querySelector<HTMLElement>('[data-subtab-group="wallet"] [data-subtab="lp"]')?.click();
  const pk = $("#dep-provider") as HTMLInputElement | null;
  if (pk) pk.value = provider;
  const karte = $("#kanal-karte") as HTMLElement | null;
  karte?.scrollIntoView({ block: "center" });
  ($("#kanal-betrag") as HTMLInputElement | null)?.focus();
}

/** Vorgabe des Gebots in sats – so steht es im Feld (`index.html`). */
export const GEBOT_VORGABE_SATS = 100;

/** Wie das Gebot im Text einer Rückfrage steht: zuerst in der gewählten Einheit. */
export function gebotAnzeige(sats: number): string {
  return ausMsat(sats * 1000, aktuellerKurs(), kiSchiene() === "solana" ? "sol" : "sats");
}

/** Kein gültiges Gebot: sagen warum – mit SOL meist der fehlende Kurs. Gesendet wird nichts. */
export function meldeGebotFehlt(): void {
  toast(t(kiSchiene() === "solana" && !aktuellerKurs() ? "agent.gebotOhneKurs" : "agent.gebotUngueltig"), true);
}

export function wireGebot(): void {
  const wahl = schalter();
  if (wahl) wahl.addEventListener("change", () => void wechsleSchiene(wahl.value === "solana" ? "solana" : "lightning"));
  ($("#ai-tier") as HTMLSelectElement | null)?.addEventListener("change", zeigeGebot);
  // Mit SOL steht die Vorgabe (sats) nie als SOL im Feld: erst leer, mit Kurs umgerechnet
  if (kiSchiene() === "solana") {
    feld().value = "";
    void aktualisiereKurs().then(() => { if (!feld().value) setzeGebot(GEBOT_VORGABE_SATS); });
  }
  zeigeGebot();
}
