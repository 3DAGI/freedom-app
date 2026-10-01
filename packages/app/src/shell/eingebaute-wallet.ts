/**
 * Die eingebaute SOL-Wallet in der App (Schritt 4.2): ein Exemplar ueber dem
 * Tresor-Speicher, der Dialog, der oberhalb des Tageslimits nachfragt (4.2a),
 * und ihr Abschnitt im Wallet-Tab – einrichten, Adresse zum Empfangen, Limit,
 * entfernen (4.2b). Mit Bunker (NIP-46) ist sie gesperrt – die 12 Woerter
 * gehoeren dann nicht auf dieses Geraet.
 *
 * Frische Empfangsadressen (4.9c): `frischeEmpfangsadresse()` fuer den Tausch,
 * „frische Adresse“ im Wallet-Tab fuer alles andere; eingeloest wird mit
 * `eingebauterHtlcSigner()` – ohne SOL auf der neuen Adresse ueber einen Relayer.
 */
import { t } from "../i18n.js";
import { fehlerText } from "../protokoll-texte.js";
import { escapeHtml } from "../shell-logic.js";
import { EingebauteSolWallet, type Nachfrage, type SignierbareTx, VORRAT_GROESSE } from "../sol-wallet.js";
import { ausLamports, solText } from "../preis-anzeige.js";
import { aktuellerKurs } from "./marktkurs.js";
import { wireOfflineZahlung, zeigeOfflineZahlung } from "./offline-zahlung.js";
import { mitBunker, rpcStichprobe, solRpcUrl, state } from "./state.js";
import { geheim, verlangeTresor } from "./tresor.js";
import { bestaetige } from "./dialog.js";
import { $, ganzeZahl, toast } from "./ui.js";

export const eingebauteWallet = new EingebauteSolWallet(geheim);

/** Die eingebaute Wallet, wenn sie hier benutzbar ist (eingerichtet, Tresor offen, kein Bunker). */
export function benutzbareEingebauteWallet(): EingebauteSolWallet | undefined {
  return !mitBunker() && eingebauteWallet.eingerichtet() ? eingebauteWallet : undefined;
}

/** Die naechste frische Empfangsadresse – undefined ohne benutzbare Wallet oder ohne Vorrat. */
export async function frischeEmpfangsadresse(): Promise<string | undefined> {
  const e = benutzbareEingebauteWallet();
  if (!e || e.vorratFrei() === 0) return undefined;
  const adresse = await e.frischeAdresse();
  zeigeEingebauteWallet();
  return adresse;
}

/**
 * Signierer fuer eine Einloesung an eine eigene Adresse der eingebauten Wallet
 * (Hauptadresse oder vergebene frische). Keine Zahlung – das Geld kommt herein;
 * die Erstattung an einen Relayer bestaetigt der Nutzer vorher im Dialog.
 */
export function eingebauterHtlcSigner(adresse: string): { publicKey: { toBase58(): string }; signTransaction(tx: unknown): Promise<unknown> } | undefined {
  const e = benutzbareEingebauteWallet();
  if (!e || !e.eigeneAdressen().includes(adresse)) return undefined;
  return {
    publicKey: { toBase58: () => adresse },
    signTransaction: async (tx) => {
      e.signiere(tx as SignierbareTx);
      return tx;
    },
  };
}

/**
 * Oberhalb des Tageslimits: ausdruecklich bestaetigen lassen. Feste Texte per
 * innerHTML, Betraege und Adresse per textContent.
 */
export function bestaetigeUeberLimit(n: Nachfrage): Promise<boolean> {
  const box = document.createElement("div");
  box.className = "modal-backdrop";
  box.innerHTML = `<div class="modal">
    <h3>${escapeHtml(t("waehr.ueberLimit"))}</h3>
    <p class="mono-sm">${escapeHtml(t("waehr.ueberLimitText"))}</p>
    <p class="mono-sm">${escapeHtml(t("waehr.limBetrag"))} <b id="lim-betrag"></b><br>${escapeHtml(t("waehr.limAn"))} <span id="lim-ziel" class="mono"></span></p>
    <p class="mono-sm">${escapeHtml(t("waehr.limLimit"))} <span id="lim-limit"></span> ${escapeHtml(t("waehr.limIn24"))} · ${escapeHtml(t("waehr.limSchon"))} <span id="lim-verbraucht"></span></p>
    <button id="lim-ja" class="send-btn">${escapeHtml(t("waehr.trotzdemSenden"))}</button>
    <button id="lim-nein" class="ghost">${escapeHtml(t("zahl.abbrechen"))}</button>
  </div>`;
  const setze = (id: string, text: string) => { box.querySelector(`#${id}`)!.textContent = text; };
  setze("lim-betrag", solText(n.lamports));
  setze("lim-ziel", n.ziel);
  setze("lim-limit", solText(n.limit));
  setze("lim-verbraucht", solText(n.pruefung.verbraucht));
  document.body.appendChild(box);
  return new Promise<boolean>((resolve) => {
    const fertig = (ja: boolean) => { box.remove(); resolve(ja); };
    box.querySelector("#lim-ja")!.addEventListener("click", () => fertig(true));
    box.querySelector("#lim-nein")!.addEventListener("click", () => fertig(false));
  });
}

