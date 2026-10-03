/**
 * Repositories nach NIP-34 in der App (Schritt 8.10b): aus Events die Zeilen
 * der Ansicht – ohne DOM, damit testbar. Die Oberflaeche steht in
 * shell/tabs/repos.ts.
 */
import {
  KIND_GIT_REPO_REF, KIND_REPO_ANKUENDIGUNG, KIND_STATUS_ANGENOMMEN, KIND_STATUS_ENTWURF, KIND_STATUS_GESCHLOSSEN, KIND_STATUS_OFFEN,
  KIND_SPACE, RAUM_REPO_RECHT, bewertungenZu, can, darfAnnehmen, issueStatus, istReviewTeil, kommentareZu, leseIssue, lesePatch, leseRepoAnkuendigung,
  mitRaumRechten, patchStatus, raumAdresse, raumZustandFuer, repoReleasesZu, zeilenKommentareZu,
  type GeleseneBewertung, type GelesenesRepoRelease, type GelesenerKommentar, type GelesenerZeilenKommentar, type GelesenerPatch, type GelesenesIssue, type GelesenesRepo, type IssueStatus, type NostrEvent, type PatchStatus,
  type RepoAnkuendigung,
} from "@freedomstack/protocol";

/** Je Eigentuemer und Kennung nur die neueste Ankuendigung (ersetzbares Event). */
export function repoZeilen(events: readonly NostrEvent[]): GelesenesRepo[] {
  const neueste = new Map<string, NostrEvent>();
  for (const ev of events) {
    if (ev.kind !== KIND_REPO_ANKUENDIGUNG) continue;
    const d = ev.tags.find((t) => t[0] === "d")?.[1] ?? "";
    const k = `${ev.pubkey}:${d}`;
    const alt = neueste.get(k);
    if (!alt || ev.created_at > alt.created_at) neueste.set(k, ev);
  }
  const repos: GelesenesRepo[] = [];
  for (const ev of neueste.values()) {
    try {
      repos.push(leseRepoAnkuendigung(ev));
    } catch { /* fremdes Unfug-Event */ }
  }
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

export type PatchAktion = "annehmen" | "entwurf" | "wiederOeffnen" | "schliessen" | "zurueckziehen";

/** Welchen Status eine Aktion setzt (C.3b2) – die vier, die es nach NIP-34 gibt. */
export const AKTION_STATUS: Record<PatchAktion, PatchStatus> = {
  annehmen: "angenommen", entwurf: "entwurf", wiederOeffnen: "offen", schliessen: "geschlossen", zurueckziehen: "geschlossen",
};

export interface PatchZeile {
  patch: GelesenerPatch;
  status: PatchStatus;
  statusVon?: string;
  statusZeit?: number;
  /** Begründung aus dem geltenden Status-Event (fremder Text, gekürzt). */
  notiz?: string;
  /** Bei „angenommen“: eingespielt als diese Commits. */
  commits?: string[];
  /** Was ich hier tun darf. */
  aktionen: PatchAktion[];
}

/**
 * Was ich an einem Patch tun darf (seit C.3b2) – nur, was `patchStatus()`
 * auch zählt. Maintainer: annehmen, als Entwurf, wieder öffnen, schließen.
 * Der Autor: als Entwurf, wieder öffnen, zurückziehen – einen Patch, den ein
 * Maintainer geschlossen hat, öffnet er nicht wieder (das Protokoll ließe es
 * zu, die App achtet die Entscheidung). Angenommen ist endgültig.
 */
export function patchAktionen(
  st: { status: PatchStatus; von?: string }, repo: Pick<GelesenesRepo, "eigentuemer" | "maintainer">, autor: string, ich: string | undefined,
): PatchAktion[] {
  if (!ich || st.status === "angenommen") return [];
  if (darfAnnehmen(repo, ich)) {
    if (st.status === "offen") return ["annehmen", "entwurf", "schliessen"];
    if (st.status === "entwurf") return ["annehmen", "wiederOeffnen", "schliessen"];
    return ["wiederOeffnen"];
  }
  if (ich !== autor) return [];
  if (st.status === "offen") return ["entwurf", "zurueckziehen"];
  if (st.status === "entwurf") return ["wiederOeffnen", "zurueckziehen"];
  return st.von === ich ? ["wiederOeffnen"] : [];
}

const STATUS_KIND: Record<PatchStatus, number> = {
  offen: KIND_STATUS_OFFEN, angenommen: KIND_STATUS_ANGENOMMEN, geschlossen: KIND_STATUS_GESCHLOSSEN, entwurf: KIND_STATUS_ENTWURF,
};

/**
 * Patches eines Repos mit Status – neueste zuerst; dazu, was ich tun darf
 * (`patchAktionen()`), und die Begründung des geltenden Status.
 */
export function patchZeilen(repo: GelesenesRepo, patches: readonly NostrEvent[], status: readonly NostrEvent[], ich: string | undefined): PatchZeile[] {
  const zeilen: PatchZeile[] = [];
  for (const ev of patches) {
    let patch: GelesenerPatch;
    try {
      patch = lesePatch(ev);
    } catch {
      continue;
    }
    if (patch.repoAdresse !== repo.adresse) continue;
    const st = patchStatus(patch, repo, status);
    // Das Event, das gilt: derselbe Absender, dieselbe Zeit, dieselbe Art, an diesen Patch
    const geltend = st.von ? status.find((e) => e.pubkey === st.von && e.created_at === st.zeit && e.kind === STATUS_KIND[st.status]
      && e.tags.some((t) => t[0] === "e" && t[1] === patch.id)) : undefined;
    const notiz = geltend?.content.trim().slice(0, 1000);
    zeilen.push({
      patch, status: st.status, aktionen: patchAktionen(st, repo, patch.autor, ich),
      ...(st.von ? { statusVon: st.von, statusZeit: st.zeit } : {}), ...(notiz ? { notiz } : {}), ...(st.commits ? { commits: st.commits } : {}),
    });
  }
  return zeilen.sort((a, b) => b.patch.zeit - a.patch.zeit);
}

/**
 * Ein Repo in der Liste (C.3a): Ankündigung (30617) und Bundle-Verweis
 * (38042) desselben Eigentümers mit derselben Kennung – nur in der Anzeige
 * verbunden, kein neues Event. Es gibt auch Repos nur mit Bundle.
 */
export interface RepoKarte {
  /** `eigentuemer:kennung` – nur im Speicher, nie in der Adresse. */
  schluessel: string;
  id: string;
  name: string;
  eigentuemer: string;
  beschreibung?: string;
  repo?: GelesenesRepo;
  /** Neueste Bundle-Referenz desselben Eigentümers und derselben Kennung. */
  bundle?: NostrEvent;
  /** Gehört das Repo bestätigt zu seinem Raum (11.4a)? Dann zählen die Raum-Pfleger als Maintainer. */
  raumBestaetigt?: boolean;
  /** Repo eines privaten Raums (11.4b2): jede Aktion geht nur in diese MLS-Gruppe. */
  privatRaum?: string;
  /** Repo nur auf diesem Gerät (B-2): nichts geht auf ein Relay; mit dem Stand des lokalen Bundles, wenn es eines gibt. */
  lokal?: { bundle?: { zeit: number; bytes: number } };
  /** Name des Raums (11.4c), nur wenn das Repo bestätigt dazugehört – fremder Text, nur über textContent. */
  raumName?: string;
  /** Issues (C-17b), neuestes zuerst – erst nach `mitIssues()`. */
  issues?: IssueZeile[];
  offeneIssues?: number;
  /** Kommentare je Patch-Id (C-17c), ältester zuerst – erst nach `mitIssues()`. */
  patchKommentare?: Record<string, GelesenerKommentar[]>;
  /** Reviews je Patch-Id (C-20g2): Kommentare an Zeilen und Bewertungen – erst nach `mitIssues()`. */
  patchReviews?: Record<string, PatchReview>;
  /** Releases (C-20h2), neuestes zuerst – erst nach `mitIssues()`. */
  releases?: GelesenesRepoRelease[];
  zeilen: PatchZeile[];
  offen: number;
  /** Letzte Aktivität (Sekunden): Ankündigung, Bundle, Patch oder Status. */
  zuletzt: number;
}

export function repoKarten(
  ankuendigungen: readonly NostrEvent[], bundles: readonly NostrEvent[], patches: readonly NostrEvent[],
  status: readonly NostrEvent[], ich: string | undefined,
  /** Struktur der öffentlichen Räume, auf die Repos verweisen (34700–34702, 11.4a). */
  raumEvents: readonly NostrEvent[] = [],
): RepoKarte[] {
  const karten = new Map<string, RepoKarte>();
  const zeitVon = new Map<string, number>();
  for (const ev of ankuendigungen) {
    const d = ev.tags.find((t) => t[0] === "d")?.[1] ?? "";
    zeitVon.set(`${ev.pubkey}:${d}`, Math.max(zeitVon.get(`${ev.pubkey}:${d}`) ?? 0, ev.created_at));
  }
  for (const gelesen of repoZeilen(ankuendigungen)) {
    // Rechte aus den Raum-Rollen (11.4a): Pfleger des Raums zählen wie Maintainer
    const zustand = gelesen.raum ? raumZustandFuer(gelesen.raum, raumEvents) : undefined;
    const { raumBestaetigt, ...repo } = mitRaumRechten(gelesen, zustand);
    const zeilen = patchZeilen(repo, patches, status, ich);
    const schluessel = `${repo.eigentuemer}:${repo.id}`;
    const zuletzt = Math.max(zeitVon.get(schluessel) ?? 0, ...zeilen.map((z) => z.patch.zeit));
    karten.set(schluessel, {
      schluessel, id: repo.id, name: repo.name, eigentuemer: repo.eigentuemer, repo, zeilen, ...(repo.raum ? { raumBestaetigt } : {}),
      ...(raumBestaetigt && zustand?.space ? { raumName: zustand.space.name.slice(0, 80) } : {}),
      ...(repo.beschreibung ? { beschreibung: repo.beschreibung } : {}),
      offen: zeilen.filter((z) => z.status === "offen" || z.status === "entwurf").length, zuletzt,
    });
  }
  for (const ev of bundles) {
    if (ev.kind !== KIND_GIT_REPO_REF) continue;
    const d = ev.tags.find((t) => t[0] === "d")?.[1] ?? "";
    if (!d || d.length > 100) continue;
    const schluessel = `${ev.pubkey}:${d}`;
    const k = karten.get(schluessel);
    if (k) {
      if (!k.bundle || ev.created_at > k.bundle.created_at) k.bundle = ev;
      k.zuletzt = Math.max(k.zuletzt, ev.created_at);
    } else {
      karten.set(schluessel, { schluessel, id: d, name: d, eigentuemer: ev.pubkey, bundle: ev, zeilen: [], offen: 0, zuletzt: ev.created_at });
    }
  }
  return [...karten.values()].sort((a, b) => b.zuletzt - a.zuletzt || a.name.localeCompare(b.name));
}

/**
 * Karten eines privaten Raums (11.4b2) aus `raumReposPrivat()`: eigener
 * Schlüssel je Raum – nie mit einem öffentlichen Repo gleicher Kennung
 * vermischt –, und `privatRaum` leitet jede Aktion in die Gruppe.
 */
export function privateRaumKarten(
  r: { gruppe: string; name?: string; ankuendigungen: readonly NostrEvent[]; bundles: readonly NostrEvent[]; patches: readonly NostrEvent[]; status: readonly NostrEvent[] },
  ich: string | undefined,
): RepoKarte[] {
  return repoKarten(r.ankuendigungen, r.bundles, r.patches, r.status, ich)
    .map((k) => ({ ...k, schluessel: `mls:${r.gruppe}:${k.schluessel}`, privatRaum: r.gruppe, ...(r.name ? { raumName: r.name.slice(0, 80) } : {}) }));
}

/** Wohin ein Repo im Raum gehört (11.4c): öffentlicher Raum über seine Adresse (34700:…), privater über die Gruppe. */
export type RaumZiel = { adresse: string } | { gruppe: string };

/**
 * Die Repos eines Raums (11.4c) aus den geladenen Karten: öffentlich nur, was
 * bestätigt zu genau dieser Adresse gehört (Eigentümer mit „repos_pflegen“,
 * 11.4a) – ein bloßer Verweis zählt nicht –, privat nur die Karten dieser Gruppe.
 */
export function reposImRaum(karten: readonly RepoKarte[], ziel: RaumZiel): RepoKarte[] {
  return karten.filter((k) => ("gruppe" in ziel
    ? k.privatRaum === ziel.gruppe
    : !k.privatRaum && k.raumBestaetigt === true && k.repo?.raum === ziel.adresse));
}

/** Suche (nur lokal) und „Meine“: Name, Kennung oder Beschreibung enthält die Suche, ohne Groß/klein. */
export function filtereKarten(karten: readonly RepoKarte[], suche: string, nurMeine: boolean, ich: string | undefined): RepoKarte[] {
  const s = suche.trim().toLowerCase();
  return karten.filter((k) => (!nurMeine || (!!ich && (k.eigentuemer === ich || !!k.repo?.maintainer.includes(ich))))
    && (!s || [k.name, k.id, k.beschreibung ?? ""].some((x) => x.toLowerCase().includes(s))));
}

/** Felder der Einstellungen (C.3a2), wie eingetippt. */
export interface EinstellungFelder {
  name: string;
  beschreibung: string;
  /** Je eine Adresse pro Zeile (auch mit Leerzeichen oder Komma getrennt). */
  klon: string;
  web: string;
  maintainer: string;
  ersterCommit: string;
  /** Adresse des öffentlichen Raums (11.4a) oder leer. */
  raum?: string;
}

/** Höchstens so viele Adressen bzw. Maintainer je Feld – mehr ist Unfug. */
export const EINSTELLUNG_MAX = 20;

/**
 * Einstellungen → neue Ankündigung desselben Repos (die Kennung bleibt; eine
 * andere wäre ein neues Repo). Leere und doppelte Einträge fallen weg,
 * Schlüssel und Commit klein geschrieben; geprüft wird in
 * `baueRepoAnkuendigung()` (wirft `ProtokollFehler`).
 */
export function ankuendigungAusFeldern(id: string, f: EinstellungFelder): RepoAnkuendigung {
  const liste = (s: string, klein = false) =>
    [...new Set(s.split(/[\s,]+/).map((x) => (klein ? x.toLowerCase() : x)).filter(Boolean))].slice(0, EINSTELLUNG_MAX);
  const beschreibung = f.beschreibung.trim();
  const web = liste(f.web);
  const maintainer = liste(f.maintainer, true);
  const ersterCommit = f.ersterCommit.trim().toLowerCase();
  const raum = f.raum?.trim() ?? "";
  return {
    id, name: f.name.trim() || id, klon: liste(f.klon),
    ...(beschreibung ? { beschreibung } : {}), ...(web.length ? { web } : {}),
    ...(maintainer.length ? { maintainer } : {}), ...(ersterCommit ? { ersterCommit } : {}),
    ...(raum ? { raum } : {}),
  };
}

/**
 * Räume, denen ich ein Repo zuordnen darf (11.4a): aus der Struktur der
 * öffentlichen Räume, in denen ich bin – je Definition eine Adresse, und nur,
 * wo ich nach dem Zustand dieses Besitzers „repos_pflegen“ habe.
 */
export function raumAuswahl(raumEvents: readonly NostrEvent[], ich: string): { adresse: string; name: string }[] {
  const adressen = new Set<string>();
  for (const ev of raumEvents) {
    const id = ev.kind === KIND_SPACE ? ev.tags.find((t) => t[0] === "space")?.[1] : undefined;
    try { if (id) adressen.add(raumAdresse(ev.pubkey, id)); } catch { /* ungültige Kennung */ }
  }
  const out: { adresse: string; name: string }[] = [];
  for (const adresse of adressen) {
    const z = raumZustandFuer(adresse, raumEvents);
    if (z?.space && can(ich, RAUM_REPO_RECHT, z)) out.push({ adresse, name: z.space.name.slice(0, 80) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Web-Adressen fremder Repos: anklickbar nur mit https und ohne Zugangsdaten in der Adresse. */
export function sichereWebAdressen(web: readonly string[] | undefined): string[] {
  return (web ?? []).filter((w) => {
    try {
      const u = new URL(w);
      return u.protocol === "https:" && !u.username && !u.password;
    } catch {
      return false;
    }
  }).slice(0, 5);
}

/** Status eines Patches → Schlüssel des Texts (8.16f). */
export const STATUS_TEXT: Record<PatchStatus, string> = {
  offen: "repo.offen",
  angenommen: "repo.angenommen",
  geschlossen: "repo.geschlossen",
  entwurf: "repo.entwurf",
};

// ------------------------------------------------------------ Issues (C-17b)

/** Ein Issue in der Ansicht: Status nach `issueStatus()`, Kommentare nach NIP-22, und ob ich den Status ändern darf. */
export interface IssueZeile {
  issue: GelesenesIssue;
  status: IssueStatus;
  statusVon?: string;
  statusZeit?: number;
  kommentare: GelesenerKommentar[];
  /** Schließen und wieder öffnen: Autorin, Eigentümer, Maintainer – wie bei GitHub. */
  darfStatus: boolean;
}

/** Filter der Issue-Liste – „geschlossen“ umfasst „erledigt“. */
export type IssueFilter = "offen" | "geschlossen";
export const issueFilterVon = (s: IssueStatus): IssueFilter => (s === "offen" ? "offen" : "geschlossen");

/** Labels der Issues mit ihrer Zahl, häufigste zuerst (C-20e) – für die Auswahl im Reiter. */
export function issueLabels(zeilen: readonly IssueZeile[]): Array<{ label: string; n: number }> {
  const zahl = new Map<string, number>();
  for (const z of zeilen) for (const l of z.issue.labels) zahl.set(l, (zahl.get(l) ?? 0) + 1);
  return [...zahl].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/** Issues nach offen/geschlossen und – wenn gewählt – nach Label (C-20e). */
export function filtereIssues(zeilen: readonly IssueZeile[], f: IssueFilter, label: string | null): IssueZeile[] {
  return zeilen.filter((z) => issueFilterVon(z.status) === f && (!label || z.issue.labels.includes(label)));
}

/** Die Issues eines Repos: nur an genau dieses Repo adressierte, jedes einmal, neuestes zuerst; Unfug fällt heraus. */
export function issueZeilen(
  repo: GelesenesRepo, issues: readonly NostrEvent[], status: readonly NostrEvent[], kommentare: readonly NostrEvent[], ich: string | undefined,
): IssueZeile[] {
  const out = new Map<string, IssueZeile>();
  for (const ev of issues) {
    let issue: GelesenesIssue;
    try {
      issue = leseIssue(ev);
    } catch {
      continue; // fremdes Unfug-Event
    }
    if (issue.repoAdresse !== repo.adresse || out.has(issue.id)) continue;
    const st = issueStatus(issue, repo, status);
    out.set(issue.id, {
      issue, status: st.status, ...(st.von ? { statusVon: st.von, statusZeit: st.zeit } : {}),
      kommentare: kommentareZu(issue.id, kommentare), darfStatus: !!ich && (ich === issue.autor || darfAnnehmen(repo, ich)),
    });
  }
  return [...out.values()].sort((a, b) => b.issue.zeit - a.issue.zeit || a.issue.id.localeCompare(b.issue.id));
}

/** Review eines Patches (C-20g2): Kommentare an Zeilen (ältester zuerst) und je Person die neueste Bewertung. */
export interface PatchReview {
  zeilen: GelesenerZeilenKommentar[];
  bewertungen: Array<GeleseneBewertung & { maintainer: boolean }>;
}

type IssueDaten = { issues: readonly NostrEvent[]; status: readonly NostrEvent[]; kommentare: readonly NostrEvent[]; releases?: readonly NostrEvent[] };

/**
 * Karten um ihre Issues ergänzen (C-17b): öffentliche Karten nur mit
 * öffentlichen Events, Karten eines privaten Raums nur mit denen seiner
 * Gruppe – ein öffentliches Issue landet nie an einem privaten Repo gleicher
 * Adresse und umgekehrt. `repoKarten()` bleibt, wie sie ist.
 */
export function mitIssues(
  karten: readonly RepoKarte[], oeffentlich: IssueDaten, privat: readonly (IssueDaten & { gruppe: string })[], ich: string | undefined,
): RepoKarte[] {
  return karten.map((k) => {
    if (!k.repo) return k;
    const d = k.privatRaum ? privat.find((p) => p.gruppe === k.privatRaum) : oeffentlich;
    const zeilen = d ? issueZeilen(k.repo, d.issues, d.status, d.kommentare, ich) : [];
    // Kommentare an Patches (C-17c) aus denselben Daten – nie über die Grenze öffentlich/privat;
    // Teile eines Reviews (C-20g2) stehen an ihrer Zeile bzw. oben, nicht in der Diskussion
    const allgemein = d ? d.kommentare.filter((e) => !istReviewTeil(e)) : [];
    const patchKommentare = Object.fromEntries(k.zeilen.map((z) => [z.patch.id, kommentareZu(z.patch.id, allgemein)]));
    const repo = k.repo;
    const patchReviews = Object.fromEntries(k.zeilen.map((z): [string, PatchReview] => [z.patch.id, {
      zeilen: d ? zeilenKommentareZu(z.patch.id, d.kommentare) : [],
      bewertungen: d ? bewertungenZu(z.patch, repo, d.kommentare) : [],
    }]));
    // Releases (C-20h2) ebenso: öffentliche nur an öffentliche Karten, private nur aus ihrer Gruppe
    const releases = d ? repoReleasesZu(repo, d.releases ?? []) : [];
    return { ...k, issues: zeilen, offeneIssues: zeilen.filter((z) => z.status === "offen").length, patchKommentare, patchReviews, releases };
  });
}
