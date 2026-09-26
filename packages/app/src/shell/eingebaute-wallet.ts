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
import { EingebauteSolWallet, type Nachfrage, type SignierbareTx, VORRAT_GROESSE } from "../sol-wallet.js";
import { ausLamports, solText } from "../preis-anzeige.js";
import { aktuellerKurs } from "./marktkurs.js";
import { mitBunker, solRpcUrl, state } from "./state.js";
import { geheim, verlangeTresor } from "./tresor.js";
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
    <h3>Über dem Tageslimit</h3>
    <p class="mono-sm">Diese Zahlung liegt über dem, was die eingebaute Wallet ohne Nachfrage sendet.</p>
    <p class="mono-sm">Betrag: <b id="lim-betrag"></b><br>an: <span id="lim-ziel" class="mono"></span></p>
    <p class="mono-sm">Limit: <span id="lim-limit"></span> in 24 Stunden · schon gesendet: <span id="lim-verbraucht"></span></p>
    <button id="lim-ja" class="send-btn">trotzdem senden</button>
    <button id="lim-nein" class="ghost">abbrechen</button>
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
    status.textContent = "Mit Bunker gesperrt: Die 12 Wörter gehören dann nicht auf dieses Gerät – verbinde eine externe Wallet.";
    return;
  }
  if (!adresse) {
    status.textContent = "";
    return;
  }
  $("#solw-adresse").textContent = adresse;
  ($("#solw-limit") as HTMLInputElement).value = String(eingebauteWallet.limit() / 1e9);
  const frei = eingebauteWallet.vorratFrei();
  $("#solw-vorrat").textContent = frei > 0
    ? `Frische Empfangsadressen: noch ${frei}`
    : "Keine frischen Empfangsadressen mehr – „neue ableiten“ (mit deinen 12 Wörtern).";
  sichtbar("#solw-ergaenzen", frei < 5);
  ($("#solw-frisch") as HTMLButtonElement).disabled = frei === 0;
  $("#solw-guthaben").textContent = "Guthaben: …";
  const adressen = eingebauteWallet.eigeneAdressen();
  void (async () => {
    try {
      const { fetchSolBalance } = await import("../solana-connect.js");
      const rpc = await solRpcUrl();
      const je = await Promise.all(adressen.map(async (a) => (await fetchSolBalance(a, rpc)).lamports));
      const summe = je.reduce((s, x) => s + x, 0);
      const mit = je.filter((x) => x > 0).length;
      $("#solw-guthaben").textContent = `Guthaben: ${ausLamports(summe, aktuellerKurs())}` + (mit > 1 ? ` – auf ${mit} Adressen verteilt` : "");
    } catch {
      $("#solw-guthaben").textContent = "Guthaben: nicht abrufbar (RPC)";
    }
  })();
}

/** Eine frische Adresse zum Empfangen herausgeben (kopieren) – jede nur einmal. */
async function frischKopieren(): Promise<void> {
  try {
    const adresse = await frischeEmpfangsadresse();
    if (!adresse) return;
    await navigator.clipboard.writeText(adresse).catch(() => undefined);
    $("#solw-adresse").textContent = adresse;
    toast("Frische Adresse kopiert – gib sie nur für diesen einen Empfang heraus");
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/** Mit den 12 Woertern weitere frische Adressen ableiten. */
async function ergaenzen(): Promise<void> {
  if (!(await verlangeTresor("die eingebaute Wallet"))) return;
  const box = document.createElement("div");
  box.className = "modal-backdrop";
  box.innerHTML = `<div class="modal">
    <h3>Frische Adressen ableiten</h3>
    <p class="mono-sm">Gib deine 12 Wörter ein. Die App leitet die nächsten ${ganzeZahl(VORRAT_GROESSE)} Adressen ab
    (Phantoms Konten in derselben Reihenfolge) und speichert nur ihre Schlüssel im Tresor.</p>
    <textarea id="solw-woerter2" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="12 Wörter"></textarea>
    <div id="solw-meldung2" class="mono-sm err"></div>
    <button id="solw-ok2" class="send-btn">ableiten</button>
    <button id="solw-abbrechen2" class="ghost">abbrechen</button>
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
      toast(`${frei} frische Adressen bereit`);
      zeigeEingebauteWallet();
    } catch (e) {
      box.querySelector("#solw-meldung2")!.textContent = (e as Error).message;
    } finally {
      ok.disabled = false;
    }
  });
}

/** Einrichten: Tresor zuerst, dann die 12 Woerter einmal eintippen. */
async function einrichten(): Promise<void> {
  if (mitBunker()) return zeigeEingebauteWallet();
  if (!(await verlangeTresor("die eingebaute Wallet"))) return;
  const box = document.createElement("div");
  box.className = "modal-backdrop";
  box.innerHTML = `<div class="modal">
    <h3>Eingebaute Wallet einrichten</h3>
    <p class="mono-sm">Gib deine 12 Wörter ein. Die App leitet daraus deine Solana-Adresse ab
    (dieselbe wie in Phantom) und speichert nur den Schlüssel dazu im Tresor – die Wörter nicht.</p>
    <textarea id="solw-woerter" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="12 Wörter"></textarea>
    <div id="solw-meldung" class="mono-sm err"></div>
    <button id="solw-ok" class="send-btn">einrichten</button>
    <button id="solw-abbrechen" class="ghost">abbrechen</button>
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
      toast(`Eingebaute Wallet bereit: ${adresse.slice(0, 6)}…`);
      zeigeEingebauteWallet();
    } catch (e) {
      box.querySelector("#solw-meldung")!.textContent = (e as Error).message;
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
    toast(`Ohne Nachfrage höchstens ${solText(lamports)} in 24 Stunden`);
  } catch (e) {
    toast((e as Error).message, true);
  }
  zeigeEingebauteWallet();
}

async function entfernen(): Promise<void> {
  if (!confirm("Eingebaute Wallet von diesem Gerät entfernen? Das Guthaben bleibt auf der Kette – mit deinen 12 Wörtern richtest du sie wieder ein (hier oder in Phantom).")) return;
  await eingebauteWallet.entfernen();
  toast("Eingebaute Wallet entfernt");
  zeigeEingebauteWallet();
}

/** Knoepfe des Abschnitts verdrahten (einmal beim Start). */
export function wireEingebauteWallet(): void {
  $("#solw-einrichten").addEventListener("click", () => void einrichten());
  $("#solw-limit-speichern").addEventListener("click", () => void limitSpeichern());
  $("#solw-entfernen").addEventListener("click", () => void entfernen());
  $("#solw-frisch").addEventListener("click", () => void frischKopieren());
  $("#solw-ergaenzen").addEventListener("click", () => void ergaenzen());
  $("#solw-kopieren").addEventListener("click", () => {
    void navigator.clipboard.writeText($("#solw-adresse").textContent ?? "").then(() => toast("Adresse kopiert"));
  });
}
