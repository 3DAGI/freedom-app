/**
 * Navigation (Schritt C.1a): Seiten, Adresse und Zurück.
 *
 * Die Adresse nennt nur die Seite (`#/chat`, `#/agent/verlauf`), nie eine
 * Kennung – auch nicht in `history.state`: Den Browserverlauf kann die
 * Notfall-Löschung nicht leeren. Was offen ist (Unterhaltung, Raum), hält die
 * App im Speicher.
 *
 * Mobil zeigt die untere Leiste Agent, Chat, Währung und „Mehr“; Repos,
 * Verdienen, Netz, Profil und Settings stehen unter „Mehr“ (Entscheidung E1,
 * `phase-10.md`).
 */

/** Seite wie in `switchTab()` → Name in der Adresse. */
export const SEITEN = {
  ai: "agent", comm: "chat", repos: "repos", wallet: "waehrung", earn: "verdienen", netz: "netz", profile: "profil", settings: "settings",
  mehr: "mehr",
} as const;
export type Seite = keyof typeof SEITEN;

/** Unterseiten mit eigener Adresse – heute nur die Seitenleiste des Agenten (mobil). */
const UNTERSEITEN: Partial<Record<Seite, readonly string[]>> = { ai: ["verlauf", "modelle"] };
/** Unterseite → Reiter der Seitenleiste des Agenten. */
const AGENT_REITER: Record<string, string> = { verlauf: "tasks", modelle: "models" };

/** Mobil unter „Mehr“ statt in der unteren Leiste. */
export const UNTER_MEHR: readonly Seite[] = ["repos", "earn", "netz", "profile", "settings"];

export interface Ziel { seite: Seite; unterseite?: string }

const istSeite = (s: string): s is Seite => Object.prototype.hasOwnProperty.call(SEITEN, s);

/** `#/chat` → `{ seite: "comm" }`. Alles andere – auch eine angehängte Kennung – ergibt null. */
export function zielAusAdresse(hash: string): Ziel | null {
  const m = /^#\/([a-z]+)(?:\/([a-z]+))?$/.exec(hash);
  if (!m) return null;
  const seite = (Object.keys(SEITEN) as Seite[]).find((s) => SEITEN[s] === m[1]);
  if (!seite) return null;
  if (!m[2]) return { seite };
  return UNTERSEITEN[seite]?.includes(m[2]) ? { seite, unterseite: m[2] } : null;
}

/** Adresse zu einem Ziel; unbekannte Unterseiten fallen weg. */
export function adresseFuer(z: Ziel): string {
  const unter = z.unterseite && UNTERSEITEN[z.seite]?.includes(z.unterseite) ? `/${z.unterseite}` : "";
  return `#/${SEITEN[z.seite]}${unter}`;
}

/** Mit welcher Seite die App startet: aus der Adresse, sonst der Agent. */
export function startSeite(): Seite {
  return zielAusAdresse(location.hash)?.seite ?? "ai";
}

/** Ein eigener Eintrag im Verlauf – nur so weiß „Zurück“, ob es in der App bleibt. */
const EIGEN = { freedom: 1 };

/**
 * Nach `switchTab()`: Adresse und „Mehr“ nachziehen. Ein neuer Eintrag nur,
 * wenn sich die Seite ändert; eine gültige Unterseite derselben Seite bleibt.
 */
