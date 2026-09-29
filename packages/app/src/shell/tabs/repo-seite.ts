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
  AKTION_STATUS, type EinstellungFelder, type PatchAktion, type PatchZeile, type RepoKarte, STATUS_TEXT, ankuendigungAusFeldern, sichereWebAdressen,
} from "../../repo-ansicht.js";
import { bestaetige, dialog } from "../dialog.js";
import { ensurePool, signiere, state } from "../state.js";
import { mitwirkendeListe } from "../mitwirkende.js";
import { sendeInRaum } from "../raum-repos.js";
import { toast } from "../ui.js";
import { codeReiter, commitsReiter, holeBundle } from "./code-reiter.js";
import { issuesReiter, vergissIssue } from "./issues-reiter.js";
import { zeigePatch } from "./patch-seite.js";
import { kontaktName } from "./raeume.js";

const AKTION_TEXT: Record<PatchAktion, string> = {
  annehmen: "repo.annehmen", entwurf: "repo.alsEntwurf", wiederOeffnen: "repo.wiederOeffnen", schliessen: "repo.schliessen", zurueckziehen: "repo.zurueckziehen",
};
const AKTION_MELDUNG: Record<PatchAktion, string> = {
  annehmen: "repo.patchAngenommen", entwurf: "repo.patchEntwurf", wiederOeffnen: "repo.patchWiederOffen", schliessen: "repo.patchGeschlossen", zurueckziehen: "repo.patchZurueckgezogen",
};
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
  /** Patch veröffentlichen (nach der Vorschau); lädt nicht neu – das tut die Seite danach. */
  patchSenden: (r: GelesenesRepo, text: string, gruppe?: string) => Promise<boolean>;
  /** Beiträge (38056) – alle, gefiltert wird lokal: eine Abfrage nach Kennung verriete, welches Repo man ansieht. */
  mitwirkende: () => Promise<NostrEvent[]>;
  /** Bundle verschlüsselt hochladen und die Referenz (38042) mit dieser Kennung veröffentlichen. */
  hochladen: (datei: File, kennung: string, gruppe?: string) => Promise<boolean>;
  /** Öffentliche Räume, denen ich Repos zuordnen darf (11.4a). */
  raeume: () => Promise<{ adresse: string; name: string }[]>;
  /** In den Raum des Repos wechseln (11.4c). */
  zumRaum: () => void;
}

export type RepoReiter = "code" | "commits" | "issues" | "patches" | "mitwirkende" | "einstellungen";
/** Zuletzt gewählter Reiter je Repo – damit „Neu laden“ nach dem Speichern dort bleibt; nur im Speicher. */
let gemerkt: { schluessel: string; reiter: RepoReiter } | null = null;
/** Offener Patch, zuletzt gewählter Filter und die Vorschau vor dem Senden (C.3b1) – nur im Speicher. */
let offenerPatch: string | null = null;
let letzterFilter: PatchFilter = "offen";
let vorschau: { schluessel: string; text: string; betreff: string; commit: string } | null = null;
/** Beim Öffnen aus der Liste beginnt die Seite wieder vorn. */
export const vergissReiter = (): void => {
  vergissIssue();
  gemerkt = null;
  offenerPatch = null;
  letzterFilter = "offen";
  vorschau = null;
};

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
  const raum = raumZeile(k, h);
  if (raum) teile.push(raum);
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
  leiste.append(reiterKnopf("code", t("repo.code")), reiterKnopf("commits", t("repo.commits")),
    reiterKnopf("issues", t("repo.issuesZahl", { n: k.offeneIssues ?? 0 })), reiterKnopf("patches", t("repo.patchesZahl", { n: k.offen })),
    reiterKnopf("mitwirkende", t("earn.mitwirkende")));
  if (eigentuemer) leiste.append(reiterKnopf("einstellungen", t("repo.einstellungen")));
  const angenommen = k.zeilen.filter((z) => z.status === "angenommen").map((z) => ({ betreff: z.patch.betreff, commits: z.commits ?? [] }));
  inhalt.append(...(reiter === "code" ? codeReiter(k.bundle, k.name, () => zeigeRepoSeite(box, k, h, "code"))
    : reiter === "commits" ? commitsReiter(k.bundle, angenommen, () => zeigeRepoSeite(box, k, h, "commits"))
    : reiter === "issues" ? issuesReiter(k, eigentuemerName, () => zeigeRepoSeite(box, k, h, "issues"), h.neuLaden)
    : reiter === "patches" ? patchReiter(k, h, () => zeigeRepoSeite(box, k, h, "patches"))
    : reiter === "mitwirkende" ? mitwirkendeReiter(k, h) : einstellungenReiter(k, h)));
  box.replaceChildren(...teile, leiste, inhalt);
}

