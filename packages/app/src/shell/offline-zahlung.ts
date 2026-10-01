/**
 * „Ohne Internet zahlen“ im Abschnitt der eingebauten Wallet (Schritt 7.2b):
 * Nonce-Konto anlegen (Kosten vorher), Wert auffrischen, schliessen – mit
 * Netz; offline zahlen – ohne Netz, dann ueber das Funkgeraet oder als Datei
 * fuer ein Geraet mit Netz, das die Zahlung einreicht.
 */
import { MeshKind, MeshPriority, fragment } from "@freedomstack/protocol";
import { gebietsschema, t } from "../i18n.js";
import { fehlerText } from "../protokoll-texte.js";
import { solText } from "../preis-anzeige.js";
import { leseAblage } from "../sol-offline-zahlung.js";
import { solZuLamports } from "../zahlungs-anforderung.js";
import { geheim } from "./tresor.js";
import { bestaetige, dialog } from "./dialog.js";
import { $, netzDa, toast } from "./ui.js";

export function zeigeOfflineZahlung(): void {
  const status = document.getElementById("solo-status");
  if (!status) return;
  const a = leseAblage(geheim);
  $("#solo-anlegen").classList.toggle("hidden", !!a);
  $("#solo-auffrischen").classList.toggle("hidden", !a);
  $("#solo-schliessen").classList.toggle("hidden", !a);
  ($("#solo-zahlen") as HTMLButtonElement).disabled = !a || a.verbraucht;
  status.textContent = !a
    ? t("waehr.offlineOhneKonto")
    : a.verbraucht
      ? t("waehr.offlineVerbraucht")
      : t("waehr.offlineBereit", { vom: new Date(a.gelesen * 1000).toLocaleString(gebietsschema()) });
}

/** Aufgaben mit Netz: vorher pruefen, Fehler als Meldung, danach neu zeichnen. */
async function mitNetz(fn: () => Promise<string>): Promise<void> {
  if (!netzDa()) {
    toast(t("waehr.brauchtNetz"), true);
    return;
  }
  try {
    toast(await fn());
  } catch (e) {
    toast(fehlerText(e), true);
  }
  zeigeOfflineZahlung();
}

const anlegen = () => mitNetz(async () => {
  const { legeNonceKontoAn } = await import("./zahlschienen.js");
  // Dialog statt confirm() (C-1d): Kosten im Text, abgelehnt legt nichts an
  await legeNonceKontoAn((k) => bestaetige({
    titel: t("waehr.offlineTitel"),
    text: t("waehr.nonceAnlegenFrage", { miete: solText(k.miete), gebuehr: solText(k.gebuehr), gesamt: solText(k.gesamt) }),
    ok: t("waehr.nonceAnlegen"),
  }));
  return t("waehr.nonceAngelegt");
});

const auffrischen = () => mitNetz(async () => {
  const { frischeNonceAuf } = await import("./zahlschienen.js");
  await frischeNonceAuf();
  return t("waehr.nonceAufgefrischt");
});

const schliessen = () => mitNetz(async () => {
  if (!(await bestaetige({ titel: t("waehr.offlineTitel"), text: t("waehr.nonceSchliessenFrage"), ok: t("waehr.kontoSchliessen"), gefahr: true }))) return t("waehr.nichtsGeaendert");
  const { schliesseNonceKonto } = await import("./zahlschienen.js");
  return t("waehr.nonceGeschlossen", { betrag: solText(await schliesseNonceKonto()) });
});

/** Offline zahlen: signieren, dann ueber das Funkgeraet – sonst als Datei. */
async function zahlen(): Promise<void> {
  // Ein Dialog statt zwei prompt() (C-1d): Adresse (auch per QR vom Empfänger) und Betrag, beides geprüft im Dialog
  const { isValidSolanaAddress } = await import("../solana-connect.js");
  const betrag = (roh: unknown) => solZuLamports(String(roh ?? "").trim().replace(",", "."));
  const w = await dialog({
    titel: t("waehr.offlineTitel"),
    felder: [
      { art: "text", name: "an", label: t("waehr.anWelcheAdresse"), pflicht: true, mono: true, scannen: true },
      { art: "text", name: "betrag", label: t("waehr.wievielSol"), pflicht: true },
    ],
    pruefe: (w) => (!isValidSolanaAddress(String(w.an).trim()) ? t("waehr.keineSolAdresse") : betrag(w.betrag) ? null : t("waehr.ungueltigerBetrag")),
    ok: t("waehr.signieren"),
  });
  const an = String(w?.an ?? "").trim();
  const lamports = w ? betrag(w.betrag) : undefined;
  if (!an || !lamports) return;
  try {
    const { zahleSolOffline } = await import("./zahlschienen.js");
    const roh = await zahleSolOffline(an, lamports);
    const { sendeUeberFunk } = await import("./tabs/settings.js");
    if (await sendeUeberFunk(roh, MeshKind.SolanaTx, t("waehr.funkName"))) {
      toast(t("waehr.anFunkGegeben", { betrag: solText(lamports) }));
    } else {
      const { packBundle } = await import("../mesh-radio.js");
      const url = URL.createObjectURL(new Blob([packBundle(fragment(roh, MeshKind.SolanaTx, MeshPriority.Zahlung)) as BlobPart], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `freedom-sol-${new Date().toISOString().slice(0, 10)}.meshpkt`;
      a.click();
      URL.revokeObjectURL(url);
      toast(t("waehr.alsDateiGespeichert", { betrag: solText(lamports) }));
    }
  } catch (e) {
    toast(fehlerText(e), true);
  }
  zeigeOfflineZahlung();
}

/** Knoepfe verdrahten (einmal beim Start). */
export function wireOfflineZahlung(): void {
  $("#solo-anlegen").addEventListener("click", () => void anlegen());
  $("#solo-auffrischen").addEventListener("click", () => void auffrischen());
  $("#solo-schliessen").addEventListener("click", () => void schliessen());
  $("#solo-zahlen").addEventListener("click", () => void zahlen());
}
