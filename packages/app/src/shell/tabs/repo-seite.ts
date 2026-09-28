/**
 * Repo-Seite (Schritt C.3a): Kopf „Eigentümer / Name“, Beschreibung,
 * Maintainer, Klonen, Bundle laden; Reiter „Code“, „Patches“, (seit C.3a2)
 * „Mitwirkende“ und – nur für den Eigentümer – „Einstellungen“ mit „Neue
 * Version hochladen“.
 *
 * Nur DOM und `textContent` – Namen, Betreffe und Adressen kommen von Fremden.
 * Welches Repo offen ist, steht nur im Speicher (nie in der Adresse).
 */
import type { GelesenerPatch, GelesenesRepo, NostrEvent, PatchStatus } from "@freedomstack/protocol";
import { gebietsschema, t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import {
  type EinstellungFelder, type PatchAktion, type PatchZeile, type RepoKarte, STATUS_TEXT, ankuendigungAusFeldern, sichereWebAdressen,
} from "../../repo-ansicht.js";
import { bestaetige, dialog } from "../dialog.js";
import { ensurePool, signiere, state } from "../state.js";
import { mitwirkendeListe } from "../mitwirkende.js";
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
  /** Beiträge (38056) – alle, gefiltert wird lokal: eine Abfrage nach Kennung verriete, welches Repo man ansieht. */
  mitwirkende: () => Promise<NostrEvent[]>;
  /** Bundle verschlüsselt hochladen und die Referenz (38042) mit dieser Kennung veröffentlichen. */
  hochladen: (datei: File, kennung: string) => Promise<boolean>;
}

export type RepoReiter = "code" | "patches" | "mitwirkende" | "einstellungen";
/** Zuletzt gewählter Reiter je Repo – damit „Neu laden“ nach dem Speichern dort bleibt; nur im Speicher. */
let gemerkt: { schluessel: string; reiter: RepoReiter } | null = null;
/** Beim Öffnen aus der Liste beginnt die Seite wieder vorn. */
export const vergissReiter = (): void => { gemerkt = null; };

/** Filter der Patches – „offen“ umfasst Entwürfe. */
type PatchFilter = "offen" | "angenommen" | "geschlossen";
const filterVon = (s: PatchStatus): PatchFilter => (s === "entwurf" ? "offen" : s);

export function zeigeRepoSeite(box: HTMLElement, k: RepoKarte, h: RepoSeiteHilfe, gewaehlt?: RepoReiter): void {
  const eigentuemer = !!state.keypair && k.eigentuemer === state.keypair.pk;
  let reiter: RepoReiter = gewaehlt ?? (gemerkt?.schluessel === k.schluessel ? gemerkt.reiter : k.zeilen.length ? "patches" : "code");
  if (reiter === "einstellungen" && !eigentuemer) reiter = "code";
  gemerkt = { schluessel: k.schluessel, reiter };
  const zurueck = knopf(t("repo.alleRepos"), "ghost mini repo-zurueck", h.zurueck);
  const kopf = el("h2", undefined, "repo-titel");
  kopf.append(el("span", eigentuemerName(k.eigentuemer), "repo-eigentuemer"), el("span", " / ", "muted"), el("span", k.name));
  kopf.title = k.eigentuemer;
  const teile: HTMLElement[] = [zurueck, kopf];
  if (k.beschreibung) teile.push(el("p", k.beschreibung, "repo-beschreibung"));
  const web = sichereWebAdressen(k.repo?.web);
  if (web.length) {
    const zeile = el("p", undefined, "repo-web mono-sm");
    for (const adresse of web) {
      const a = el("a", adresse);
      a.href = adresse;
      a.target = "_blank";
      a.relList.add("noopener", "noreferrer");
      zeile.append(a);
    }
    teile.push(zeile);
  }
  if (k.repo?.maintainer.length) teile.push(el("p", t("repo.maintainer", { namen: k.repo.maintainer.map(eigentuemerName).join(", ") }), "mono-sm muted"));
  if (!k.repo) teile.push(el("p", t("repo.nurBundle"), "mono-sm muted"));
  teile.push(klonKasten(k));

  // Reiter: Code, Patches, Mitwirkende, Einstellungen (nur Eigentümer)
  const leiste = el("div", undefined, "seg repo-reiter");
  leiste.setAttribute("role", "tablist");
  const inhalt = el("div", undefined, "repo-inhalt");
  inhalt.setAttribute("role", "tabpanel");
  const reiterKnopf = (id: RepoReiter, text: string) => {
    const b = knopf(text, id === reiter ? "active" : "", () => {
      zeigeRepoSeite(box, k, h, id);
      box.querySelector<HTMLElement>(`[data-reiter="${id}"]`)?.focus();
    });
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(id === reiter));
    b.dataset.reiter = id;
    return b;
  };
  leiste.append(reiterKnopf("code", t("repo.code")), reiterKnopf("patches", t("repo.patchesZahl", { n: k.offen })), reiterKnopf("mitwirkende", t("earn.mitwirkende")));
  if (eigentuemer) leiste.append(reiterKnopf("einstellungen", t("repo.einstellungen")));
  inhalt.append(...(reiter === "code" ? codeReiter(k) : reiter === "patches" ? patchReiter(k, h)
    : reiter === "mitwirkende" ? mitwirkendeReiter(k, h) : einstellungenReiter(k, h)));
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

