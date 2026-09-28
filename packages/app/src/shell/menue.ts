/**
 * Menüs (Schritt C.2b2): ein Knopf öffnet eine Liste von Punkten.
 *
 * Tastatur wie bei Menüs üblich: Enter, Leertaste oder Pfeil ab öffnen und
 * setzen den Fokus auf den ersten Punkt (Pfeil auf: den letzten); die Pfeile
 * wandern im Kreis, Pos1 und Ende springen; Esc schließt und gibt den Fokus
 * dem Knopf zurück; Tab oder ein Klick daneben schließt. Ausgeblendete Punkte
 * (`hidden`) zählen nicht.
 *
 * `wireMenue()` für ein festes Menü im HTML, `oeffneMenueAn()` (seit C.2d1)
 * für Listen, die sich neu zeichnen (Mitglieder): Das Menü entsteht beim
 * Öffnen und verschwindet beim Schließen samt seiner Horcher.
 */
const PUNKT = '[role="menuitem"]';

/** Pfeile, Pos1/Ende, Esc und Tab in einem offenen Menü. */
function menueTasten(menue: HTMLElement, punkte: () => HTMLElement[], schliesse: (fokusZumKnopf?: boolean) => void): void {
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
}

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
  menueTasten(menue, punkte, schliesse);
  // Ein Punkt gewählt: vorher schließen und den Fokus zum Knopf – ein Dialog,
  // den der Punkt öffnet, gibt ihn danach dorthin zurück (Erfassungsphase)
  menue.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(PUNKT)) schliesse(true);
  }, true);
  document.addEventListener("click", (e) => {
    if (offen() && !menue.contains(e.target as Node) && !knopf.contains(e.target as Node)) schliesse();
  });
}

export interface MenuePunkt {
  text: string;
  tun: () => void;
  /** Rot – für Entfernen, Sperren. */
  gefahr?: boolean;
}

/** Das gerade offene schwebende Menü – es gibt höchstens eins. */
let offenesMenue: ((fokusZumKnopf?: boolean) => void) | null = null;

/** Ein schwebendes Menü am Knopf (C.2d1); Punkte nur als Text. */
export function oeffneMenueAn(knopf: HTMLElement, punkte: MenuePunkt[], beschriftung: string): void {
  offenesMenue?.();
  const menue = document.createElement("div");
  menue.className = "raum-menue menue-schwebend";
  menue.setAttribute("role", "menu");
  menue.setAttribute("aria-label", beschriftung);
  const knoepfe = punkte.map((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = p.gefahr ? "menue-punkt menue-gefahr" : "menue-punkt";
    b.setAttribute("role", "menuitem");
    b.textContent = p.text;
    // Erst schließen und den Fokus zum Knopf, dann handeln (wie oben)
    b.addEventListener("click", () => {
      schliesse(true);
      p.tun();
    });
    return b;
  });
  menue.append(...knoepfe);
  const r = knopf.getBoundingClientRect();
  menue.style.position = "fixed";
  menue.style.top = `${Math.max(8, Math.min(r.bottom + 4, innerHeight - 8 - 44 * punkte.length))}px`;
  menue.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  const daneben = (e: MouseEvent) => {
    if (!menue.contains(e.target as Node) && !knopf.contains(e.target as Node)) schliesse();
  };
  function schliesse(fokusZumKnopf = false): void {
    menue.remove();
    document.removeEventListener("click", daneben, true);
    knopf.setAttribute("aria-expanded", "false");
    offenesMenue = null;
    if (fokusZumKnopf && knopf.isConnected) knopf.focus();
  }
  menueTasten(menue, () => knoepfe, schliesse);
  document.body.append(menue);
  document.addEventListener("click", daneben, true);
  knopf.setAttribute("aria-expanded", "true");
  offenesMenue = schliesse;
  knoepfe[0]?.focus();
}
