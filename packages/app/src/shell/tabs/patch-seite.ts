/**
 * Patch-Seite (Schritt C.3b1): ein Patch wie ein Pull Request – Betreff,
 * Status, Autor, Zeit, Commit, Nachricht und die Änderungen aus dem
 * Diff-Leser (`diff-ansicht.ts`): Dateiliste mit +/−, Abschnitte, Zeilennummern,
 * hinzugefügt und entfernt farbig und mit Zeichen, nicht nur mit Farbe.
 * Dieselbe Ansicht dient als Vorschau vor dem Senden.
 *
 * Nur DOM und `textContent` – Betreff, Nachricht und Diff kommen von Fremden.
 */
import { type DateiArt, type DiffDatei, type DiffZeile, leseDiff } from "../../diff-ansicht.js";
import { gebietsschema, t } from "../../i18n.js";
import { toast } from "../ui.js";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, klasse?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

export function patchKnopf(text: string, klasse: string, tun: () => void): HTMLButtonElement {
  const b = el("button", text);
  b.className = klasse;
  b.type = "button";
  b.addEventListener("click", tun);
  return b;
}

export interface PatchAnsicht {
  betreff: string;
  commit: string;
  /** Text aus `git format-patch`. */
  text: string;
  /** Name des Autors (Nostr-Schlüssel), fehlt in der Vorschau. */
  von?: string;
  zeit?: number;
  /** Status-Marke, Knöpfe für Aktionen, ein Hinweis darüber (Vorschau). */
  marke?: HTMLElement;
  /** Wer den Status setzte, Commits, Begründung (seit C.3b2). */
  status?: HTMLElement | undefined;
  aktionen: HTMLElement[];
  hinweis?: string;
  zurueck: { text: string; tun: () => void };
  /** Unter den Änderungen: die Diskussion (seit C-17c) – fehlt in der Vorschau. */
  unten?: HTMLElement[];
}

const ART_TEXT: Record<Exclude<DateiArt, "geaendert">, string> = { neu: "repo.dateiNeu", geloescht: "repo.dateiGeloescht", umbenannt: "repo.dateiUmbenannt" };
const ZEICHEN: Record<DiffZeile["art"], string> = { kontext: " ", neu: "+", weg: "−", hinweis: "\\" };

export function zeigePatch(p: PatchAnsicht): HTMLElement[] {
  const diff = leseDiff(p.text);
  const teile: HTMLElement[] = [patchKnopf(p.zurueck.text, "ghost mini patch-zurueck", p.zurueck.tun)];
  teile.push(el("h3", p.betreff, "patch-titel"));
  const meta = el("div", undefined, "patch-meta mono-sm muted");
  if (p.marke) meta.append(p.marke);
  const datum = p.zeit ? new Date(p.zeit * 1000).toLocaleDateString(gebietsschema(), { day: "numeric", month: "short", year: "numeric" }) : "";
  if (p.von) meta.append(el("span", t("repo.patchVon", { name: p.von, datum })));
  meta.append(el("span", t("repo.commitKurz", { sha: p.commit.slice(0, 7) })));
  if (diff.autor) meta.append(el("span", t("repo.autorLautPatch", { autor: diff.autor })));
  teile.push(meta);
  if (p.status) teile.push(p.status);
  if (p.hinweis) teile.push(el("p", p.hinweis, "patch-hinweis"));
  const aktionen = el("div", undefined, "patch-aktionen");
  aktionen.append(...p.aktionen, patchKnopf(t("repo.alsDatei"), "ghost mini repo-knopf", () => ladeAlsDatei(p)));
  teile.push(aktionen);
  if (diff.nachricht) teile.push(el("p", diff.nachricht, "patch-nachricht"));

  // Änderungen: Zusammenfassung, Dateiliste, je Datei die Abschnitte
  const kopf = el("h4", t("repo.aenderungen"), "patch-aenderungen");
  kopf.append(el("span", t("repo.aenderungenZahl", { dateien: diff.dateien.length, plus: diff.plus, minus: diff.minus }), "mono-sm muted"));
  teile.push(kopf);
  if (diff.gekuerzt) teile.push(el("p", t("repo.diffGekuerzt"), "mono-sm muted"));
  const bloecke = diff.dateien.map(dateiBlock);
  const liste = el("ul", undefined, "diff-dateien");
  diff.dateien.forEach((d, n) => {
    const li = el("li");
    li.append(patchKnopf(pfad(d), "diff-datei-link", () => {
      bloecke[n]!.scrollIntoView({ block: "start" });
      bloecke[n]!.focus();
    }), el("span", `+${d.plus}`, "diff-plus"), el("span", `−${d.minus}`, "diff-minus"));
    liste.append(li);
  });
  if (diff.dateien.length) teile.push(liste);
  teile.push(...bloecke, ...(p.unten ?? []));
  return teile;
}

const pfad = (d: DiffDatei): string => (d.alt !== d.neu ? `${d.alt} → ${d.neu}` : d.neu);

function dateiBlock(d: DiffDatei): HTMLElement {
  const block = el("section", undefined, "diff-datei");
  block.tabIndex = -1;
  const kopf = el("div", undefined, "diff-datei-kopf");
  kopf.append(el("span", pfad(d), "mono"));
  if (d.art !== "geaendert") kopf.append(el("span", t(ART_TEXT[d.art]), "msg-role"));
  kopf.append(el("span", `+${d.plus}`, "diff-plus"), el("span", `−${d.minus}`, "diff-minus"));
  block.append(kopf);
  if (d.binaer) block.append(el("p", t("repo.dateiBinaer"), "mono-sm muted"));
  for (const a of d.abschnitte) {
    block.append(el("div", a.kopf, "diff-abschnitt mono"));
    for (const z of a.zeilen) {
      const zeile = el("div");
      zeile.className = `diff-zeile diff-${z.art} mono`;
      zeile.append(el("span", z.alt === undefined ? "" : String(z.alt), "diff-nr"), el("span", z.neu === undefined ? "" : String(z.neu), "diff-nr"),
        el("span", ZEICHEN[z.art], "diff-zeichen"), el("span", z.text, "diff-text"));
      block.append(zeile);
    }
  }
  return block;
}

/** Der Text als Datei für `git am` – lokal erzeugt, nichts geht hinaus. */
function ladeAlsDatei(p: PatchAnsicht): void {
  const url = URL.createObjectURL(new Blob([p.text], { type: "text/x-diff" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${p.commit.slice(0, 7)}.patch`;
  a.click();
  URL.revokeObjectURL(url);
  toast(t("agent.bundleGeladen", { datei: a.download }));
}
