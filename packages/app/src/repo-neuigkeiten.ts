/**
 * Neuigkeiten in Repos (Schritt C-20f, Sammlung C-20): was seit dem letzten
 * Blick in ein Repo dazukam – Issues, Patches und Kommentare von anderen, wie
 * die Benachrichtigungen bei GitHub. Gemeldet wird nur für Repos, an denen man
 * beteiligt ist (Eigentümer, Maintainer, eigene Issues, Patches, Kommentare).
 *
 * Ohne DOM und ohne Speicher: „zuletzt gesehen“ je Repo liegt nur im Tresor
 * (`LS_REPOS_GESEHEN` über `geheim`) – die Liste verrät, welche Repos man
 * verfolgt, und gehört nicht in den Klartext.
 */
import type { RepoKarte } from "./repo-ansicht.js";

export const LS_REPOS_GESEHEN = "freedom.repos.gesehen";
/** Höchstens so viele Repos merkt sich die App – die ältesten fallen zuerst heraus. */
export const GESEHEN_MAX = 500;

/** Schlüssel der Karte → Sekunden des letzten Blicks. */
export type Gesehen = Record<string, number>;

export interface Neuigkeiten {
  issues: number;
  patches: number;
  kommentare: number;
}

// Seit C-20g2 zählen Reviews (Zeilenkommentare, Bewertungen) mit – sie stehen nicht mehr unter `patchKommentare`
const kommentareVon = (k: RepoKarte) => [
  ...(k.issues ?? []).flatMap((z) => z.kommentare), ...Object.values(k.patchKommentare ?? {}).flat(),
  ...Object.values(k.patchReviews ?? {}).flatMap((r) => [...r.zeilen, ...r.bewertungen]),
];

/** Ist man an diesem Repo beteiligt? Eigentümer, Maintainer oder Autor eines Issues, Patches, Kommentars. */
export function beteiligt(k: RepoKarte, ich: string | undefined): boolean {
  if (!ich) return false;
  // Beobachtete Repos (C-20j2) melden Neues wie eigene
  return !!k.beobachtet || k.eigentuemer === ich || !!k.repo?.maintainer.includes(ich)
    || (k.issues ?? []).some((z) => z.issue.autor === ich) || k.zeilen.some((z) => z.patch.autor === ich)
    || kommentareVon(k).some((x) => x.autor === ich);
}

/** Was nach `seit` von anderen kam – eigene Beiträge sind nie neu. */
export function neuigkeiten(k: RepoKarte, seit: number, ich: string | undefined): Neuigkeiten {
  const neu = (autor: string, zeit: number) => zeit > seit && autor !== ich;
  return {
    issues: (k.issues ?? []).filter((z) => neu(z.issue.autor, z.issue.zeit)).length,
    patches: k.zeilen.filter((z) => neu(z.patch.autor, z.patch.zeit)).length,
    kommentare: kommentareVon(k).filter((x) => neu(x.autor, x.zeit)).length,
  };
}

export const neuGesamt = (n: Neuigkeiten): number => n.issues + n.patches + n.kommentare;

/** Gemerkte Liste lesen – Unfug (kein Objekt, falsche Werte, zu lange Schlüssel) fällt heraus. */
export function leseGesehen(roh: string | null): Gesehen {
  let o: unknown;
  try {
    o = JSON.parse(roh ?? "{}");
  } catch {
    return {};
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return {};
  const aus: Gesehen = {};
  for (const [k, v] of Object.entries(o)) if (k.length <= 300 && typeof v === "number" && Number.isSafeInteger(v) && v >= 0) aus[k] = v;
  return aus;
}

/**
 * Repos, an denen man neu beteiligt ist, beginnen bei `jetzt` – sonst wäre
 * beim ersten Mal alles „neu“. Nichts fällt heraus, nur weil es gerade nicht
 * geladen ist (ein stummes Relay); über `GESEHEN_MAX` gehen die ältesten.
 */
export function gesehenAbgleichen(g: Gesehen, karten: readonly RepoKarte[], ich: string | undefined, jetzt: number): { gesehen: Gesehen; geaendert: boolean } {
  const aus: Gesehen = { ...g };
  let geaendert = false;
  for (const k of karten) {
    if (aus[k.schluessel] === undefined && beteiligt(k, ich)) {
      aus[k.schluessel] = jetzt;
      geaendert = true;
    }
  }
  const eintraege = Object.entries(aus);
  if (eintraege.length <= GESEHEN_MAX) return { gesehen: aus, geaendert };
  return { gesehen: Object.fromEntries(eintraege.sort((a, b) => b[1] - a[1]).slice(0, GESEHEN_MAX)), geaendert: true };
}
