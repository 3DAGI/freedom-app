/**
 * Sterne und Beobachten auf der Repo-Seite (Schritt C-20j2, Sammlung C-20).
 * Format aus C-20j1 (`repo-sterne.ts`): Ein Stern ist öffentlich (Reaktion
 * nach NIP-25, zurück mit Löschung nach NIP-09) – darum fragt die App vorher.
 * Beobachten ist privat: die eigene Liste (Kind 10018) trägt nur Chiffrat,
 * verschlüsselt über den Signer an den eigenen Schlüssel. Wer beobachtet,
 * bekommt die Neuigkeiten des Repos (C-20f) wie bei eigener Beteiligung.
 *
 * Nur für öffentliche Repos – nicht für private Räume, nicht für Repos nur
 * auf diesem Gerät. Nur DOM und `textContent`.
 */
import { KIND_GIT_REPOS, baueBeobachtungsListe, baueStern, baueSternWeg, beobachtungsInhalt, eigeneBeobachtungsListe, leseBeobachtungsInhalt } from "@freedomstack/protocol";
import { t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import type { RepoKarte } from "../../repo-ansicht.js";
import { bestaetige } from "../dialog.js";
import { ensurePool, signiere, state } from "../state.js";
import { toast } from "../ui.js";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, klasse?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

function knopf(text: string, klasse: string, gedrueckt: boolean, tun: () => void): HTMLButtonElement {
  const b = el("button", text, klasse);
  b.type = "button";
  b.setAttribute("aria-pressed", String(gedrueckt));
  b.addEventListener("click", tun);
  return b;
}

type Pool = Awaited<ReturnType<typeof ensurePool>>;

/** Beobachtete Repos (Adressen) – nur im Speicher, aus der eigenen verschlüsselten Liste. */
let beobachtet: ReadonlySet<string> = new Set();

/**
 * Die eigene Liste holen und entschlüsseln. Wirft, wenn die Abfrage scheitert –
 * wer danach schreibt, überschriebe sonst eine Liste, die er nicht kennt.
 */
export async function ladeBeobachtet(pool: Pool): Promise<ReadonlySet<string>> {
  const ich = state.keypair?.pk;
  const signer = state.signer;
  if (!ich || !signer) return (beobachtet = new Set());
  const liste = eigeneBeobachtungsListe(ich, await pool.query({ kinds: [KIND_GIT_REPOS], authors: [ich], limit: 10 }));
  let adressen: string[] = [];
  if (liste) {
    try {
      adressen = leseBeobachtungsInhalt(await signer.nip44Decrypt(ich, liste.content));
    } catch { /* nicht lesbar – wie leer */ }
  }
  return (beobachtet = new Set(adressen));
}

/** Stern und Beobachten als Zeile unter dem Titel – `null` für private und lokale Repos. */
export function sternUndBeobachten(k: RepoKarte, neuLaden: () => Promise<void>): HTMLElement | null {
  const repo = k.repo;
  if (!repo || k.privatRaum || k.lokal) return null;
  const box = el("div", undefined, "repo-folgen");
  const n = k.sterne?.anzahl ?? 0;
  const eigener = k.sterne?.eigener;
  if (!state.keypair) {
    box.append(el("span", t("repo.sterneZahl", { n }), "mono-sm muted"));
    return box;
  }
  box.append(
    knopf(t(eigener ? "repo.sternWeg" : "repo.sternGeben", { n }), "ghost mini repo-stern", !!eigener, () => void stern(k, eigener, neuLaden)),
    knopf(t(k.beobachtet ? "repo.nichtBeobachten" : "repo.beobachten"), "ghost mini repo-beobachten", !!k.beobachtet, () => void beobachten(repo.adresse, !k.beobachtet, neuLaden)),
  );
  return box;
}

/** Stern vergeben (öffentlich – erst nach Rückfrage) oder den eigenen zurücknehmen. */
async function stern(k: RepoKarte, eigener: string | undefined, neuLaden: () => Promise<void>): Promise<void> {
  if (!k.repo || !state.keypair) return;
  if (!eigener && !(await bestaetige({ titel: t("repo.sternFrage", { name: k.name }), text: t("repo.sternHinweis"), ok: t("repo.sternOk") }))) return;
  try {
    const ev = eigener ? baueSternWeg(eigener, state.keypair.pk) : baueStern(k.repo, state.keypair.pk);
    await (await ensurePool()).publish(await signiere(ev));
    toast(t(eigener ? "repo.sternEntfernt" : "repo.sternGegeben"));
    await neuLaden();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

/** Beobachten an- oder ausschalten: die Liste frisch lesen, ändern, verschlüsselt neu veröffentlichen. */
async function beobachten(adresse: string, an: boolean, neuLaden: () => Promise<void>): Promise<void> {
  const ich = state.keypair?.pk;
  const signer = state.signer;
  if (!ich || !signer) return;
  try {
    const pool = await ensurePool();
    const neu = new Set(await ladeBeobachtet(pool));
    if (an) neu.add(adresse);
    else neu.delete(adresse);
    const chiffrat = await signer.nip44Encrypt(ich, beobachtungsInhalt([...neu]));
    await pool.publish(await signiere(baueBeobachtungsListe(chiffrat, ich)));
    beobachtet = neu;
    toast(t(an ? "repo.beobachtetJetzt" : "repo.nichtMehrBeobachtet"));
    await neuLaden();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}
