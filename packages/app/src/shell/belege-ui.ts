/**
 * Währung › Übersicht › Belege (Sammlung A-6): die Quittungen der
 * KI-Zahlungen als CSV speichern – nur auf Knopfdruck, nur auf diesem Gerät.
 * Vorher sagt die App, dass die Datei nicht verschlüsselt ist.
 */
import { belegeCsv, belegeDateiname } from "../belege-export.js";
import { t } from "../i18n.js";
import { bestaetige } from "./dialog.js";
import { quittungsBuch } from "./quittungen.js";
import { $ } from "./ui.js";

export function wireBelege(): void {
  const knopf = $("#belege-export");
  const status = $("#belege-status");
  if (!knopf || !status) return;
  knopf.addEventListener("click", async () => {
    const quittungen = quittungsBuch.alle();
    if (quittungen.length === 0) {
      status.textContent = t("belege.keine");
      return;
    }
    if (!(await bestaetige({ titel: t("belege.titel"), text: t("belege.warnung", { n: quittungen.length }), ok: t("belege.speichern") }))) return;
    const url = URL.createObjectURL(new Blob([belegeCsv(quittungen)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = belegeDateiname(new Date());
    a.click();
    URL.revokeObjectURL(url);
    status.textContent = t("belege.gespeichert", { n: quittungen.length });
  });
}
