/**
 * Reiter „Code“ und „Commits“ (Schritte C.3c1/C.3c2, E4): das Bundle eines
 * Repos in der App lesen (`git-bundle.ts`) – letzter Commit, Ordner zum
 * Öffnen, Dateien als Text, README; die Commits entlang der ersten Eltern.
 * Ohne Bundle zeigt „Commits“ die angenommenen Patches mit ihren Commits.
 *
 * Geladen wird erst auf Knopfdruck – das Bundle kommt verschlüsselt aus dem
 * Speichernetz; gelesen wird nur im Speicher. Nur DOM und `textContent`:
 * Namen, Nachrichten und die README kommen von Fremden.
 */
import type { NostrEvent } from "@freedomstack/protocol";
import {
  BundleFehler, type BundleFehlerArt, type CodeTreffer, type DateiAenderung, type GelesenesBundle, SUCHE_GRENZEN, alsText, commitsAb, dateiVerlauf,
  kopfCommit, leseBundle, sucheImCode, unterPfad, zweigeUndTags,
} from "../../git-bundle.js";
import { gebietsschema, t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import { loesePfad } from "../../markdown.js";
import { markdownDom } from "../markdown-ui.js";
import { ensurePool } from "../state.js";
import { toast } from "../ui.js";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, klasse?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

/** Bundle aus dem Speichernetz holen; seit 8.9b verschlüsselt, der Schlüssel steht in der Referenz (ältere sind Klartext). */
export async function holeBundle(ref: NostrEvent): Promise<Uint8Array | null> {
  const { downloadBlob, oeffneAnhang } = await import("../../blob-client.js");
  const { parseGitRepoRef } = await import("@freedomstack/protocol");
  const r = parseGitRepoRef(ref);
  const res = await downloadBlob(r.blobId, (await ensurePool()) as never);
  if (!res) return null;
  return r.schluessel ? oeffneAnhang(res.bytes, r.schluessel) : res.bytes;
}

/**
 * Woher das Bundle kommt (B-2): aus dem Speichernetz über die Referenz
 * (`netzQuelle()`) oder vom Gerät (Repo nur auf diesem Gerät). `id` hält
 * das Gelesene und die Wahl im Speicher auseinander.
 */
export interface BundleQuelle {
  id: string;
  hole: () => Promise<Uint8Array | null>;
  /** Text über „Code laden“ (Schlüssel) – woher das Bundle kommt. */
  hinweis?: string;
}
export const netzQuelle = (ref: NostrEvent): BundleQuelle => ({ id: ref.id, hole: () => holeBundle(ref) });

const FEHLER: Record<BundleFehlerArt, string> = {
  format: "repo.bundleFormat", gross: "repo.bundleGross", objekte: "repo.bundleObjekte", entpacken: "repo.bundleEntpacken",
  delta: "repo.bundleDelta", tiefe: "repo.bundleTiefe", pruefsumme: "repo.bundlePruefsumme", kaputt: "repo.bundleKaputt",
};

/** Gelesene Bundles je Referenz (Event-Id) und wo man darin steht – nur im Speicher, höchstens drei. */
const gelesen = new Map<string, GelesenesBundle>();
const ort = new Map<string, string[]>();
/** Markdown-Dateien, die gerade als Quelltext statt als Vorschau zu sehen sind (C-20b) – nur im Speicher. */
const alsQuelltext = new Set<string>();
/** Gewählter Zweig oder Tag je Bundle (C-20c), als „zweig:<name>“ bzw. „tag:<name>“ – nur im Speicher. */
const refWahl = new Map<string, string>();
/** Dateien mit offenem Verlauf und die Suche je Bundle (C-20d) – nur im Speicher. */
const verlaufOffen = new Set<string>();
const suchen = new Map<string, { text: string; commit: string; ergebnis: { treffer: CodeTreffer[]; mehr: boolean } }>();
const COMMITS_MAX = 100;
const README = /^readme(\.(md|markdown|txt))?$/i;
const MARKDOWN = /\.(md|markdown)$/i;
const TEXT_MAX = 100_000;

const datumVon = (s: number) => new Date(s * 1000).toLocaleDateString(gebietsschema(), { day: "numeric", month: "short", year: "numeric" });

function knopf(text: string, klasse: string, tun: () => void): HTMLButtonElement {
  const b = el("button", text, klasse);
  b.type = "button";
  b.addEventListener("click", tun);
  return b;
}

/** Hinweis und „Code laden“: holt das Bundle erst auf Knopfdruck, liest es und zeichnet neu. */
function ladeKnopf(bundle: BundleQuelle, neu: () => void): HTMLElement[] {
  const hinweis = el("p", t(bundle.hinweis ?? "repo.codeLadenText"), "mono-sm muted");
  const fehler = el("p", undefined, "repo-fehler");
  fehler.setAttribute("role", "alert");
  const laden = el("button", t("repo.codeLaden"), "ghost mini repo-knopf code-laden");
  laden.type = "button";
  laden.addEventListener("click", () => void (async () => {
    laden.disabled = true;
    fehler.textContent = "";
    try {
      const bytes = await bundle.hole();
      if (!bytes) {
        fehler.textContent = t("agent.bundleKaputt");
        return;
      }
      const gelesenesBundle = await leseBundle(bytes);
      if (gelesen.size >= 3) {
        const alt = gelesen.keys().next().value!;
        gelesen.delete(alt);
        ort.delete(alt);
        refWahl.delete(alt);
        suchen.delete(alt);
        for (const k of verlaufOffen) if (k.startsWith(`${alt}:`)) verlaufOffen.delete(k);
      }
      gelesen.set(bundle.id, gelesenesBundle);
      neu();
    } catch (e) {
      fehler.textContent = e instanceof BundleFehler ? t(FEHLER[e.art]) : fehlerText(e);
    } finally {
      laden.disabled = false;
    }
  })());
  return [hinweis, laden, fehler];
}

/**
 * Welcher Commit gilt (C-20c): der gewählte Zweig oder Tag, sonst HEAD. Dazu
 * der Schlüssel der Wahl – ohne Wahl der Zweig, auf dem HEAD steht (main/master zuerst).
 */
function stand(b: GelesenesBundle, id: string): { commit: string | undefined; wahl: string | undefined } {
  const refs = zweigeUndTags(b);
  const schluessel = (r: { art: string; name: string }) => `${r.art}:${r.name}`; // kein UI-Text
  const gewaehlt = refs.find((r) => schluessel(r) === refWahl.get(id));
  if (gewaehlt) return { commit: gewaehlt.commit, wahl: schluessel(gewaehlt) };
  const kopf = kopfCommit(b);
  const aufKopf = refs.filter((r) => r.art === "zweig" && r.commit === kopf);
  const standard = aufKopf.find((r) => r.name === "main" || r.name === "master") ?? aufKopf[0];
  return { commit: kopf, wahl: standard ? schluessel(standard) : undefined };
}

/** Auswahl „Zweig oder Tag“ (C-20c) – nur, wenn das Bundle mehr als einen Stand kennt. */
function refAuswahl(b: GelesenesBundle, id: string, neu: () => void): HTMLElement[] {
  const refs = zweigeUndTags(b);
  if (refs.length < 2) return [];
  const zeile = el("div", undefined, "code-ref mono-sm");
  const wahl = el("select", undefined, "code-ref-wahl");
  wahl.id = "code-ref-wahl";
  const label = el("label", t("repo.refWahl"));
  label.htmlFor = wahl.id;
  const jetzt = stand(b, id).wahl;
  if (!jetzt) wahl.append(el("option", t("repo.refKopf")));
  for (const art of ["zweig", "tag"] as const) {
    const gruppe = el("optgroup");
    gruppe.label = t(art === "zweig" ? "repo.zweige" : "repo.tags");
    for (const r of refs.filter((x) => x.art === art)) {
      const o = el("option", r.name);
      o.value = `${r.art}:${r.name}`; // kein UI-Text
      o.selected = o.value === jetzt;
      gruppe.append(o);
    }
    if (gruppe.children.length) wahl.append(gruppe);
  }
  wahl.addEventListener("change", () => {
    refWahl.set(id, wahl.value);
    neu();
    document.getElementById("code-ref-wahl")?.focus();
  });
  const zweige = refs.filter((r) => r.art === "zweig").length;
  zeile.append(label, wahl, el("span", t("repo.refZahl", { zweige, tags: refs.length - zweige }), "muted"));
  return [zeile];
}

export function codeReiter(bundle: BundleQuelle | undefined, name: string, neu: () => void): HTMLElement[] {
  if (!bundle) return [el("p", t("repo.codeOhneBundle"), "mono-sm muted")];
  const b = gelesen.get(bundle.id);
  return b ? zeigeCode(b, bundle.id, name, neu) : ladeKnopf(bundle, neu);
}

function zeigeCode(b: GelesenesBundle, id: string, name: string, neu: () => void): HTMLElement[] {
  const kopf = stand(b, id).commit;
  if (!kopf) return [el("p", t("repo.keinKopf"), "mono-sm muted")];
  const [c] = commitsAb(b, kopf, 1);
  const pfad = ort.get(id) ?? [];
  const geh = (neuerPfad: string[]) => {
    ort.set(id, neuerPfad);
    neu();
    document.querySelector<HTMLElement>(".code-pfad > :last-child")?.focus();
  };
  // Verweis aus Markdown (C-20b): relativ zum Ordner der Datei, nie aus dem Repo hinaus
  const oeffne = (ordner: string[]) => (ziel: string) => {
    const neuerPfad = loesePfad(ordner, ziel);
    if (neuerPfad) geh(neuerPfad);
    else toast(t("repo.pfadFehlt"), true);
  };
  const teile: HTMLElement[] = [...refAuswahl(b, id, neu), el("div", t("repo.commitZeile", { betreff: c!.betreff, autor: c!.autor, datum: datumVon(c!.zeit), sha: kopf.slice(0, 7) }), "code-commit mono-sm")];
  // Pfad: Name des Repos, dann je Ordner ein Knopf; der letzte Teil ist Text (mit Fokus nach dem Wechsel)
  // Kein <nav>: dessen Stile gehören der Leiste der App
  const kruemel = el("div", undefined, "code-pfad mono-sm");
  kruemel.setAttribute("role", "navigation");
  kruemel.setAttribute("aria-label", t("repo.pfadAria"));
  const teilePfad = [name, ...pfad];
  teilePfad.forEach((teil, n) => {
    if (n) kruemel.append(el("span", " / ", "muted"));
    if (n === teilePfad.length - 1) {
      const hier = el("span", teil, "code-hier");
      hier.tabIndex = -1;
      kruemel.append(hier);
    } else kruemel.append(knopf(teil, "code-pfad-knopf", () => geh(pfad.slice(0, n))));
  });
  teile.push(kruemel);
  const an = unterPfad(b, c!.baum, pfad);
  if (!an) return [...teile, el("p", t("repo.pfadFehlt"), "mono-sm muted")];
  if (an.art === "ordner") {
    teile.push(...suchFeld(b, id, c!.baum, kopf, geh, neu));
    const liste = el("ul", undefined, "code-dateien");
    for (const e of an.eintraege) {
      const li = el("li", undefined, `code-${e.art} mono`);
      if (e.art === "modul") li.append(el("span", t("repo.submodul", { name: e.name, sha: e.sha.slice(0, 7) })));
      else li.append(knopf(e.art === "ordner" ? `${e.name}/` : e.name, "code-eintrag", () => geh([...pfad, e.name])));
      liste.append(li);
    }
    teile.push(liste);
    const readme = an.eintraege.find((e) => e.art === "datei" && README.test(e.name));
    const text = readme ? unterPfad(b, c!.baum, [...pfad, readme.name]) : null;
    const inhalt = text && text.art === "datei" ? alsText(text.daten) : null;
    // README.md wie bei GitHub als Markdown (C-20a) – nur DOM, Bilder nie geladen; sonst als Text
    if (readme && inhalt !== null) {
      teile.push(el("h4", readme.name, "code-readme-titel"),
        MARKDOWN.test(readme.name) ? markdownDom(inhalt.slice(0, TEXT_MAX), "code-readme", { oeffne: oeffne(pfad) }) : el("pre", inhalt.slice(0, TEXT_MAX), "code-readme"));
    }
    return teile;
  }
  if (an.art === "modul") return [...teile, el("p", t("repo.submodul", { name: pfad.at(-1)!, sha: an.sha.slice(0, 7) }), "mono-sm muted")];
  teile.push(el("div", t("repo.dateiGroesse", { bytes: an.daten.length.toLocaleString(gebietsschema()) }), "mono-sm muted"));
  // Verlauf der Datei (C-20d): welche Commits sie anlegten, änderten oder löschten – auf Knopfdruck
  const vSchluessel = `${id}:${pfad.join("/")}`; // kein UI-Text
  const vOffen = verlaufOffen.has(vSchluessel);
  const vKnopf = knopf(t("repo.verlauf"), "ghost mini repo-knopf code-verlauf-knopf", () => {
    if (vOffen) verlaufOffen.delete(vSchluessel);
    else verlaufOffen.add(vSchluessel);
    neu();
    document.querySelector<HTMLElement>(".code-verlauf-knopf")?.focus();
  });
  vKnopf.setAttribute("aria-expanded", String(vOffen));
  teile.push(vKnopf);
  if (vOffen) teile.push(...verlaufListe(b, kopf, pfad));
  const text = alsText(an.daten);
  if (an.art === "link") teile.push(el("p", t("repo.linkZiel", { ziel: text ?? "?" }), "mono-sm"));
  else if (text === null) teile.push(el("p", t("repo.dateiBinaer"), "mono-sm muted"));
  else {
    if (text.length > TEXT_MAX) teile.push(el("p", t("repo.dateiGekuerzt"), "mono-sm muted"));
    // Markdown-Datei (C-20b): Vorschau wie bei GitHub, auf Wunsch der Quelltext
    const schluessel = `${id}:${pfad.join("/")}`; // kein UI-Text
    const vorschau = MARKDOWN.test(pfad.at(-1)!) && !alsQuelltext.has(schluessel);
    if (MARKDOWN.test(pfad.at(-1)!)) {
      const wahl = el("div", undefined, "repo-filter code-ansicht");
      for (const [quelltext, beschriftung] of [[false, "repo.mdVorschau"], [true, "repo.mdQuelltext"]] as const) {
        const b = knopf(t(beschriftung), "ghost mini repo-knopf", () => {
          if (quelltext) alsQuelltext.add(schluessel);
          else alsQuelltext.delete(schluessel);
          neu();
          document.querySelector<HTMLElement>(`.code-ansicht [aria-pressed="true"]`)?.focus();
        });
        b.setAttribute("aria-pressed", String(quelltext !== vorschau));
        wahl.append(b);
      }
      teile.push(wahl);
    }
    teile.push(vorschau ? markdownDom(text.slice(0, TEXT_MAX), "code-md", { oeffne: oeffne(pfad.slice(0, -1)) }) : el("pre", text.slice(0, TEXT_MAX), "code-datei"));
  }
  return teile;
}

const AENDERUNG: Record<DateiAenderung, string> = { neu: "repo.aenderungNeu", geaendert: "repo.aenderungGeaendert", geloescht: "repo.aenderungGeloescht" };

/** Verlauf einer Datei (C-20d): je Commit Betreff, Autor, Datum, Kennung und was mit der Datei geschah. */
function verlaufListe(b: GelesenesBundle, commit: string, pfad: string[]): HTMLElement[] {
  const { eintraege, abgeschnitten } = dateiVerlauf(b, commit, pfad, COMMITS_MAX);
  if (!eintraege.length) return [el("p", t(abgeschnitten ? "repo.verlaufAbgeschnitten" : "repo.verlaufLeer"), "mono-sm muted")];
  const liste = el("ol", undefined, "code-verlauf");
  for (const v of eintraege) {
    const li = el("li", undefined, "code-verlauf-zeile");
    li.append(el("span", v.betreff, "code-commit-betreff"), el("span", t("repo.commitMeta", { autor: v.autor, datum: datumVon(v.zeit), sha: v.sha.slice(0, 7) }), "mono-sm muted"),
      el("span", t(AENDERUNG[v.art]), `repo-status code-aenderung-${v.art}`)); // kein UI-Text
    liste.append(li);
  }
  return abgeschnitten ? [liste, el("p", t("repo.verlaufAbgeschnitten"), "mono-sm muted")] : [liste];
}

/** Suche im Code (C-20d): Feld und Treffer – gesucht wird im ganzen Stand, nur im Speicher; ein Treffer öffnet die Datei. */
function suchFeld(b: GelesenesBundle, id: string, baum: string, commit: string, geh: (p: string[]) => void, neu: () => void): HTMLElement[] {
  const form = el("form", undefined, "code-suche");
  form.setAttribute("role", "search");
  const feld = el("input", undefined, "code-suche-feld");
  feld.type = "search";
  feld.id = "code-suche";
  feld.placeholder = t("repo.sucheLabel");
  feld.setAttribute("aria-label", t("repo.sucheLabel"));
  feld.value = suchen.get(id)?.text ?? "";
  const los = el("button", t("repo.sucheKnopf"), "ghost mini repo-knopf");
  los.type = "submit";
  form.append(feld, los);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = feld.value.trim();
    if (text) suchen.set(id, { text, commit: "", ergebnis: { treffer: [], mehr: false } });
    else suchen.delete(id);
    neu();
    document.getElementById("code-suche")?.focus();
  });
  const s = suchen.get(id);
  if (!s) return [form];
  if (s.text.length < 2) return [form, el("p", t("repo.sucheKurz"), "mono-sm muted")];
  // Neu suchen nur, wenn sich der Stand änderte (anderer Zweig oder Tag)
  if (s.commit !== commit) {
    s.ergebnis = sucheImCode(b, baum, s.text);
    s.commit = commit;
  }
  const { treffer, mehr } = s.ergebnis;
  const zahl = el("p", treffer.length ? t("repo.sucheTreffer", { n: treffer.length }) : t("repo.sucheKeine", { text: s.text }), "mono-sm muted code-suche-zahl");
  zahl.setAttribute("role", "status");
  const teile: HTMLElement[] = [form, zahl];
  if (treffer.length) {
    const liste = el("ul", undefined, "code-treffer");
    for (const x of treffer) {
      const li = el("li");
      li.append(knopf(x.nr ? t("repo.sucheOrt", { pfad: x.pfad.join("/"), nr: x.nr }) : x.pfad.join("/"), "code-treffer-ort mono-sm", () => geh(x.pfad)),
        el("span", x.nr ? x.zeile : t("repo.sucheDateiname"), x.nr ? "code-treffer-zeile mono-sm" : "mono-sm muted"));
      liste.append(li);
    }
    teile.push(liste);
  }
  if (mehr) teile.push(el("p", t("repo.sucheMehr", { n: SUCHE_GRENZEN.treffer }), "mono-sm muted"));
  return teile;
}

