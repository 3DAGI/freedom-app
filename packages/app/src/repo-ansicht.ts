/**
 * Repositories nach NIP-34 in der App (Schritt 8.10b): aus Events die Zeilen
 * der Ansicht – ohne DOM, damit testbar. Die Oberflaeche steht in
 * shell/tabs/repos.ts.
 */
import {
  KIND_GIT_REPO_REF, KIND_REPO_ANKUENDIGUNG, darfAnnehmen, lesePatch, leseRepoAnkuendigung, patchStatus,
  type GelesenerPatch, type GelesenesRepo, type NostrEvent, type PatchStatus,
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

export type PatchAktion = "annehmen" | "schliessen" | "zurueckziehen";

export interface PatchZeile {
  patch: GelesenerPatch;
  status: PatchStatus;
  statusVon?: string;
  /** Was ich hier tun darf. */
  aktionen: PatchAktion[];
}

/**
 * Patches eines Repos mit Status – neueste zuerst. Maintainer duerfen
 * annehmen und schliessen, der Autor seinen eigenen Patch zurueckziehen.
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
    const aktionen: PatchAktion[] = [];
    const offen = st.status === "offen" || st.status === "entwurf";
    if (ich && offen && darfAnnehmen(repo, ich)) aktionen.push("annehmen", "schliessen");
    else if (ich && offen && ich === patch.autor) aktionen.push("zurueckziehen");
    zeilen.push({ patch, status: st.status, ...(st.von ? { statusVon: st.von } : {}), aktionen });
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

/** Status eines Patches → Schlüssel des Texts (8.16f). */
export const STATUS_TEXT: Record<PatchStatus, string> = {
  offen: "repo.offen",
  angenommen: "repo.angenommen",
  geschlossen: "repo.geschlossen",
  entwurf: "repo.entwurf",
};
