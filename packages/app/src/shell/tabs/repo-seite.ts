/**
 * Repo-Seite (Schritt C.3a): Kopf „Eigentümer / Name“, Beschreibung,
 * Maintainer, Klonen, Bundle laden; Reiter „Code“ und „Patches“.
 *
 * Nur DOM und `textContent` – Namen, Betreffe und Adressen kommen von Fremden.
 * Welches Repo offen ist, steht nur im Speicher (nie in der Adresse).
 */
import type { GelesenerPatch, GelesenesRepo, PatchStatus } from "@freedomstack/protocol";
import { gebietsschema, t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import { type PatchAktion, type PatchZeile, type RepoKarte, STATUS_TEXT } from "../../repo-ansicht.js";
import { bestaetige, dialog } from "../dialog.js";
import { ensurePool, signiere, state } from "../state.js";
import { toast } from "../ui.js";
import { kontaktName } from "./raeume.js";

const AKTION_TEXT: Record<PatchAktion, string> = { annehmen: "repo.annehmen", schliessen: "repo.schliessen", zurueckziehen: "repo.zurueckziehen" };
const SHA1 = /^[0-9a-f]{40}$/;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, klasse?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

function knopf(text: string, klasse: string, tun: () => void): HTMLButtonElement {
  const b = el("button", text);
  b.className = klasse;
  b.type = "button";
  b.addEventListener("click", tun);
  return b;
}

export const eigentuemerName = (pk: string): string => (pk === state.keypair?.pk ? t("raum.ich") : kontaktName(pk));
const datum = (s: number) => new Date(s * 1000).toLocaleDateString(gebietsschema(), { day: "numeric", month: "short", year: "numeric" });

export interface RepoSeiteHilfe {
  zurueck: () => void;
  neuLaden: () => Promise<void>;
  patchSenden: (r: GelesenesRepo) => void;
}

/** Filter der Patches – „offen“ umfasst Entwürfe. */
type PatchFilter = "offen" | "angenommen" | "geschlossen";
const filterVon = (s: PatchStatus): PatchFilter => (s === "entwurf" ? "offen" : s);

export function zeigeRepoSeite(box: HTMLElement, k: RepoKarte, h: RepoSeiteHilfe, reiter: "code" | "patches" = k.zeilen.length ? "patches" : "code"): void {
  const zurueck = knopf(t("repo.alleRepos"), "ghost mini repo-zurueck", h.zurueck);
  const kopf = el("h2", undefined, "repo-titel");
  kopf.append(el("span", eigentuemerName(k.eigentuemer), "repo-eigentuemer"), el("span", " / ", "muted"), el("span", k.name));
  kopf.title = k.eigentuemer;
  const teile: HTMLElement[] = [zurueck, kopf];
  if (k.beschreibung) teile.push(el("p", k.beschreibung, "repo-beschreibung"));
  if (k.repo?.maintainer.length) teile.push(el("p", t("repo.maintainer", { namen: k.repo.maintainer.map(eigentuemerName).join(", ") }), "mono-sm muted"));
  if (!k.repo) teile.push(el("p", t("repo.nurBundle"), "mono-sm muted"));
  teile.push(klonKasten(k));

  // Reiter: Code und Patches
  const leiste = el("div", undefined, "seg repo-reiter");
  leiste.setAttribute("role", "tablist");
  const inhalt = el("div", undefined, "repo-inhalt");
  inhalt.setAttribute("role", "tabpanel");
  const reiterKnopf = (id: "code" | "patches", text: string) => {
    const b = knopf(text, id === reiter ? "active" : "", () => {
      zeigeRepoSeite(box, k, h, id);
      box.querySelector<HTMLElement>(`[data-reiter="${id}"]`)?.focus();
    });
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(id === reiter));
    b.dataset.reiter = id;
    return b;
  };
  leiste.append(reiterKnopf("code", t("repo.code")), reiterKnopf("patches", t("repo.patchesZahl", { n: k.offen })));
  inhalt.append(...(reiter === "code" ? codeReiter(k) : patchReiter(k, h)));
  box.replaceChildren(...teile, leiste, inhalt);
}

/** Klonen: Adressen zum Kopieren; Bundle laden (verschlüsselt geladen, hier entschlüsselt). */
function klonKasten(k: RepoKarte): HTMLElement {
  const kasten = el("div", undefined, "repo-klon");
  kasten.append(el("h3", t("repo.klonenTitel")));
  for (const adresse of k.repo?.klon ?? []) {
    const zeile = el("div", undefined, "repo-klon-zeile");
    const feld = el("input", undefined, "mono");
    feld.readOnly = true;
    feld.value = t("repo.klonZeile", { adresse });
    feld.setAttribute("aria-label", t("repo.klonBefehl"));
    zeile.append(feld, knopf(t("dlg.kopieren"), "ghost mini repo-knopf", () => void navigator.clipboard?.writeText(feld.value).then(() => toast(t("dlg.kopiert")))));
    kasten.append(zeile);
  }
  if (k.bundle) {
    const bundle = k.bundle;
    const zeile = el("div", undefined, "repo-klon-zeile");
    const wann = el("span", t("repo.bundleStand", { datum: datum(bundle.created_at) }), "mono-sm muted");
    const b = knopf(t("repo.bundleLaden"), "ghost mini repo-knopf", () => void ladeBundle(b, k));
    zeile.append(wann, b);
    kasten.append(zeile);
  }
  if (!k.repo?.klon.length && !k.bundle) kasten.append(el("p", t("repo.keineKlonAdresse"), "mono-sm muted"));
  return kasten;
}

