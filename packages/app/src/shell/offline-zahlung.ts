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
import { geheim } from "./tresor.js";
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
  await legeNonceKontoAn(async (k) => confirm(t("waehr.nonceAnlegenFrage", { miete: solText(k.miete), gebuehr: solText(k.gebuehr), gesamt: solText(k.gesamt) })));
  return t("waehr.nonceAngelegt");
});

const auffrischen = () => mitNetz(async () => {
  const { frischeNonceAuf } = await import("./zahlschienen.js");
  await frischeNonceAuf();
  return t("waehr.nonceAufgefrischt");
});

const schliessen = () => mitNetz(async () => {
  if (!confirm(t("waehr.nonceSchliessenFrage"))) return t("waehr.nichtsGeaendert");
  const { schliesseNonceKonto } = await import("./zahlschienen.js");
  return t("waehr.nonceGeschlossen", { betrag: solText(await schliesseNonceKonto()) });
});

/** Offline zahlen: signieren, dann ueber das Funkgeraet – sonst als Datei. */
async function zahlen(): Promise<void> {
  const an = prompt(t("waehr.anWelcheAdresse"))?.trim();
  if (!an) return;
  const lamports = Math.round(Number((prompt(t("waehr.wievielSol")) ?? "").replace(",", ".")) * 1e9);
  if (!Number.isSafeInteger(lamports) || lamports <= 0) {
    toast(t("waehr.ungueltigerBetrag"), true);
    return;
  }
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
