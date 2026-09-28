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
import { BundleFehler, type BundleFehlerArt, type GelesenesBundle, alsText, commitsAb, kopfCommit, leseBundle, unterPfad } from "../../git-bundle.js";
import { gebietsschema, t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import { ensurePool } from "../state.js";

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

const FEHLER: Record<BundleFehlerArt, string> = {
  format: "repo.bundleFormat", gross: "repo.bundleGross", objekte: "repo.bundleObjekte", entpacken: "repo.bundleEntpacken",
  delta: "repo.bundleDelta", tiefe: "repo.bundleTiefe", pruefsumme: "repo.bundlePruefsumme", kaputt: "repo.bundleKaputt",
};

/** Gelesene Bundles je Referenz (Event-Id) und wo man darin steht – nur im Speicher, höchstens drei. */
const gelesen = new Map<string, GelesenesBundle>();
const ort = new Map<string, string[]>();
const COMMITS_MAX = 100;
const README = /^readme(\.(md|markdown|txt))?$/i;
const TEXT_MAX = 100_000;

const datumVon = (s: number) => new Date(s * 1000).toLocaleDateString(gebietsschema(), { day: "numeric", month: "short", year: "numeric" });

function knopf(text: string, klasse: string, tun: () => void): HTMLButtonElement {
  const b = el("button", text, klasse);
  b.type = "button";
  b.addEventListener("click", tun);
  return b;
}

/** Hinweis und „Code laden“: holt das Bundle erst auf Knopfdruck, liest es und zeichnet neu. */
function ladeKnopf(bundle: NostrEvent, neu: () => void): HTMLElement[] {
  const hinweis = el("p", t("repo.codeLadenText"), "mono-sm muted");
  const fehler = el("p", undefined, "repo-fehler");
  fehler.setAttribute("role", "alert");
  const laden = el("button", t("repo.codeLaden"), "ghost mini repo-knopf code-laden");
  laden.type = "button";
  laden.addEventListener("click", () => void (async () => {
    laden.disabled = true;
    fehler.textContent = "";
    try {
      const bytes = await holeBundle(bundle);
      if (!bytes) {
        fehler.textContent = t("agent.bundleKaputt");
        return;
      }
      const gelesenesBundle = await leseBundle(bytes);
      if (gelesen.size >= 3) {
        const alt = gelesen.keys().next().value!;
        gelesen.delete(alt);
        ort.delete(alt);
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

export function codeReiter(bundle: NostrEvent | undefined, name: string, neu: () => void): HTMLElement[] {
  if (!bundle) return [el("p", t("repo.codeOhneBundle"), "mono-sm muted")];
  const b = gelesen.get(bundle.id);
  return b ? zeigeCode(b, bundle.id, name, neu) : ladeKnopf(bundle, neu);
}

function zeigeCode(b: GelesenesBundle, id: string, name: string, neu: () => void): HTMLElement[] {
  const kopf = kopfCommit(b);
  if (!kopf) return [el("p", t("repo.keinKopf"), "mono-sm muted")];
  const [c] = commitsAb(b, kopf, 1);
  const pfad = ort.get(id) ?? [];
  const geh = (neuerPfad: string[]) => {
    ort.set(id, neuerPfad);
    neu();
    document.querySelector<HTMLElement>(".code-pfad > :last-child")?.focus();
  };
  const teile: HTMLElement[] = [el("div", t("repo.commitZeile", { betreff: c!.betreff, autor: c!.autor, datum: datumVon(c!.zeit), sha: kopf.slice(0, 7) }), "code-commit mono-sm")];
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
    if (readme && inhalt !== null) teile.push(el("h4", readme.name, "code-readme-titel"), el("pre", inhalt.slice(0, TEXT_MAX), "code-readme"));
    return teile;
  }
  if (an.art === "modul") return [...teile, el("p", t("repo.submodul", { name: pfad.at(-1)!, sha: an.sha.slice(0, 7) }), "mono-sm muted")];
  teile.push(el("div", t("repo.dateiGroesse", { bytes: an.daten.length.toLocaleString(gebietsschema()) }), "mono-sm muted"));
  const text = alsText(an.daten);
  if (an.art === "link") teile.push(el("p", t("repo.linkZiel", { ziel: text ?? "?" }), "mono-sm"));
  else if (text === null) teile.push(el("p", t("repo.dateiBinaer"), "mono-sm muted"));
  else {
    if (text.length > TEXT_MAX) teile.push(el("p", t("repo.dateiGekuerzt"), "mono-sm muted"));
    teile.push(el("pre", text.slice(0, TEXT_MAX), "code-datei"));
  }
  return teile;
}

/**
 * Reiter „Commits“ (seit C.3c2): mit gelesenem Bundle die Commits ab HEAD
 * entlang der ersten Eltern (höchstens 100), je Commit die ganze Nachricht
 * zum Aufklappen. Ohne Bundle die angenommenen Patches mit ihren Commits.
 */
export function commitsReiter(bundle: NostrEvent | undefined, angenommen: Array<{ betreff: string; commits: string[] }>, neu: () => void): HTMLElement[] {
  if (!bundle) {
    const mit = angenommen.filter((a) => a.commits.length);
    if (!mit.length) return [el("p", t("repo.keineCommits"), "mono-sm muted")];
    const liste = el("ul", undefined, "code-commits");
    for (const a of mit) liste.append(el("li", t("repo.patchAlsCommit", { betreff: a.betreff, commits: a.commits.map((x) => x.slice(0, 7)).join(", ") }), "mono-sm"));
    return [el("p", t("repo.commitsOhneBundle"), "mono-sm muted"), liste];
  }
  const b = gelesen.get(bundle.id);
  if (!b) return ladeKnopf(bundle, neu);
  const kopf = kopfCommit(b);
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
  const teile: HTMLElement[] = [liste];
  if (commits.length > COMMITS_MAX) teile.push(el("p", t("repo.commitsMehr", { n: COMMITS_MAX }), "mono-sm muted"));
  return teile;
}
