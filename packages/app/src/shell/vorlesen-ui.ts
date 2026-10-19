/**
 * Vorlesen unter jeder Antwort (B-38a, SP-W2 A): Knopf neben „Kopieren“, nur mit Stimmen dieses Geräts
 * (`vorlesen.ts`). Wo der Browser kein `speechSynthesis` hat, gibt es keinen Knopf. Code-Blöcke liest er nicht vor.
 */
import { getLang, t } from "../i18n.js";
import { iconEl } from "../icons.js";
import { browserSprecher, Vorleser } from "../vorlesen.js";
import { el, toast } from "./ui.js";

let vorleser: Vorleser | null | undefined;
let aktiv: { knopf: HTMLButtonElement; beschriftung: HTMLElement } | null = null;

/** Der Text einer Antwort zum Vorlesen: Code-Blöcke durch einen Hinweis ersetzt, Absätze getrennt. */
export function vorleseTextAus(koerper: HTMLElement): string {
  const kopie = koerper.cloneNode(true) as HTMLElement;
  for (const block of kopie.querySelectorAll(".codeblock, pre")) block.replaceWith(` ${t("agent.vorlesenCode")} `);
  for (const b of kopie.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, tr, br")) b.append(" ");
  return kopie.textContent ?? "";
}

function setzeAktiv(neu: typeof aktiv): void {
  if (aktiv) {
    aktiv.beschriftung.textContent = t("agent.vorlesen");
    aktiv.knopf.setAttribute("aria-pressed", "false");
  }
  aktiv = neu;
  if (aktiv) {
    aktiv.beschriftung.textContent = t("agent.vorlesenStopp");
    aktiv.knopf.setAttribute("aria-pressed", "true");
  }
}

/** Der Knopf „Vorlesen“ für eine Antwort – `null` ohne `speechSynthesis`. Ein zweiter Klick hält an. */
export function vorlesenKnopf(koerper: HTMLElement): HTMLButtonElement | null {
  if (vorleser === undefined) {
    const sprecher = browserSprecher();
    vorleser = sprecher ? new Vorleser(sprecher) : null;
  }
  const v = vorleser;
  if (!v) return null;
  const knopf = el("button", undefined, "ghost mini antwort-vorlesen");
  knopf.type = "button";
  knopf.title = t("agent.vorlesenTitel");
  knopf.setAttribute("aria-label", t("agent.vorlesenTitel"));
  knopf.setAttribute("aria-pressed", "false");
  const beschriftung = el("span", t("agent.vorlesen"));
  knopf.append(iconEl("volume", 14), beschriftung);
  const meiner = { knopf, beschriftung };
  knopf.addEventListener("click", () => {
    if (aktiv?.knopf === knopf) {
      v.stopp();
      setzeAktiv(null);
      return;
    }
    setzeAktiv(meiner);
    void v.lies(vorleseTextAus(koerper), getLang()).then((ergebnis) => {
      if (aktiv?.knopf === knopf) setzeAktiv(null);
      if (ergebnis === "keine-stimme") toast(t("agent.vorlesenKeineStimme"), true);
    });
  });
  return knopf;
}
