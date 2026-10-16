/**
 * Tauschformular (C-51): Richtung, Betrag, „Du zahlst / Du bekommst“ mit dem günstigsten Angebot vorgewählt.
 * Rechnen tut `tausch-wahl.ts`; „Tauschen“ ruft denselben Ablauf wie die Liste (`startSwap()`/`startRueckSwap()`),
 * mit dem Betrag vorbelegt – der Dialog fragt weiter. Alle Angebote stehen aufklappbar darunter.
 */
import { type AngebotMitLp, type Richtung, bestesAngebot, fristText, gebuehrText, grenzenText, kursText, tauschVorschau } from "../tausch-wahl.js";
import { t } from "../i18n.js";
import { pkShort } from "../shell-logic.js";
import { aktuellerKurs } from "./marktkurs.js";
import { startRueckSwap, startSwap } from "./tabs/tausch.js";

let angebote: AngebotMitLp[] = [];
let richtung: Richtung = "sats-sol";

const el = (id: string) => document.getElementById(id);
const text = (id: string, s: string) => { const e = el(id); if (e) e.textContent = s; };

/** Aus `loadWallet()`: die gültigen Angebote; ohne Angebote bleibt das Formular verborgen (der leere Zustand aus C-45 steht in der Liste). */
export function zeigeTauschformular(liste: AngebotMitLp[]): void {
  angebote = liste;
  const form = el("tausch-formular");
  if (!form) return;
  form.hidden = liste.length === 0;
  text("lp-anzahl", liste.length ? `(${liste.length})` : "");
  // Mit Formular ist die Liste zugeklappt; ohne Angebote offen, dort steht der leere Zustand (C-45)
  const alle = el("lp-alle");
  if (alle) (alle as HTMLDetailsElement).open = liste.length === 0;
  rechne();
}

function rechne(): void {
  const jetzt = Math.floor(Date.now() / 1000);
  const bestes = bestesAngebot(angebote, richtung, jetzt);
  const feld = el("tausch-sats") as HTMLInputElement | null;
  const knopf = el("tausch-los") as HTMLButtonElement | null;
  const sats = Number(feld?.value ?? "");
  const kurs = aktuellerKurs();
  const v = bestes ? tauschVorschau(bestes.offer, sats, kurs) : undefined;
  text("tausch-lp", bestes ? pkShort(bestes.pubkey) : "—");
  text("tausch-gebuehr", bestes ? gebuehrText(bestes.offer) : "—");
  text("tausch-grenzen", bestes ? grenzenText(bestes.offer) : "—");
  text("tausch-kurs", (bestes && kursText(bestes.offer, kurs)) || "—");
  text("tausch-frist", bestes ? fristText(bestes.offer) : "—");
  text("tausch-zahlst", v?.zahlst ?? "—");
  text("tausch-bekommst", v ? (v.bekommst || t("tausch.lpNennt")) : "—");
  text("tausch-hinweis", !bestes ? t("tausch.keinAngebot")
    : v && !v.imBereich ? t("tausch.bereich", { grenzen: grenzenText(bestes.offer) })
    : v && !v.genau && v.bekommst ? t("tausch.geschaetzt") : "");
  if (knopf) knopf.disabled = !bestes || !v || !v.imBereich;
}

/** Einmal beim Start. */
export function wireTauschformular(): void {
  document.querySelectorAll<HTMLButtonElement>("#tausch-formular [data-richtung]").forEach((b) => {
    b.addEventListener("click", () => {
      richtung = b.dataset.richtung as Richtung;
      document.querySelectorAll<HTMLButtonElement>("#tausch-formular [data-richtung]").forEach((x) => {
        const an = x === b;
        x.classList.toggle("active", an);
        x.setAttribute("aria-pressed", String(an));
      });
      rechne();
    });
  });
  el("tausch-sats")?.addEventListener("input", rechne);
  el("tausch-los")?.addEventListener("click", () => {
    const bestes = bestesAngebot(angebote, richtung, Math.floor(Date.now() / 1000));
    const sats = Number((el("tausch-sats") as HTMLInputElement | null)?.value ?? "");
    if (!bestes || !Number.isSafeInteger(sats) || sats <= 0) return;
    void (richtung === "sol-sats" ? startRueckSwap(bestes.pubkey, bestes.offer, sats) : startSwap(bestes.pubkey, bestes.offer.offerId, bestes.offer.vorabSats, sats));
  });
}