/**
 * Reiter „Commits“ (seit C.3c2): mit gelesenem Bundle die Commits ab HEAD
 * entlang der ersten Eltern (höchstens 100), je Commit die ganze Nachricht
 * zum Aufklappen. Ohne Bundle die angenommenen Patches mit ihren Commits.
 */
export function commitsReiter(bundle: BundleQuelle | undefined, angenommen: Array<{ betreff: string; commits: string[] }>, neu: () => void): HTMLElement[] {
  if (!bundle) {
    const mit = angenommen.filter((a) => a.commits.length);
    if (!mit.length) return [el("p", t("repo.keineCommits"), "mono-sm muted")];
    const liste = el("ul", undefined, "code-commits");
    for (const a of mit) liste.append(el("li", t("repo.patchAlsCommit", { betreff: a.betreff, commits: a.commits.map((x) => x.slice(0, 7)).join(", ") }), "mono-sm"));
    return [el("p", t("repo.commitsOhneBundle"), "mono-sm muted"), liste];
  }
  const b = gelesen.get(bundle.id);
  if (!b) return ladeKnopf(bundle, neu);
  const kopf = stand(b, bundle.id).commit;
  if (!kopf) return [el("p", t("repo.keinKopf"), "mono-sm muted")];
  const commits = commitsAb(b, kopf, COMMITS_MAX + 1);
  const liste = el("ol", undefined, "code-commits");
  for (const c of commits.slice(0, COMMITS_MAX)) {
    const li = el("li");
    const auf = el("details");
    const zeile = el("summary", undefined, "code-commit-zeile");
    zeile.append(el("span", c.betreff, "code-commit-betreff"), el("span", t("repo.commitMeta", { autor: c.autor, datum: datumVon(c.zeit), sha: c.sha.slice(0, 7) }), "mono-sm muted"));
    auf.append(zeile, el("pre", c.nachricht, "code-commit-nachricht"));
    li.append(auf);
    liste.append(li);
  }
  const teile: HTMLElement[] = [...refAuswahl(b, bundle.id, neu), liste];
  if (commits.length > COMMITS_MAX) teile.push(el("p", t("repo.commitsMehr", { n: COMMITS_MAX }), "mono-sm muted"));
  return teile;
}
