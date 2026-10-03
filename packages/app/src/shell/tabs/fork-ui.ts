/**
 * Forks auf der Repo-Seite (Schritt C-20j3, Sammlung C-20) – wie bei GitHub.
 * Format aus C-20j1: ein Fork ist eine eigene Ankündigung (30617) mit
 * `["a", <original>, "", "fork"]` (`forkVon`). Das Bundle wird nicht neu
 * hochgeladen: Der eigene Verweis (38042) zeigt auf denselben Blob mit
 * demselben Schlüssel – der stand beim Original ohnehin öffentlich im Verweis.
 *
 * Nur öffentliche Repos (nicht private Räume, nicht nur auf diesem Gerät),
 * nie das eigene. Nur DOM und `textContent`.
 */
import { t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import type { RepoKarte } from "../../repo-ansicht.js";
import { dialog } from "../dialog.js";
import { ensurePool, signiere, state } from "../state.js";
import { toast } from "../ui.js";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, klasse?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

function knopf(text: string, klasse: string, tun: () => void): HTMLButtonElement {
  const b = el("button", text, klasse);
  b.type = "button";
  b.addEventListener("click", tun);
  return b;
}

const REPO_ID = /^[a-zA-Z0-9._-]{1,64}$/;

export interface ForkAngaben {
  name: (pk: string) => string;
  neuLaden: () => Promise<void>;
  /** Ein anderes Repo der Liste öffnen (das Original). */
  zuRepo: (schluessel: string) => void;
  /** Kennungen meiner eigenen Repos – ein Fork darf keines davon ersetzen. */
  eigeneKennungen: () => readonly string[];
}

/** „Geforkt von …“ (mit Weg zum Original, wenn es in der Liste steht), Zahl der Forks und „Forken“. */
export function forkZeile(k: RepoKarte, a: ForkAngaben): HTMLElement | null {
  const repo = k.repo;
  if (!repo || k.privatRaum || k.lokal) return null;
  const box = el("div", undefined, "repo-fork mono-sm");
  if (repo.forkVon) {
    const [, eigentuemer = "", id = ""] = repo.forkVon.split(":");
    const herkunft = el("p", undefined, "repo-fork-herkunft");
    herkunft.append(el("span", t("repo.geforktVon", { name: `${a.name(eigentuemer)} / ${id}` })));
    const original = k.forkVonKarte;
    if (original) herkunft.append(knopf(t("repo.zumOriginal"), "ghost mini repo-zum-original", () => a.zuRepo(original)));
    box.append(herkunft);
  }
  const zeile = el("p", undefined, "repo-fork-zahl");
  zeile.append(el("span", t("repo.forksZahl", { n: k.forks?.length ?? 0 }), "muted"));
  if (state.keypair && k.eigentuemer !== state.keypair.pk) zeile.append(knopf(t("repo.forken"), "ghost mini repo-forken", () => void forken(k, a)));
  box.append(zeile);
  return box;
}

/** Forken: eigene Ankündigung mit Verweis aufs Original, dazu der Verweis auf dasselbe Bundle. */
async function forken(k: RepoKarte, a: ForkAngaben): Promise<void> {
  const repo = k.repo;
  if (!repo || !state.keypair) return;
  const eigene = new Set(a.eigeneKennungen());
  const w = await dialog({
    titel: t("repo.forkTitel", { name: k.name }), ok: t("repo.forken"), text: t("repo.forkHinweis"),
    felder: [
      { art: "text", name: "kennung", label: t("repo.forkKennung"), wert: repo.id, pflicht: true, mono: true },
      { art: "text", name: "name", label: t("repo.forkName"), wert: repo.name, pflicht: true },
    ],
    pruefe: (werte) => {
      const id = String(werte.kennung ?? "").trim();
      if (!REPO_ID.test(id)) return t("pf.repoKennung");
      return eigene.has(id) ? t("repo.forkGibtEs", { kennung: id }) : null;
    },
  });
  if (!w) return;
  const id = String(w.kennung ?? "").trim();
  try {
    const { baueRepoAnkuendigung, buildGitRepoRef, parseGitRepoRef } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    await pool.publish(await signiere(baueRepoAnkuendigung({
      id, name: String(w.name ?? "").trim() || id, klon: [], forkVon: repo.adresse,
      ...(repo.beschreibung ? { beschreibung: repo.beschreibung } : {}), ...(repo.ersterCommit ? { ersterCommit: repo.ersterCommit } : {}),
    }, state.keypair.pk)));
    // Das Bundle von jetzt: derselbe Blob, derselbe (öffentliche) Schlüssel – nichts wird neu hochgeladen
    if (k.bundle) {
      const ref = parseGitRepoRef(k.bundle);
      if (ref.schluessel) {
        await pool.publish(await signiere(buildGitRepoRef({
          name: id, blobId: ref.blobId, headSha: ref.headSha, branch: ref.branch, message: ref.message,
          version: Math.floor(Date.now() / 1000), schluessel: ref.schluessel,
        }, state.keypair.pk)));
      }
    }
    toast(t("repo.geforkt", { kennung: id }));
    await a.neuLaden();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}
