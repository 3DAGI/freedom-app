/**
 * Repos in privaten Räumen in der App (Schritt 11.4b2).
 *
 * Gelesen wird aus dem Verlauf der MLS-Gruppe (`raumReposPrivat()`), gesendet
 * nur in die Gruppe (`mlsSendeEvent()`) – Ankündigung, Bundle-Verweis samt
 * Schlüssel, Patches und Status sind innere Events, nie offen (Leak-Regel
 * „raum-repo-privat“). Die Engine lädt erst, wenn es private Räume gibt und
 * die Repo-Seite sie braucht.
 */
import { RAUM_REPO_RECHT, can, gruppenRaum, raumReposPrivat, type InneresSenden, type NostrEvent } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { mlsGesperrt, mlsGruppenStand, mlsSendeEvent } from "./mls-konto.js";
import { privateRaeume } from "./raum-mls.js";

export interface PrivateRepos {
  gruppe: string;
  /** Name des Raums (fremder Text – nur über textContent zeigen). */
  name: string;
  /** Darf ich hier Repos ankündigen und pflegen? */
  darfPflegen: boolean;
  ankuendigungen: NostrEvent[];
  bundles: NostrEvent[];
  patches: NostrEvent[];
  status: NostrEvent[];
  /** Issues und Kommentare (C-17a) – nur innere Events der Gruppe. */
  issues: NostrEvent[];
  kommentare: NostrEvent[];
}

/** Repos aller privaten Räume – leer ohne private Räume, mit Bunker oder ohne Tresor. */
export async function privateRaumRepos(): Promise<PrivateRepos[]> {
  const gruppen = privateRaeume();
  if (gruppen.length === 0 || mlsGesperrt()) return [];
  const out: PrivateRepos[] = [];
  for (const gruppe of gruppen) {
    const stand = await mlsGruppenStand(gruppe).catch(() => null);
    if (!stand) continue;
    const { zustand } = gruppenRaum(gruppe, stand.ereignisse, stand);
    out.push({
      gruppe, name: zustand.space?.name ?? "", darfPflegen: can(stand.ich, RAUM_REPO_RECHT, zustand),
      ...raumReposPrivat(gruppe, stand.ereignisse, zustand),
    });
  }
  return out;
}

/** Ein Repo-Event in die Gruppe – scheitert laut, statt still auf ein Relay auszuweichen. */
export async function sendeInRaum(gruppe: string, s: InneresSenden): Promise<void> {
  if (!(await mlsSendeEvent(gruppe, s))) throw new Error(t("repo.nichtInRaum"));
}