/**
 * Raum des Repos (11.4c): bestätigt mit Namen und „Zum Raum“ – privat mit dem
 * Hinweis, dass nur Mitglieder es sehen. Ein unbestätigter Verweis steht als
 * solcher da: Der Eigentümer pflegt in dem Raum keine Repos.
 */
function raumZeile(k: RepoKarte, h: RepoSeiteHilfe): HTMLElement | undefined {
  if (!k.privatRaum && !k.repo?.raum) return undefined;
  const zeile = el("p", undefined, "repo-raum mono-sm");
  if (!k.privatRaum && !k.raumBestaetigt) {
    zeile.append(el("span", t("repo.raumUnbestaetigt"), "muted"));
    return zeile;
  }
  const name = k.raumName || (k.privatRaum ? t("repo.privaterRaum") : k.repo?.raum ?? "");
  zeile.append(el("span", t(k.privatRaum ? "repo.imPrivatenRaum" : "repo.imRaum", { name })),
    knopf(t("repo.zumRaum"), "ghost mini repo-zum-raum", h.zumRaum));
  return zeile;
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
    // Seit 8.9b verschlüsselt, der Schlüssel steht öffentlich in der Referenz (holeBundle, seit C.3c1 geteilt mit „Code“)
    const bytes = await holeBundle(k.bundle);
    if (!bytes) {
      toast(t("agent.bundleKaputt"), true);
      return;
    }
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

function patchReiter(k: RepoKarte, h: RepoSeiteHilfe, neu: () => void): HTMLElement[] {
  const repo = k.repo;
  if (repo && vorschau?.schluessel === k.schluessel) return vorschauSeite(repo, h, neu, k.privatRaum);
  const offen = k.zeilen.find((z) => z.patch.id === offenerPatch);
  if (offen) {
    return zeigePatch({
      betreff: offen.patch.betreff, commit: offen.patch.commit, text: offen.patch.text,
      von: eigentuemerName(offen.patch.autor), zeit: offen.patch.zeit, marke: statusMarke(offen.status), aktionen: aktionsKnoepfe(offen, k, h),
      status: statusAngaben(offen),
      zurueck: { text: t("repo.allePatches"), tun: () => {
        offenerPatch = null;
        neu();
        document.querySelector<HTMLElement>(`[data-patch="${CSS.escape(offen.patch.id)}"]`)?.focus();
      } },
    });
  }
  offenerPatch = null;
  const teile: HTMLElement[] = [];
  if (repo) {
    // Datei wählen → Vorschau mit dem Diff-Leser → senden
    const datei = el("input", undefined, "repo-patch-datei");
    datei.type = "file";
    datei.accept = ".patch,.diff,.txt,text/plain"; // kein UI-Text
    datei.hidden = true;
    datei.addEventListener("change", () => {
      const f = datei.files?.[0];
      datei.value = "";
      if (f) void zeigeVorschau(f, k, neu);
    });
    teile.push(knopf(t("repo.patchSenden"), "ghost mini repo-patch-senden", () => datei.click()), datei);
  }
  const zahl = (f: PatchFilter) => k.zeilen.filter((z) => filterVon(z.status) === f).length;
  const liste = el("div", undefined, "repo-patches");
  const zeige = (f: PatchFilter) => {
    letzterFilter = f;
    filter.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === f)));
    const zeilen = k.zeilen.filter((z) => filterVon(z.status) === f);
    liste.replaceChildren(...(zeilen.length ? zeilen.map((z) => patchZeile(z, k, h, neu)) : [el("p", t("repo.keinePatches"), "mono-sm muted")]));
  };
  const filter = el("div", undefined, "repo-filter");
  for (const f of ["offen", "angenommen", "geschlossen"] as const) {
    const b = knopf(t("repo.filterZahl", { status: t(STATUS_TEXT[f]), n: zahl(f) }), "ghost mini repo-knopf", () => zeige(f));
    b.dataset.filter = f;
    filter.append(b);
  }
  teile.push(filter, liste);
  zeige(letzterFilter);
  return teile;
}

function statusMarke(s: PatchStatus): HTMLElement {
  const marke = el("span", t(STATUS_TEXT[s]));
  marke.className = `repo-status status-${s}`;
  return marke;
}

