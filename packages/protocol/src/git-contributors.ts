/**
 * Mitwirkenden-Ansicht für das Git-Layer.
 *
 * `git.ts` kann Repos referenzieren und Bundles übertragen — aber es gibt
 * keine Antwort auf die Frage, die man bei einem fremden Projekt zuerst
 * stellt: Wer arbeitet hier, wie lange schon, und lebt das noch?
 *
 * WAS ANDERS IST ALS BEI GITHUB
 * Auf GitHub ist die Mitwirkenden-Liste eine Behauptung des Servers. Hier ist
 * sie eine Auswertung signierter Ereignisse — jeder kann dieselbe Rechnung
 * anstellen und das Ergebnis vergleichen. Das ist auch die einzige Form, die
 * ohne Server funktioniert.
 *
 * WAS DAS NICHT KANN
 * Es zählt VERÖFFENTLICHTE Beiträge, nicht Commits in einem Bundle. Wer
 * hundert Commits in einem Push unterbringt, erscheint als einer. Das ist
 * ehrlicher als es klingt: Commit-Zahlen messen ohnehin nichts, und eine
 * Rangliste nach Commits belohnt genau das falsche Verhalten.
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag } from "./event.js";

/** Ein veröffentlichter Beitrag zu einem Repo (Push, Patch, Review). */
export const KIND_GIT_CONTRIBUTION = 38056;

export type ContributionKind = "push" | "patch" | "review" | "issue";

export interface Contribution {
  repoId: string;
  authorPubkey: string;
  kind: ContributionKind;
  /** Kurzbeschreibung — bei einem Push die Commit-Nachricht. */
  summary: string;
  /** Commit-Hash oder Bundle-Kennung, falls vorhanden. */
  ref?: string;
  /** Geänderte Zeilen, wenn bekannt. Freiwillig und nicht nachprüfbar. */
  linesAdded?: number;
  linesRemoved?: number;
  createdAt: number;
}

export function buildContribution(c: Omit<Contribution, "createdAt">, createdAt?: number): UnsignedEvent {
  const tags: string[][] = [
    ["d", `contrib:${c.repoId}:${c.ref ?? createdAt ?? ""}`],
    ["r", c.repoId],
    ["type", c.kind],
  ];
  if (c.ref) tags.push(["ref", c.ref]);
  if (c.linesAdded !== undefined) tags.push(["lines", String(c.linesAdded), String(c.linesRemoved ?? 0)]);
  return buildEvent(c.authorPubkey, KIND_GIT_CONTRIBUTION, tags, c.summary, createdAt);
}

export function parseContribution(ev: NostrEvent): Contribution {
  if (ev.kind !== KIND_GIT_CONTRIBUTION) throw new Error(`kein Beitrag: kind ${ev.kind}`);
  const repoId = getTag(ev, "r");
  if (!repoId) throw new Error("Beitrag ohne Repo");
  const typ = getTag(ev, "type") ?? "push";
  const zeilen = ev.tags.find((t) => t[0] === "lines");
  return {
    repoId,
    authorPubkey: ev.pubkey,
    kind: (["push", "patch", "review", "issue"].includes(typ) ? typ : "push") as ContributionKind,
    summary: ev.content,
    ref: getTag(ev, "ref") ?? undefined,
    linesAdded: zeilen ? Number(zeilen[1]) : undefined,
    linesRemoved: zeilen ? Number(zeilen[2]) : undefined,
    createdAt: ev.created_at,
  };
}

export interface Contributor {
  pubkey: string;
  contributions: number;
  byKind: Record<ContributionKind, number>;
  firstSeen: number;
  lastSeen: number;
  /** Tage mit mindestens einem Beitrag — sagt mehr als die reine Anzahl. */
  activeDays: number;
}

export type RepoHealth = "aktiv" | "ruhig" | "verwaist" | "unbekannt";

export interface RepoOverview {
  repoId: string;
  contributors: Contributor[];
  totalContributions: number;
  health: RepoHealth;
  /** Die Frage, die man bei einem fremden Projekt zuerst stellt. */
  healthNote: string;
  /** Beiträge je Tag der letzten Wochen — für den Verlauf. */
  timeline: { day: string; count: number }[];
}

const TAG = 86400;

/**
 * Wertet die Beiträge eines Repos aus.
 *
 * `activeDays` statt Commit-Zahlen: Wer an dreißig verschiedenen Tagen etwas
 * beigetragen hat, ist ein anderer Mitwirkender als jemand mit dreißig
 * Beiträgen an einem Nachmittag — und die Unterscheidung ist die, die zählt.
 */
