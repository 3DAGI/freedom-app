/**
 * Eigener Relay-Satz als Liste (C-53a, Oberflächen-Review 15.10.2026): je Relay eine Zeile mit Stand, „Entfernen“ und
 * darunter ein Feld „Hinzufügen“ – bis jetzt ein leeres Textfeld, eine Adresse je Zeile, ohne Stand. Geändert wird
 * ein Entwurf; er gilt erst nach „Veröffentlichen“, und das weiter nur über `setzeEigeneRelays()` (5.4b2). Adressen
 * prüft `pruefeRelayEingabe()` wie bisher. Als Gerät nur sichtbar – der Satz gehört der Person (8.6c).
 */
import { t } from "../i18n.js";
import { ladeEigeneRelays, pruefeRelayEingabe, setzeEigeneRelays } from "../relay-satz.js";
import { fehlerText } from "../protokoll-texte.js";
import { alsGeraet, ensurePool, nimmInPool, signiere, state, veroeffentlicheWeit } from "./state.js";
import { el } from "./ui.js";

/** Der Satz, wie er in der Liste steht – veröffentlicht oder noch nicht. */
let entwurf: string[] = [];
let veroeffentlicht: string[] = [];

const geaendert = (): boolean => entwurf.join("\n") !== veroeffentlicht.join("\n");

/** Stand je Relay aus dem Pool (C-16, nur lesend): verbunden, getrennt – oder nicht im Pool. */
async function staende(): Promise<Map<string, boolean>> {
  const m = new Map<string, boolean>();
  try {
    const r = (await ensurePool() as unknown as { relays?: Array<{ url?: unknown; verbunden?: unknown }> }).relays;
    for (const x of Array.isArray(r) ? r : []) if (typeof x.url === "string") m.set(x.url, x.verbunden === true);
  } catch { /* kein Pool: alle ohne Stand */ }
  return m;
}

/** Nach dem Veröffentlichen von anderswo (Knoten-Relay übernehmen, B-9c3): Liste und Stand neu. */
export function zeigeRelaySatz(relays: readonly string[]): void {
  entwurf = [...relays];
  veroeffentlicht = [...relays];
  zeichne();
}

function zeichne(meldung?: string): void {
  const liste = document.getElementById("relay-liste");
  const knopf = document.getElementById("eigene-relays-save") as HTMLButtonElement | null;
  const status = document.getElementById("eigene-relays-status");
  if (!liste) return;
  const geraet = alsGeraet();
  liste.replaceChildren(...entwurf.map((url) => {
    const zeile = el("li", undefined, "relay-zeile");
    zeile.dataset.relay = url;
    const punkt = el("span", undefined, "relay-punkt");
    punkt.setAttribute("aria-hidden", "true");
    const stand = el("span", t("set.relayNeu"), "relay-stand");
    zeile.append(punkt, el("span", url, "relay-url mono-sm"), stand);
    if (!geraet) {
      const weg = el("button", t("set.relayEntfernen"));
      weg.className = "ghost mini";
      weg.type = "button";
      weg.setAttribute("aria-label", t("set.relayEntfernenAria", { url }));
      weg.addEventListener("click", () => {
        entwurf = entwurf.filter((x) => x !== url);
        zeichne();
      });
      zeile.append(weg);
    }
    return zeile;
  }));
  if (knopf) knopf.disabled = geraet || !geaendert() || entwurf.length === 0;
  if (status) status.textContent = meldung ?? (geraet ? t("set.geraetSatz") : entwurf.length === 0 ? t("set.keinSatz") : geaendert() ? t("set.relayEntwurf") : "");
  void staende().then((m) => {
    for (const zeile of liste.querySelectorAll<HTMLElement>(".relay-zeile")) {
      const url = zeile.dataset.relay ?? "";
      const an = m.get(url);
      zeile.querySelector(".relay-punkt")?.classList.toggle("an", an === true);
      const stand = zeile.querySelector(".relay-stand");
      // Nicht im Pool: erst nach dem Veröffentlichen (oder beim ersten Gebrauch) verbunden
      if (stand) stand.textContent = an === undefined ? t("set.relayNeu") : an ? t("set.relayVerbunden") : t("set.relayGetrennt");
    }
  });
}

/** Einmal beim Start (Settings › Verbindung). */
export function wireRelayKarte(): void {
  const neu = document.getElementById("relay-neu") as HTMLInputElement | null;
  const dazu = document.getElementById("relay-hinzufuegen") as HTMLButtonElement | null;
  const knopf = document.getElementById("eigene-relays-save") as HTMLButtonElement | null;
  if (!document.getElementById("relay-liste") || !knopf) return;
  zeigeRelaySatz(ladeEigeneRelays(localStorage));
  // Den Satz legt die App beim ersten Verbinden an – beim Öffnen der Seite neu lesen, solange nichts geändert ist
  document.querySelector('[data-subtab-group="settings"] [data-subtab="network"]')?.addEventListener("click", () => {
    if (!geaendert()) zeigeRelaySatz(ladeEigeneRelays(localStorage));
  });
  if (alsGeraet()) {
    if (neu) neu.disabled = true;
    if (dazu) dazu.disabled = true;
    return;
  }
  const hinzufuegen = (): void => {
    const adresse = neu?.value.trim() ?? "";
    if (!adresse) return;
    const r = pruefeRelayEingabe([...entwurf, adresse].join("\n"));
    if ("fehler" in r) { zeichne(r.fehler); return; }
    entwurf = r.relays;
    if (neu) neu.value = "";
    zeichne();
  };
  dazu?.addEventListener("click", hinzufuegen);
  neu?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); hinzufuegen(); } });
  knopf.addEventListener("click", async () => {
    const r = pruefeRelayEingabe(entwurf.join("\n"));
    if ("fehler" in r) { zeichne(r.fehler); return; }
    if (!state.keypair) { zeichne(t("set.keineIdentitaet")); return; }
    knopf.disabled = true;
    zeichne(t("set.veroeffentliche"));
    try {
      const ok = await setzeEigeneRelays({ relays: r.relays, pk: state.keypair.pk, signiere, weit: veroeffentlicheWeit, speicher: localStorage });
      if (!ok) { zeichne(t("set.nichtVeroeffentlichtKeiner")); return; }
      await nimmInPool(r.relays);
      veroeffentlicht = [...r.relays];
      entwurf = [...r.relays];
      zeichne(t("set.veroeffentlicht", { n: r.relays.length }));
    } catch (e) {
      zeichne(t("set.nichtVeroeffentlicht", { fehler: fehlerText(e) }));
    }
  });
}
