/**
 * Mitwirkende eines Repos (38056) samt Bus-Faktor, seit C.3a2 als DOM: für die
 * Karte „Mitwirkende“ der Seite „Repos“ (`earn.ts`) und den Reiter der
 * Repo-Seite (`repo-seite.ts`). Nur `textContent` – Schlüssel und Zahlen
 * kommen aus fremden Events.
 */
import { type NostrEvent, buildRepoOverview, busFactor } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { busFaktorText, repoZustand } from "../protokoll-texte.js";

function zeile(tag: "div" | "span", text: string, klasse?: string): HTMLElement {
  const e = document.createElement(tag);
  e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

/** Zustand, Bus-Faktor und die ersten 15 Mitwirkenden (aktive Tage, Beiträge); `name` macht aus dem Schlüssel einen Namen. */
export function mitwirkendeListe(repoId: string, evs: readonly NostrEvent[], name: (pk: string) => string): HTMLElement[] {
  const o = buildRepoOverview(repoId, [...evs]);
  // Sätze aus den Feldern – die fertigen Sätze des Protokolls sind Deutsch (8.16f)
  const zustand = repoZustand(o);
  if (o.contributors.length === 0) return [zeile("span", zustand, "muted mitwirkende-leer")];
  const teile = [zeile("div", zustand, "mono-sm"), zeile("div", busFaktorText(busFactor(o.contributors).count, o.contributors), "mono-sm muted mitwirkende-bus")];
  for (const c of o.contributors.slice(0, 15)) {
    const r = document.createElement("div");
    r.className = "usage-row";
    const wer = zeile("span", name(c.pubkey));
    wer.title = c.pubkey;
    r.append(wer, zeile("span", t("earn.aktiveTage", { tage: c.activeDays, n: c.contributions })));
    teile.push(r);
  }
  return teile;
}