export function buildRepoOverview(
  repoId: string,
  events: NostrEvent[],
  nowSecs = Math.floor(Date.now() / 1000),
): RepoOverview {
  const beitraege: Contribution[] = [];
  for (const ev of events) {
    try {
      const c = parseContribution(ev);
      if (c.repoId === repoId) beitraege.push(c);
    } catch { /* kein gültiger Beitrag */ }
  }

  const proPerson = new Map<string, { c: Contribution[]; tage: Set<string> }>();
  for (const b of beitraege) {
    const e = proPerson.get(b.authorPubkey) ?? { c: [], tage: new Set<string>() };
    e.c.push(b);
    e.tage.add(new Date(b.createdAt * 1000).toISOString().slice(0, 10));
    proPerson.set(b.authorPubkey, e);
  }

  const contributors: Contributor[] = [...proPerson.entries()].map(([pubkey, e]) => {
    const byKind: Record<ContributionKind, number> = { push: 0, patch: 0, review: 0, issue: 0 };
    for (const c of e.c) byKind[c.kind]++;
    return {
      pubkey,
      contributions: e.c.length,
      byKind,
      firstSeen: Math.min(...e.c.map((c) => c.createdAt)),
      lastSeen: Math.max(...e.c.map((c) => c.createdAt)),
      activeDays: e.tage.size,
    };
  }).sort((a, b) => b.activeDays - a.activeDays || b.contributions - a.contributions);

  // Zustand: Die ehrliche Antwort auf "lebt das noch?".
  let health: RepoHealth = "unbekannt";
  let healthNote = "Keine veröffentlichten Beiträge — das Repo kann trotzdem existieren.";
  if (beitraege.length > 0) {
    const letzter = Math.max(...beitraege.map((b) => b.createdAt));
    const tageHer = Math.floor((nowSecs - letzter) / TAG);
    if (tageHer <= 30) {
      health = "aktiv";
      healthNote = `Zuletzt vor ${tageHer} Tag(en) etwas veröffentlicht.`;
    } else if (tageHer <= 180) {
      health = "ruhig";
      healthNote = `Seit ${tageHer} Tagen nichts Neues. Kann fertig sein oder eingeschlafen.`;
    } else {
      health = "verwaist";
      healthNote =
        `Seit über ${Math.floor(tageHer / 30)} Monaten nichts. Wer hier mitarbeiten ` +
        `will, sollte mit keiner Antwort rechnen.`;
    }
  }

  // Verlauf der letzten 12 Wochen, tagesweise.
  const proTag = new Map<string, number>();
  const seit = nowSecs - 84 * TAG;
  for (const b of beitraege) {
    if (b.createdAt < seit) continue;
    const tag = new Date(b.createdAt * 1000).toISOString().slice(0, 10);
    proTag.set(tag, (proTag.get(tag) ?? 0) + 1);
  }

  return {
    repoId,
    contributors,
    totalContributions: beitraege.length,
    health,
    healthNote,
    timeline: [...proTag.entries()].map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day)),
  };
}

/**
 * Wie verteilt ist die Arbeit?
 *
 * Ein Projekt, an dem eine einzige Person 95 % beiträgt, ist etwas anderes als
 * eines mit fünf gleichmäßig Beteiligten — und der Unterschied entscheidet, ob
 * man sich darauf verlassen kann. Auf einer Plattform sieht man das nicht auf
 * den ersten Blick; hier kann man es ausrechnen.
 */
export function busFactor(contributors: Contributor[]): { count: number; note: string } {
  if (contributors.length === 0) return { count: 0, note: "Niemand." };

  const gesamt = contributors.reduce((s, c) => s + c.contributions, 0);
  let summe = 0;
  let n = 0;
  for (const c of contributors) {
    summe += c.contributions;
    n++;
    if (summe / gesamt >= 0.5) break;
  }

  if (n === 1 && contributors.length === 1) {
    return { count: 1, note: "Eine Person allein. Fällt sie aus, steht das Projekt." };
  }
  if (n === 1) {
    return {
      count: 1,
      note: `Eine Person trägt mehr als die Hälfte. ${contributors.length - 1} weitere helfen mit.`,
    };
  }
  return { count: n, note: `${n} Personen tragen zusammen die Hälfte der Arbeit.` };
}

/** Kurzprofil einer Person über alle Repos hinweg. */
export function contributorProfile(
  pubkey: string,
  events: NostrEvent[],
): { repos: string[]; total: number; firstSeen?: number; lastSeen?: number } {
  const repos = new Set<string>();
  const zeiten: number[] = [];
  for (const ev of events) {
    try {
      const c = parseContribution(ev);
      if (c.authorPubkey !== pubkey) continue;
      repos.add(c.repoId);
      zeiten.push(c.createdAt);
    } catch { /* ignorieren */ }
  }
  return {
    repos: [...repos],
    total: zeiten.length,
    firstSeen: zeiten.length ? Math.min(...zeiten) : undefined,
    lastSeen: zeiten.length ? Math.max(...zeiten) : undefined,
  };
}
