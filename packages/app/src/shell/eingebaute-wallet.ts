/**
 * Die eingebaute SOL-Wallet in der App (Schritt 4.2a): ein Exemplar ueber dem
 * Tresor-Speicher und der Dialog, der oberhalb des Tageslimits nachfragt.
 * Mit Bunker (NIP-46) ist sie gesperrt – die 12 Woerter gehoeren dann nicht
 * auf dieses Geraet.
 */
import { EingebauteSolWallet, type Nachfrage } from "../sol-wallet.js";
import { mitBunker } from "./state.js";
import { geheim } from "./tresor.js";

export const eingebauteWallet = new EingebauteSolWallet(geheim);

/** Die eingebaute Wallet, wenn sie hier benutzbar ist (eingerichtet, Tresor offen, kein Bunker). */
export function benutzbareEingebauteWallet(): EingebauteSolWallet | undefined {
  return !mitBunker() && eingebauteWallet.eingerichtet() ? eingebauteWallet : undefined;
}

/** Lamports als SOL-Text, z. B. „0,05 SOL“. */
export function solText(lamports: number): string {
  return `${(lamports / 1e9).toLocaleString("de-DE", { maximumFractionDigits: 9 })} SOL`;
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
