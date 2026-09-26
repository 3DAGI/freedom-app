/**
 * Repositories nach NIP-34 in der App (Schritt 8.10b): aus Events die Zeilen
 * der Ansicht – ohne DOM, damit testbar. Die Oberflaeche steht in
 * shell/tabs/repos.ts.
 */
import {
  KIND_REPO_ANKUENDIGUNG, darfAnnehmen, lesePatch, leseRepoAnkuendigung, patchStatus,
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

export const STATUS_TEXT: Record<PatchStatus, string> = {
  offen: "offen",
  angenommen: "angenommen ✓",
  geschlossen: "geschlossen",
  entwurf: "Entwurf",
};