// ------------------------------------------------------------ Wallet-Tab (4.2b)

/** Zeigt den Abschnitt „Eingebaute Wallet“ passend zum Zustand. */
export function zeigeEingebauteWallet(): void {
  const box = document.querySelector<HTMLElement>("#solw-box");
  if (!box) return;
  const status = $("#solw-status");
  const adresse = mitBunker() ? undefined : eingebauteWallet.adresse();
  const sichtbar = (id: string, ja: boolean) => $(id).classList.toggle("hidden", !ja);
  sichtbar("#solw-einrichten", !adresse && !mitBunker());
  sichtbar("#solw-bereit", !!adresse);
  status.className = "mono-sm";
  if (mitBunker()) {
    status.textContent = t("waehr.mitBunker");
    return;
  }
  if (!adresse) {
    status.textContent = "";
    return;
  }
  $("#solw-adresse").textContent = adresse;
  zeigeOfflineZahlung();
  ($("#solw-limit") as HTMLInputElement).value = String(eingebauteWallet.limit() / 1e9);
  const frei = eingebauteWallet.vorratFrei();
  $("#solw-vorrat").textContent = frei > 0 ? t("waehr.vorratNoch", { n: frei }) : t("waehr.vorratLeer");
  sichtbar("#solw-ergaenzen", frei < 5);
  ($("#solw-frisch") as HTMLButtonElement).disabled = frei === 0;
  $("#solw-guthaben").textContent = t("waehr.guthaben", { betrag: "…" });
  const adressen = eingebauteWallet.eigeneAdressen();
  void (async () => {
    try {
      const { fetchSolBalance } = await import("../solana-connect.js");
      const rpc = await solRpcUrl();
      const je = await Promise.all(adressen.map(async (a) => (await fetchSolBalance(a, rpc)).lamports));
      const summe = je.reduce((s, x) => s + x, 0);
      const mit = je.filter((x) => x > 0).length;
      $("#solw-guthaben").textContent = t("waehr.guthaben", { betrag: ausLamports(summe, aktuellerKurs()) }) + (mit > 1 ? t("waehr.verteilt", { n: mit }) : "");
      void guthabenStichprobe(adressen);
    } catch {
      $("#solw-guthaben").textContent = t("waehr.guthabenRpc");
    }
  })();
}

let letzteStichprobe: number | undefined;

/**
 * 5.8: Ab und zu eine eigene Adresse bei zwei Anbietern gegenpruefen – ein
 * Anbieter, der ein falsches Guthaben zeigt, faellt so auf. Nur Widersprueche
 * werden angezeigt; was sich nicht vergleichen liess, zeigt „erreichbarkeit
 * pruefen“ in den Settings.
 */
async function guthabenStichprobe(adressen: readonly string[]): Promise<void> {
  const { stichprobeFaellig, stichprobenKonto, stichprobeText } = await import("../rpc-stichprobe.js");
  if (!stichprobeFaellig(letzteStichprobe, Date.now())) return;
  letzteStichprobe = Date.now();
  const feld = $("#solw-rpc");
  try {
    const probe = stichprobeText(await rpcStichprobe(stichprobenKonto(adressen)));
    feld.textContent = probe.stufe === "warnung" ? probe.text : "";
    if (probe.stufe === "warnung") toast(t("waehr.rpcWiderspruch"), true);
  } catch {
    feld.textContent = "";
  }
}

