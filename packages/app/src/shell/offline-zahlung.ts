/**
 * „Ohne Internet zahlen“ im Abschnitt der eingebauten Wallet (Schritt 7.2b):
 * Nonce-Konto anlegen (Kosten vorher), Wert auffrischen, schliessen – mit
 * Netz; offline zahlen – ohne Netz, dann ueber das Funkgeraet oder als Datei
 * fuer ein Geraet mit Netz, das die Zahlung einreicht.
 */
import { MeshKind, MeshPriority, fragment } from "@freedomstack/protocol";
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
    ? "Für eine SOL-Zahlung ohne Netz braucht die Wallet ein Nonce-Konto – einmal mit Netz anlegen."
    : a.verbraucht
      ? "Der Nonce-Wert ist verbraucht – mit Netz „Wert auffrischen“, dann geht die nächste Offline-Zahlung."
      : `Bereit für eine Offline-Zahlung (Wert vom ${new Date(a.gelesen * 1000).toLocaleString("de-DE")}).`;
}

/** Aufgaben mit Netz: vorher pruefen, Fehler als Meldung, danach neu zeichnen. */
async function mitNetz(fn: () => Promise<string>): Promise<void> {
  if (!netzDa()) {
    toast("Dafür braucht es Netz.", true);
    return;
  }
  try {
    toast(await fn());
  } catch (e) {
    toast((e as Error).message, true);
  }
  zeigeOfflineZahlung();
}

const anlegen = () => mitNetz(async () => {
  const { legeNonceKontoAn } = await import("./zahlschienen.js");
  await legeNonceKontoAn(async (k) => confirm(
    `Nonce-Konto für Zahlungen ohne Internet anlegen?\n\nMiete: ${solText(k.miete)} – bleibt im Konto, zurück beim Schließen\n` +
    `Gebühr: ${solText(k.gebuehr)}\nZusammen: ${solText(k.gesamt)}`));
  return "Nonce-Konto angelegt – eine Offline-Zahlung ist vorbereitet";
});

const auffrischen = () => mitNetz(async () => {
  const { frischeNonceAuf } = await import("./zahlschienen.js");
  await frischeNonceAuf();
  return "Nonce-Wert aufgefrischt – die nächste Offline-Zahlung ist vorbereitet";
});

const schliessen = () => mitNetz(async () => {
  if (!confirm("Nonce-Konto schließen? Die Miete geht zurück an die eingebaute Wallet; eine vorbereitete Offline-Zahlung, die noch nicht eingereicht ist, wird damit ungültig.")) return "Nichts geändert";
  const { schliesseNonceKonto } = await import("./zahlschienen.js");
  return `Nonce-Konto geschlossen – ${solText(await schliesseNonceKonto())} zurück an die Wallet`;
});

/** Offline zahlen: signieren, dann ueber das Funkgeraet – sonst als Datei. */
async function zahlen(): Promise<void> {
  const an = prompt("An welche Solana-Adresse?")?.trim();
  if (!an) return;
  const lamports = Math.round(Number((prompt("Wie viel SOL?") ?? "").replace(",", ".")) * 1e9);
  if (!Number.isSafeInteger(lamports) || lamports <= 0) {
    toast("Ungültiger Betrag", true);
    return;
  }
  try {
    const { zahleSolOffline } = await import("./zahlschienen.js");
    const roh = await zahleSolOffline(an, lamports);
    const { sendeUeberFunk } = await import("./tabs/settings.js");
    if (await sendeUeberFunk(roh, MeshKind.SolanaTx, "SOL offline")) {
      toast(`${solText(lamports)} signiert und ans Funkgerät gegeben – ein Gerät mit Netz reicht die Zahlung ein.`);
    } else {
      const { packBundle } = await import("../mesh-radio.js");
      const url = URL.createObjectURL(new Blob([packBundle(fragment(roh, MeshKind.SolanaTx, MeshPriority.Zahlung)) as BlobPart], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `freedom-sol-${new Date().toISOString().slice(0, 10)}.meshpkt`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`${solText(lamports)} signiert und als Datei gespeichert – auf einem Gerät mit Netz unter Settings → Mesh → „Datei einlesen“.`);
    }
  } catch (e) {
    toast((e as Error).message, true);
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