export function seiteGezeigt(seite: string): void {
  if (!istSeite(seite)) return;
  const jetzt = zielAusAdresse(location.hash);
  if (!jetzt) history.replaceState(null, "", adresseFuer({ seite }));
  else if (jetzt.seite !== seite) history.pushState(EIGEN, "", adresseFuer({ seite }));
  const mehr = document.querySelector('.app-nav button[data-tab="mehr"]');
  mehr?.classList.toggle("active", seite === "mehr" || UNTER_MEHR.includes(seite));
  document.querySelectorAll(".app-nav button[data-tab]").forEach((b) => {
    if (b.classList.contains("active")) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  setzeAgentSicht(seite === "ai" ? jetzt?.unterseite : undefined);
}

/** Mobil: die Seitenleiste des Agenten als eigene Ebene (Verlauf, Modelle). */
function setzeAgentSicht(unterseite: string | undefined): void {
  const layout = document.querySelector<HTMLElement>(".agent-layout");
  if (!layout) return;
  if (!unterseite) {
    delete layout.dataset.sicht;
    return;
  }
  layout.dataset.sicht = "seite";
  document.querySelector<HTMLElement>(`[data-subtab-group="agent"] [data-subtab="${AGENT_REITER[unterseite]}"]`)?.click();
}

function gehe(z: Ziel, oeffne: (seite: Seite) => void): void {
  if (location.hash !== adresseFuer(z)) history.pushState(EIGEN, "", adresseFuer(z));
  oeffne(z.seite);
}

/** Eine Ebene zurück: im Verlauf, wenn der Eintrag von der App stammt – sonst ohne ihn zu verlassen. */
function zurueck(oeffne: (seite: Seite) => void): void {
  if ((history.state as typeof EIGEN | null)?.freedom === 1) {
    history.back();
    return;
  }
  const z = zielAusAdresse(location.hash);
  history.replaceState(null, "", adresseFuer({ seite: z?.seite ?? "ai" }));
  oeffne(z?.seite ?? "ai");
}

/** Einmal beim Start: Zurück/Vor, „Mehr“, Kopfzeile mobil und die Unterseiten des Agenten. */
export function wireNavigation(oeffne: (seite: Seite) => void): void {
  // Zurück, Vor und eine von Hand geänderte Adresse – jede löst popstate aus
  // (ein zweiter Horcher auf hashchange ließe switchTab() doppelt laufen)
  window.addEventListener("popstate", () => oeffne(zielAusAdresse(location.hash)?.seite ?? "ai"));
  document.querySelectorAll<HTMLElement>("#page-mehr [data-geh]").forEach((b) => {
    const ziel = b.dataset.geh ?? "";
    if (istSeite(ziel)) b.addEventListener("click", () => gehe({ seite: ziel }, oeffne));
  });
  // Kopfzeile mobil: Schlüssel → Profil, Guthaben → Währung; auch per Tastatur
  for (const [id, seite] of [["ident", "profile"], ["balance", "wallet"]] as const) {
    const el = document.getElementById(id);
    el?.addEventListener("click", () => gehe({ seite }, oeffne));
    el?.addEventListener("keydown", (e) => {
      if (!(e.key === "Enter" || e.key === " ")) return;
      e.preventDefault();
      el.click();
    });
  }
  document.getElementById("agent-zu-verlauf")?.addEventListener("click", () => gehe({ seite: "ai", unterseite: "verlauf" }, oeffne));
  document.getElementById("agent-zu-modelle")?.addEventListener("click", () => gehe({ seite: "ai", unterseite: "modelle" }, oeffne));
  document.getElementById("agent-seite-zurueck")?.addEventListener("click", () => zurueck(oeffne));
  // Eine Aufgabe gewählt oder neu begonnen: mobil zurück zum Gespräch
  document.querySelector(".agent-side")?.addEventListener("click", (e) => {
    const layout = document.querySelector<HTMLElement>(".agent-layout");
    if (layout?.dataset.sicht && (e.target as HTMLElement).closest(".history-item, #agent-new")) zurueck(oeffne);
  });
  // Tastatur mobil (C.5a): solange ein Eingabefeld den Fokus hat, weicht die untere Leiste (CSS `body.tippt`)
  const tippt = () => document.body.classList.toggle("tippt", tipptIn(document.activeElement));
  document.addEventListener("focusin", tippt);
  document.addEventListener("focusout", () => setTimeout(tippt, 0));
}

/** Öffnet dieses Element die Bildschirmtastatur? Textfelder ja, Häkchen, Knöpfe und Dateiwahl nein. */
export function tipptIn(e: Element | null): boolean {
  return !!e && e.matches("textarea, [contenteditable=''], [contenteditable='true'], input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='file']):not([type='button']):not([type='submit']):not([type='color'])"); // kein UI-Text
}