/** Eine frische Adresse zum Empfangen herausgeben (kopieren) – jede nur einmal. */
async function frischKopieren(): Promise<void> {
  try {
    const adresse = await frischeEmpfangsadresse();
    if (!adresse) return;
    await navigator.clipboard.writeText(adresse).catch(() => undefined);
    $("#solw-adresse").textContent = adresse;
    toast(t("waehr.frischKopiert"));
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

/** Mit den 12 Woertern weitere frische Adressen ableiten. */
async function ergaenzen(): Promise<void> {
  if (!(await verlangeTresor(t("waehr.fuerEingebaute")))) return;
  const box = document.createElement("div");
  box.className = "modal-backdrop";
  box.innerHTML = `<div class="modal">
    <h3>${escapeHtml(t("waehr.ableitenTitel"))}</h3>
    <p class="mono-sm">${escapeHtml(t("waehr.ableitenText", { n: ganzeZahl(VORRAT_GROESSE) }))}</p>
    <textarea id="solw-woerter2" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${escapeHtml(t("waehr.zwoelfWoerter"))}"></textarea>
    <div id="solw-meldung2" class="mono-sm err"></div>
    <button id="solw-ok2" class="send-btn">${escapeHtml(t("waehr.ableiten"))}</button>
    <button id="solw-abbrechen2" class="ghost">${escapeHtml(t("zahl.abbrechen"))}</button>
  </div>`;
  document.body.appendChild(box);
  const feld = box.querySelector("#solw-woerter2") as HTMLTextAreaElement;
  feld.focus();
  box.querySelector("#solw-abbrechen2")!.addEventListener("click", () => box.remove());
  const ok = box.querySelector("#solw-ok2") as HTMLButtonElement;
  ok.addEventListener("click", async () => {
    ok.disabled = true;
    try {
      const frei = await eingebauteWallet.vorratErgaenzen(feld.value, state.keypair?.pk ?? "");
      feld.value = "";
      box.remove();
      toast(t("waehr.frischeBereit", { n: frei }));
      zeigeEingebauteWallet();
    } catch (e) {
      box.querySelector("#solw-meldung2")!.textContent = fehlerText(e);
    } finally {
      ok.disabled = false;
    }
  });
}

/** Einrichten: Tresor zuerst, dann die 12 Woerter einmal eintippen. */
async function einrichten(): Promise<void> {
  if (mitBunker()) return zeigeEingebauteWallet();
  if (!(await verlangeTresor(t("waehr.fuerEingebaute")))) return;
  const box = document.createElement("div");
  box.className = "modal-backdrop";
  box.innerHTML = `<div class="modal">
    <h3>${escapeHtml(t("waehr.einrichtenTitel"))}</h3>
    <p class="mono-sm">${escapeHtml(t("waehr.einrichtenText"))}</p>
    <textarea id="solw-woerter" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${escapeHtml(t("waehr.zwoelfWoerter"))}"></textarea>
    <div id="solw-meldung" class="mono-sm err"></div>
    <button id="solw-ok" class="send-btn">${escapeHtml(t("waehr.einrichten"))}</button>
    <button id="solw-abbrechen" class="ghost">${escapeHtml(t("zahl.abbrechen"))}</button>
  </div>`;
  document.body.appendChild(box);
  const feld = box.querySelector("#solw-woerter") as HTMLTextAreaElement;
  feld.focus();
  box.querySelector("#solw-abbrechen")!.addEventListener("click", () => box.remove());
  const ok = box.querySelector("#solw-ok") as HTMLButtonElement;
  ok.addEventListener("click", async () => {
    ok.disabled = true;
    try {
      const adresse = await eingebauteWallet.einrichten(feld.value, state.keypair?.pk ?? "");
      feld.value = "";
      box.remove();
      toast(t("waehr.eingebauteBereit", { adresse: adresse.slice(0, 6) }));
      zeigeEingebauteWallet();
    } catch (e) {
      box.querySelector("#solw-meldung")!.textContent = fehlerText(e);
    } finally {
      ok.disabled = false;
    }
  });
}

async function limitSpeichern(): Promise<void> {
  const sol = Number(($("#solw-limit") as HTMLInputElement).value.replace(",", "."));
  const lamports = Math.round(sol * 1e9);
  try {
    await eingebauteWallet.setzeLimit(lamports);
    toast(t("waehr.limitGesetzt", { betrag: solText(lamports) }));
  } catch (e) {
    toast(fehlerText(e), true);
  }
  zeigeEingebauteWallet();
}

async function entfernen(): Promise<void> {
  if (!(await bestaetige({ titel: t("waehr.eingebaut"), text: t("waehr.entfernenFrage"), ok: t("waehr.entfernenKnopf"), gefahr: true }))) return;
  await eingebauteWallet.entfernen();
  toast(t("waehr.eingebauteEntfernt"));
  zeigeEingebauteWallet();
}

/** Knoepfe des Abschnitts verdrahten (einmal beim Start). */
export function wireEingebauteWallet(): void {
  $("#solw-einrichten").addEventListener("click", () => void einrichten());
  $("#solw-limit-speichern").addEventListener("click", () => void limitSpeichern());
  $("#solw-entfernen").addEventListener("click", () => void entfernen());
  $("#solw-frisch").addEventListener("click", () => void frischKopieren());
  $("#solw-ergaenzen").addEventListener("click", () => void ergaenzen());
  wireOfflineZahlung();
  $("#solw-kopieren").addEventListener("click", () => {
    void navigator.clipboard.writeText($("#solw-adresse").textContent ?? "").then(() => toast(t("waehr.adresseKopiert")));
  });
}
