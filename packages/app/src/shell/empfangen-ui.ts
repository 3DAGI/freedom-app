/**
 * Empfangen in die Wallet (Schritt 12.7b): Knopf „Empfangen“ in Währung › Übersicht.
 *
 * Lightning: eine Rechnung der eigenen Wallet über NWC (`eigeneRechnung()`,
 * Betrag Pflicht, Beschreibung leer). SOL: eine frische Adresse der
 * eingebauten Wallet, sonst – ausdrücklich genannt – die der verbundenen
 * (`eigeneSolAdresse()`). Gezeigt als QR-Code und Text zum Kopieren; nichts
 * geht an ein Relay, nichts wird gemerkt außer der vergebenen Adresse.
 */
import { t } from "../i18n.js";
import { ausLamports, ausMsat } from "../preis-anzeige.js";
import { fehlerText } from "../protokoll-texte.js";
import { empfangsLink } from "../empfangen.js";
import { sendeBetrag } from "../senden.js";
import { standardSchiene } from "../standard-schiene.js";
import { dialog, hinweis } from "./dialog.js";
import { aktualisiereKurs, aktuellerKurs } from "./marktkurs.js";
import { $ } from "./ui.js";
import { eigeneRechnung, eigeneSolAdresse } from "./zahlschienen.js";

/** Empfangen: Währung und Betrag wählen, dann Rechnung bzw. Adresse als QR-Code. */
export async function empfange(): Promise<void> {
  void aktualisiereKurs().catch(() => undefined);
  const titel = t("empf.titel");
  const w = await dialog({
    titel,
    felder: [
      // Vorauswahl nach der Standard-Schiene (12.1) – gewählt wird trotzdem jedes Mal
      { art: "wahl", name: "art", label: t("empf.womit"), wert: standardSchiene(), optionen: [
        { wert: "lightning", text: t("empf.lightning") }, { wert: "solana", text: t("empf.solana") },
      ] },
      { art: "text", name: "betrag", label: t("empf.betrag") },
    ],
    pruefe: (w) => {
      const b = String(w.betrag ?? "").trim();
      if (w.art === "solana") return b && !sendeBetrag("solana", b) ? t("senden.betragSol") : null;
      return sendeBetrag("lightning", b) ? null : t("empf.betragSats");
    },
    ok: t("empf.weiter"),
  });
  if (!w) return;
  const kurs = aktuellerKurs();
  try {
    if (w.art !== "solana") {
      const msat = sendeBetrag("lightning", String(w.betrag))!.wert;
      const rechnung = await eigeneRechnung(msat);
      if (!rechnung) return hinweis(titel, t("empf.ohneNwc"));
      return zeige(titel, t("empf.lnText", { betrag: ausMsat(msat, kurs) }), empfangsLink({ rechnung }), t("empf.rechnung"), rechnung);
    }
    const lamports = String(w.betrag ?? "").trim() ? sendeBetrag("solana", String(w.betrag))?.wert : undefined;
    const r = await eigeneSolAdresse();
    if ("fehlt" in r) return hinweis(titel, t(r.fehlt === "vorrat" ? "empf.vorratLeer" : "empf.ohneSol"));
    const text = [
      lamports ? t("empf.solBetrag", { betrag: ausLamports(lamports, kurs) }) : t("empf.solOhneBetrag"),
      t(r.art === "frisch" ? "empf.solFrisch" : "empf.solVerbunden"),
    ].join(" ");
    return zeige(titel, text, empfangsLink({ adresse: r.adresse, lamports }), t("empf.adresse"), r.adresse);
  } catch (e) {
    await hinweis(titel, t("zahl.fehler", { fehler: fehlerText(e) }));
  }
}

async function zeige(titel: string, text: string, link: string, label: string, wert: string): Promise<void> {
  await dialog({
    titel, text,
    felder: [{ art: "qr", name: "qr", label: t("empf.qr"), wert: link }, { art: "nurlesen", name: "wert", label, wert }],
    ok: t("dlg.schliessen"), abbrechen: false,
  });
}

export function wireEmpfangen(): void {
  const knopf = $("#wallet-empfangen") as HTMLButtonElement | null;
  if (knopf) knopf.onclick = () => void empfange();
}
