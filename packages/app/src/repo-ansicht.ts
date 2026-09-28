/**
 * Repositories nach NIP-34 in der App (Schritt 8.10b): aus Events die Zeilen
 * der Ansicht – ohne DOM, damit testbar. Die Oberflaeche steht in
 * shell/tabs/repos.ts.
 */
import {
  KIND_GIT_REPO_REF, KIND_REPO_ANKUENDIGUNG, KIND_STATUS_ANGENOMMEN, KIND_STATUS_ENTWURF, KIND_STATUS_GESCHLOSSEN, KIND_STATUS_OFFEN,
  darfAnnehmen, lesePatch, leseRepoAnkuendigung, patchStatus,
  type GelesenerPatch, type GelesenesRepo, type NostrEvent, type PatchStatus, type RepoAnkuendigung,
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
  zeilen: PatchZeile[];
  offen: number;
  /** Letzte Aktivität (Sekunden): Ankündigung, Bundle, Patch oder Status. */
  zuletzt: number;
}

export function repoKarten(
  ankuendigungen: readonly NostrEvent[], bundles: readonly NostrEvent[], patches: readonly NostrEvent[],
  status: readonly NostrEvent[], ich: string | undefined,
): RepoKarte[] {
  const karten = new Map<string, RepoKarte>();
  const zeitVon = new Map<string, number>();
  for (const ev of ankuendigungen) {
    const d = ev.tags.find((t) => t[0] === "d")?.[1] ?? "";
    zeitVon.set(`${ev.pubkey}:${d}`, Math.max(zeitVon.get(`${ev.pubkey}:${d}`) ?? 0, ev.created_at));
  }
  for (const repo of repoZeilen(ankuendigungen)) {
    const zeilen = patchZeilen(repo, patches, status, ich);
    const schluessel = `${repo.eigentuemer}:${repo.id}`;
    const zuletzt = Math.max(zeitVon.get(schluessel) ?? 0, ...zeilen.map((z) => z.patch.zeit));
    karten.set(schluessel, {
      schluessel, id: repo.id, name: repo.name, eigentuemer: repo.eigentuemer, repo, zeilen,
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
  return {
    id, name: f.name.trim() || id, klon: liste(f.klon),
    ...(beschreibung ? { beschreibung } : {}), ...(web.length ? { web } : {}),
    ...(maintainer.length ? { maintainer } : {}), ...(ersterCommit ? { ersterCommit } : {}),
  };
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