const aktionsKnoepfe = (z: PatchZeile, k: RepoKarte, h: RepoSeiteHilfe): HTMLButtonElement[] =>
  z.aktionen.map((a) => knopf(t(AKTION_TEXT[a]), a === "annehmen" ? "mini repo-knopf" : "ghost mini repo-knopf", () => void setzeStatus(k, z.patch, a, h)));

function patchZeile(z: PatchZeile, k: RepoKarte, h: RepoSeiteHilfe, neu: () => void): HTMLElement {
  const zeile = el("div", undefined, "repo-patch");
  const links = el("div", undefined, "repo-patch-text");
  const betreff = knopf(z.patch.betreff, "repo-patch-betreff", () => {
    offenerPatch = z.patch.id;
    neu();
    document.querySelector<HTMLElement>(".patch-zurueck")?.focus();
  });
  betreff.dataset.patch = z.patch.id;
  links.append(betreff, el("div", t("repo.patchVon", { name: eigentuemerName(z.patch.autor), datum: datum(z.patch.zeit) }), "mono-sm muted"));
  const rechts = el("div", undefined, "repo-patch-status");
  rechts.append(statusMarke(z.status), ...aktionsKnoepfe(z, k, h));
  zeile.append(links, rechts);
  return zeile;
}

/** Gewählte Datei prüfen (Kopf nach `lesePatchText()`), dann als Vorschau zeigen – gesendet wird erst dort. */
async function zeigeVorschau(datei: File, k: RepoKarte, neu: () => void): Promise<void> {
  try {
    const text = await datei.text();
    const { lesePatchText } = await import("@freedomstack/protocol");
    vorschau = { schluessel: k.schluessel, text, ...lesePatchText(text) };
    neu();
    document.querySelector<HTMLElement>(".patch-senden")?.focus();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

function vorschauSeite(repo: GelesenesRepo, h: RepoSeiteHilfe, neu: () => void, gruppe?: string): HTMLElement[] {
  const v = vorschau!;
  const verwerfen = () => {
    vorschau = null;
    neu();
  };
  const senden = knopf(t("repo.patchSenden"), "mini repo-knopf patch-senden", () => void (async () => {
    senden.disabled = true;
    if (await h.patchSenden(repo, v.text, gruppe)) {
      vorschau = null;
      await h.neuLaden();
    } else senden.disabled = false;
  })());
  return zeigePatch({
    betreff: v.betreff, commit: v.commit, text: v.text, hinweis: t(gruppe ? "repo.patchFrageRaum" : "repo.patchFrage", { betreff: v.betreff, repo: repo.name }),
    marke: el("span", t("repo.vorschau"), "repo-status status-entwurf"),
    aktionen: [senden, knopf(t("repo.verwerfen"), "ghost mini repo-knopf", verwerfen)],
    zurueck: { text: t("repo.allePatches"), tun: verwerfen },
  });
}

/**
 * Status setzen (seit C.3b2 für alle Aktionen ein Dialog): annehmen mit
 * optionalem Commit, dazu immer eine Begründung (`notiz`, optional);
 * schließen und zurückziehen rot. Öffentlich und signiert.
 */
async function setzeStatus(k: RepoKarte, patch: GelesenerPatch, aktion: PatchAktion, h: RepoSeiteHilfe): Promise<void> {
  if (!state.keypair || !k.repo) return;
  const annehmen = aktion === "annehmen";
  const w = await dialog({
    titel: annehmen ? t("repo.annehmenTitel", { betreff: patch.betreff }) : t("repo.aktionTitel", { aktion: t(AKTION_TEXT[aktion]), betreff: patch.betreff }),
    text: t(k.privatRaum ? "repo.statusImRaum" : "repo.statusOeffentlich"), ok: t(AKTION_TEXT[aktion]),
    gefahr: aktion === "schliessen" || aktion === "zurueckziehen",
    felder: [
      ...(annehmen ? [{ art: "text" as const, name: "commit", label: t("repo.welcherCommit"), mono: true }] : []),
      { art: "textarea", name: "notiz", label: t("repo.begruendung") },
    ],
    pruefe: (w) => { const c = String(w.commit ?? "").trim().toLowerCase(); return !c || SHA1.test(c) ? null : t("repo.keinSha1"); },
  });
  if (!w) return;
  const c = String(w.commit ?? "").trim().toLowerCase();
  const notiz = String(w.notiz ?? "").trim();
  try {
    const { baueStatus, raumRepoStatus } = await import("@freedomstack/protocol");
    const angaben = { patch, status: AKTION_STATUS[aktion], eigentuemer: k.repo.eigentuemer, ...(c ? { commits: [c] } : {}), ...(notiz ? { notiz } : {}) };
    // Privater Raum (11.4b2): nur in die Gruppe
    if (k.privatRaum) await sendeInRaum(k.privatRaum, raumRepoStatus(k.privatRaum, angaben));
    else await (await ensurePool()).publish(await signiere(baueStatus(angaben, state.keypair.pk)));
    toast(t(AKTION_MELDUNG[aktion]));
    await h.neuLaden();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

/** Wer den geltenden Status gesetzt hat, wann, mit welchen Commits und welcher Begründung – nur Text. */
function statusAngaben(z: PatchZeile): HTMLElement | undefined {
  if (!z.statusVon) return undefined;
  const box = el("div", undefined, "patch-status-info");
  box.append(el("div", t("repo.statusVon", { status: t(STATUS_TEXT[z.status]), name: eigentuemerName(z.statusVon), datum: datum(z.statusZeit ?? 0) }), "mono-sm muted"));
  if (z.commits?.length) box.append(el("div", t("repo.alsCommits", { commits: z.commits.map((x) => x.slice(0, 7)).join(", ") }), "mono-sm"));
  if (z.notiz) box.append(el("p", z.notiz, "patch-notiz"));
  return box;
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

/** Öffentlicher Raum (11.4a): nur Räume, in denen ich Repos pflegen darf; ein gesetzter bleibt wählbar. */
function einstellungRaum(form: HTMLFormElement, r: GelesenesRepo | undefined, h: RepoSeiteHilfe): void {
  const raum = el("select");
  raum.id = "repo-feld-raum";
  raum.name = "raum";
  const option = (wert: string, text: string) => {
    const o = el("option", text);
    o.value = wert;
    return o;
  };
  raum.append(option("", t("repo.keinRaum")), ...(r?.raum ? [option(r.raum, t("repo.bisherigerRaum"))] : []));
  raum.value = r?.raum ?? "";
  const raumLabel = el("label", t("repo.feldRaum"));
  raumLabel.htmlFor = raum.id;
  form.append(raumLabel, raum, el("p", t("repo.raumHinweis"), "mono-sm muted"));
  void h.raeume().then((liste) => {
    for (const x of liste) {
      const vorhanden = [...raum.options].find((o) => o.value === x.adresse);
      if (vorhanden) vorhanden.textContent = x.name;
      else raum.append(option(x.adresse, x.name));
    }
  }).catch(() => undefined);
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
  if (!k.privatRaum) einstellungRaum(form, r, h);
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
    void h.hochladen(f, k.id, k.privatRaum).finally(() => { b.disabled = false; });
  });
  hoch.append(el("h3", t("repo.neueVersion")), el("p", t(k.privatRaum ? "repo.neueVersionTextRaum" : "repo.neueVersionText"), "mono-sm muted"), b, datei);
  return [form, hoch];
}

async function speichereEinstellungen(k: RepoKarte, form: HTMLFormElement, fehler: HTMLElement, h: RepoSeiteHilfe): Promise<void> {
  if (!state.keypair) return;
  const wert = (name: keyof EinstellungFelder) => (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
  fehler.textContent = "";
  try {
    const { baueRepoAnkuendigung, raumRepoAnkuendigung } = await import("@freedomstack/protocol");
    const angaben = ankuendigungAusFeldern(k.id, {
      name: wert("name"), beschreibung: wert("beschreibung"), klon: wert("klon"), web: wert("web"),
      maintainer: wert("maintainer"), ersterCommit: wert("ersterCommit"), raum: wert("raum"),
    });
    const ev = baueRepoAnkuendigung(angaben, state.keypair.pk);
    if (!await bestaetige({ titel: t("repo.speichern"), text: t(k.privatRaum ? "repo.speichernFrageRaum" : "repo.speichernFrage"), ok: t("repo.speichern") })) return;
    // Privater Raum (11.4b2): nur in die Gruppe
    if (k.privatRaum) await sendeInRaum(k.privatRaum, raumRepoAnkuendigung(k.privatRaum, angaben));
    else await (await ensurePool()).publish(await signiere(ev));
    toast(t("repo.angekuendigt", { id: k.id }));
    await h.neuLaden();
  } catch (e) {
    fehler.textContent = fehlerText(e);
  }
}
