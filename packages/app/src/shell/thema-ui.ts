/**
 * Wahl des Designs (C-57b): je eine Auswahl in den Settings (neben der Sprache) und auf „Mehr“ (Handy). Die Farben
 * setzt allein das CSS (`app.css`, Tokens) – hier steht nur `data-theme` an `<html>`, bei „Wie das Gerät“ keins.
 */
import { leseThema, themaAttribut, THEMA_SCHLUESSEL, type Thema } from "../thema.js";

function setze(thema: Thema): void {
  const a = themaAttribut(thema);
  if (a) document.documentElement.dataset.theme = a;
  else delete document.documentElement.dataset.theme;
}

function gespeichert(): Thema {
  try { return leseThema(localStorage.getItem(THEMA_SCHLUESSEL)); } catch { return "system"; }
}

/** Ganz am Anfang von `boot()` – vor dem Entsperren, damit nichts im falschen Design aufblitzt. */
export function themaBeimStart(): void {
  setze(gespeichert());
}

/** Einmal beim Start: alle Auswahlen zeigen die Wahl, jede ändert sie für alle. */
export function wireThemaWahl(): void {
  const wahlen = [...document.querySelectorAll<HTMLSelectElement>("select[data-thema-wahl]")];
  const jetzt = gespeichert();
  for (const w of wahlen) {
    w.value = jetzt;
    w.addEventListener("change", () => {
      const thema = leseThema(w.value);
      try {
        if (thema === "system") localStorage.removeItem(THEMA_SCHLUESSEL);
        else localStorage.setItem(THEMA_SCHLUESSEL, thema);
      } catch { /* ohne Speicher gilt die Wahl bis zum Neuladen */ }
      setze(thema);
      for (const x of wahlen) x.value = thema;
    });
  }
}
