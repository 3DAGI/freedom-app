/**
 * Menüs (Schritt C.2b2): ein Knopf öffnet eine Liste von Punkten.
 *
 * Tastatur wie bei Menüs üblich: Enter, Leertaste oder Pfeil ab öffnen und
 * setzen den Fokus auf den ersten Punkt (Pfeil auf: den letzten); die Pfeile
 * wandern im Kreis, Pos1 und Ende springen; Esc schließt und gibt den Fokus
 * dem Knopf zurück; Tab oder ein Klick daneben schließt. Ausgeblendete Punkte
 * (`hidden`) zählen nicht.
 */
const PUNKT = '[role="menuitem"]';

export function wireMenue(knopf: HTMLElement, menue: HTMLElement): void {
  const punkte = () => [...menue.querySelectorAll<HTMLElement>(PUNKT)].filter((p) => !p.classList.contains("hidden"));
  const offen = () => !menue.classList.contains("hidden");
  const schliesse = (fokusZumKnopf = false) => {
    menue.classList.add("hidden");
    knopf.setAttribute("aria-expanded", "false");
    if (fokusZumKnopf) knopf.focus();
  };
  const oeffne = (letzter = false) => {
    menue.classList.remove("hidden");
    knopf.setAttribute("aria-expanded", "true");
    const liste = punkte();
    liste[letzter ? liste.length - 1 : 0]?.focus();
  };
  knopf.setAttribute("aria-haspopup", "menu");
  knopf.setAttribute("aria-expanded", "false");
  knopf.addEventListener("click", () => (offen() ? schliesse() : oeffne()));
  knopf.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      oeffne(e.key === "ArrowUp");
    }
  });
  menue.addEventListener("keydown", (e) => {
    const liste = punkte();
    const i = liste.indexOf(document.activeElement as HTMLElement);
    const n = liste.length;
    const ziel = e.key === "ArrowDown" ? liste[(i + 1) % n] : e.key === "ArrowUp" ? liste[(i - 1 + n) % n]
      : e.key === "Home" ? liste[0] : e.key === "End" ? liste[n - 1] : undefined;
    if (ziel) {
      e.preventDefault();
      ziel.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      schliesse(true);
    } else if (e.key === "Tab") {
      schliesse();
    }
  });
  // Ein Punkt gewählt: vorher schließen und den Fokus zum Knopf – ein Dialog,
  // den der Punkt öffnet, gibt ihn danach dorthin zurück (Erfassungsphase)
  menue.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(PUNKT)) schliesse(true);
  }, true);
  document.addEventListener("click", (e) => {
    if (offen() && !menue.contains(e.target as Node) && !knopf.contains(e.target as Node)) schliesse();
  });
}