async function ladeBundle(b: HTMLButtonElement, k: RepoKarte): Promise<void> {
  if (!k.bundle) return;
  b.disabled = true;
  try {
    const { downloadBlob, oeffneAnhang } = await import("../../blob-client.js");
    const { parseGitRepoRef } = await import("@freedomstack/protocol");
    const ref = parseGitRepoRef(k.bundle);
    const res = await downloadBlob(ref.blobId, (await ensurePool()) as never);
    if (!res) {
      toast(t("agent.bundleKaputt"), true);
      return;
    }
    // Seit 8.9b verschlüsselt, der Schlüssel steht öffentlich in der Referenz; ältere Bundles sind Klartext
    const bytes = ref.schluessel ? await oeffneAnhang(res.bytes, ref.schluessel) : res.bytes;
    const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${k.id.replace(/[^a-z0-9._-]/gi, "-")}.bundle`;
    a.click();
    URL.revokeObjectURL(url);
    toast(t("agent.bundleGeladen", { datei: a.download }));
  } catch (e) {
    toast(t("agent.fehlerText", { fehler: fehlerText(e) }), true);
  } finally {
    b.disabled = false;
  }
}

/** Code: Die App liest Bundles noch nicht selbst (C.3c) – ehrlich sagen, wie man an den Code kommt. */
function codeReiter(k: RepoKarte): HTMLElement[] {
  return [el("p", t(k.bundle ? "repo.codeMitBundle" : "repo.codeOhneBundle"), "mono-sm muted")];
}

function patchReiter(k: RepoKarte, h: RepoSeiteHilfe): HTMLElement[] {
  const teile: HTMLElement[] = [];
  const repo = k.repo;
  if (repo) teile.push(knopf(t("repo.patchSenden"), "ghost mini repo-patch-senden", () => h.patchSenden(repo)));
  const zahl = (f: PatchFilter) => k.zeilen.filter((z) => filterVon(z.status) === f).length;
  const liste = el("div", undefined, "repo-patches");
  const zeige = (f: PatchFilter) => {
    filter.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === f)));
    const zeilen = k.zeilen.filter((z) => filterVon(z.status) === f);
    liste.replaceChildren(...(zeilen.length ? zeilen.map((z) => patchZeile(z, k, h)) : [el("p", t("repo.keinePatches"), "mono-sm muted")]));
  };
  const filter = el("div", undefined, "repo-filter");
  for (const f of ["offen", "angenommen", "geschlossen"] as const) {
    const b = knopf(t("repo.filterZahl", { status: t(STATUS_TEXT[f]), n: zahl(f) }), "ghost mini repo-knopf", () => zeige(f));
    b.dataset.filter = f;
    filter.append(b);
  }
  teile.push(filter, liste);
  zeige("offen");
  return teile;
}

function patchZeile(z: PatchZeile, k: RepoKarte, h: RepoSeiteHilfe): HTMLElement {
  const zeile = el("div", undefined, "repo-patch");
  const links = el("div", undefined, "repo-patch-text");
  links.append(el("div", z.patch.betreff, "repo-patch-betreff"),
    el("div", t("repo.patchVon", { name: eigentuemerName(z.patch.autor), datum: datum(z.patch.zeit) }), "mono-sm muted"));
  const rechts = el("div", undefined, "repo-patch-status");
  const marke = el("span", t(STATUS_TEXT[z.status]));
  marke.className = `repo-status status-${z.status}`;
  rechts.append(marke);
  for (const a of z.aktionen) rechts.append(knopf(t(AKTION_TEXT[a]), a === "annehmen" ? "mini repo-knopf" : "ghost mini repo-knopf", () => void setzeStatus(k, z.patch, a, h)));
  zeile.append(links, rechts);
  return zeile;
}

/** Annehmen mit optionalem Commit, schließen und zurückziehen nach Rückfrage – öffentlich und signiert. */
async function setzeStatus(k: RepoKarte, patch: GelesenerPatch, aktion: PatchAktion, h: RepoSeiteHilfe): Promise<void> {
  if (!state.keypair || !k.repo) return;
  let commits: string[] | undefined;
  if (aktion === "annehmen") {
    const w = await dialog({
      titel: t("repo.annehmenTitel", { betreff: patch.betreff }), ok: t("repo.annehmen"),
      felder: [{ art: "text", name: "commit", label: t("repo.welcherCommit"), mono: true }],
      pruefe: (w) => { const c = String(w.commit ?? "").trim().toLowerCase(); return !c || SHA1.test(c) ? null : t("repo.keinSha1"); },
    });
    if (!w) return;
    const c = String(w.commit ?? "").trim().toLowerCase();
    commits = c ? [c] : undefined;
  } else if (!await bestaetige({ titel: t(AKTION_TEXT[aktion]), text: patch.betreff, ok: t(AKTION_TEXT[aktion]), gefahr: true })) return;
  try {
    const { baueStatus } = await import("@freedomstack/protocol");
    const status = aktion === "annehmen" ? "angenommen" : "geschlossen";
    await (await ensurePool()).publish(await signiere(baueStatus({ patch, status, eigentuemer: k.repo.eigentuemer, commits }, state.keypair.pk)));
    toast(t(aktion === "annehmen" ? "repo.patchAngenommen" : aktion === "zurueckziehen" ? "repo.patchZurueckgezogen" : "repo.patchGeschlossen"));
    await h.neuLaden();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}