/** Mitwirkende (38056) mit der Kennung dieses Repos – dieselbe Liste wie auf der Seite „Repos“. */
function mitwirkendeReiter(k: RepoKarte, h: RepoSeiteHilfe): HTMLElement[] {
  const liste = el("div", t("earn.lade"), "repo-mitwirkende mono-sm");
  void h.mitwirkende().then(
    (evs) => liste.replaceChildren(...mitwirkendeListe(k.id, evs, eigentuemerName)),
    (e) => { liste.textContent = t("agent.nichtAbrufbar", { fehler: fehlerText(e) }); },
  );
  return [el("p", t("earn.mitwirkendeText"), "mono-sm muted"), el("p", t("repo.mitwirkendeKennung", { id: k.id }), "mono-sm muted"), liste];
}

/**
 * Einstellungen (nur Eigentümer): die Felder, die `baueRepoAnkuendigung()`
 * kennt – die Kennung bleibt. Speichern veröffentlicht nach Rückfrage eine
 * neue Ankündigung. Darunter „Neue Version hochladen“ (zog aus `app.ts` hierher).
 */
function einstellungenReiter(k: RepoKarte, h: RepoSeiteHilfe): HTMLElement[] {
  const r = k.repo;
  const form = el("form", undefined, "repo-einstellungen");
  form.noValidate = true;
  const feld = (name: keyof EinstellungFelder, label: string, wert: string, mehrzeilig: boolean, mono: boolean) => {
    const f = mehrzeilig ? el("textarea") : el("input");
    f.id = `repo-feld-${name}`;
    f.name = name;
    f.value = wert;
    if (mehrzeilig) (f as HTMLTextAreaElement).rows = 3;
    if (mono) f.classList.add("mono");
    const l = el("label", label);
    l.htmlFor = f.id;
    form.append(l, f);
  };
  form.append(el("p", t("repo.kennungFest", { id: k.id }), "mono-sm muted"));
  feld("name", t("profil.name"), r?.name ?? k.name, false, false);
  feld("beschreibung", t("repo.beschreibung"), r?.beschreibung ?? "", true, false);
  feld("klon", t("repo.feldKlon"), (r?.klon ?? []).join("\n"), true, true);
  feld("web", t("repo.feldWeb"), (r?.web ?? []).join("\n"), true, true);
  feld("maintainer", t("repo.feldMaintainer"), (r?.maintainer ?? []).join("\n"), true, true);
  feld("ersterCommit", t("repo.feldErsterCommit"), r?.ersterCommit ?? "", false, true);
  const fehler = el("p", undefined, "repo-fehler");
  fehler.setAttribute("role", "alert");
  const speichern = el("button", t(r ? "repo.speichern" : "agent.repoAnkuendigen"));
  speichern.type = "submit";
  form.append(fehler, speichern);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void speichereEinstellungen(k, form, fehler, h);
  });

  const hoch = el("div", undefined, "repo-hochladen");
  const datei = el("input");
  datei.type = "file";
  datei.accept = ".bundle";
  datei.hidden = true;
  const b = knopf(t("repo.neueVersion"), "ghost mini repo-knopf", () => datei.click());
  datei.addEventListener("change", () => {
    const f = datei.files?.[0];
    datei.value = "";
    if (!f) return;
    b.disabled = true;
    void h.hochladen(f, k.id).finally(() => { b.disabled = false; });
  });
  hoch.append(el("h3", t("repo.neueVersion")), el("p", t("repo.neueVersionText"), "mono-sm muted"), b, datei);
  return [form, hoch];
}

async function speichereEinstellungen(k: RepoKarte, form: HTMLFormElement, fehler: HTMLElement, h: RepoSeiteHilfe): Promise<void> {
  if (!state.keypair) return;
  const wert = (name: keyof EinstellungFelder) => (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
  fehler.textContent = "";
  try {
    const { baueRepoAnkuendigung } = await import("@freedomstack/protocol");
    const ev = baueRepoAnkuendigung(ankuendigungAusFeldern(k.id, {
      name: wert("name"), beschreibung: wert("beschreibung"), klon: wert("klon"), web: wert("web"),
      maintainer: wert("maintainer"), ersterCommit: wert("ersterCommit"),
    }), state.keypair.pk);
    if (!await bestaetige({ titel: t("repo.speichern"), text: t("repo.speichernFrage"), ok: t("repo.speichern") })) return;
    await (await ensurePool()).publish(await signiere(ev));
    toast(t("repo.angekuendigt", { id: k.id }));
    await h.neuLaden();
  } catch (e) {
    fehler.textContent = fehlerText(e);
  }
}
