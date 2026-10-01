/**
 * Reiter „Issues“ der Repo-Seite (Schritt C-17b, Sammlung C-17): Liste mit
 * offen / geschlossen, „Neues Issue“ und die Seite eines Issues mit seinen
 * Kommentaren – wie bei GitHub. Öffentlich und signiert (NIP-34, NIP-22); im
 * privaten Raum nur als innere Events der Gruppe (`sendeInRaum()`).
 *
 * Nur DOM und `textContent` – Titel, Texte, Labels und Kommentare kommen von
 * Fremden. Welches Issue offen ist, steht nur im Speicher (nie in der Adresse).
 */
import { gebietsschema, t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import { KIND_ISSUE, type IssueStatus } from "@freedomstack/protocol";
import { type IssueFilter, type IssueZeile, type RepoKarte, filtereIssues, issueLabels } from "../../repo-ansicht.js";
import { dialog } from "../dialog.js";
import { markdownDom } from "../markdown-ui.js";
import { sendeInRaum } from "../raum-repos.js";
import { ensurePool, signiere, state } from "../state.js";
import { toast } from "../ui.js";
import { diskussion } from "./diskussion.js";

/** Offenes Issue und gewählter Filter – nur im Speicher. */
let offenesIssue: string | null = null;
let letzterFilter: IssueFilter = "offen";
/** Gewähltes Label (C-20e) – nur im Speicher. */
let letztesLabel: string | null = null;
export const vergissIssue = (): void => {
  offenesIssue = null;
  letzterFilter = "offen";
  letztesLabel = null;
};

const ISSUE_STATUS_TEXT = { offen: "repo.issueOffen", erledigt: "repo.issueErledigt", geschlossen: "repo.issueGeschlossen" } as const;

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

const datum = (s: number) => new Date(s * 1000).toLocaleDateString(gebietsschema(), { day: "numeric", month: "short", year: "numeric" });

function statusMarke(z: IssueZeile): HTMLElement {
  return el("span", t(ISSUE_STATUS_TEXT[z.status]), `repo-status issue-status-${z.status}`); // kein UI-Text
}

/** Labels als Knöpfe (C-20e): ein Klick zeigt die Liste mit genau diesem Label – wie bei GitHub. */
function labels(z: IssueZeile, neu: () => void): HTMLElement[] {
  return z.issue.labels.map((l) => {
    const b = knopf(l, "msg-role issue-label issue-label-knopf", () => {
      letztesLabel = l;
      offenesIssue = null;
      neu();
      document.getElementById("issue-label-wahl")?.focus();
    });
    b.setAttribute("aria-label", t("repo.labelZeigen", { label: l }));
    return b;
  });
}

/**
 * Der Reiter: Liste oder – wenn eines offen ist – die Seite des Issues.
 * `name(pk)` zeigt Namen statt Schlüsseln, `neu()` zeichnet den Reiter neu.
 */
export function issuesReiter(k: RepoKarte, name: (pk: string) => string, neu: () => void, neuLaden: () => Promise<void>): HTMLElement[] {
  const zeilen = k.issues ?? [];
  const offen = zeilen.find((z) => z.issue.id === offenesIssue);
  if (offen) return issueSeite(offen, k, name, neuLaden, neu, () => {
    offenesIssue = null;
    neu();
    document.querySelector<HTMLElement>(`[data-issue="${CSS.escape(offen.issue.id)}"]`)?.focus();
  });
  offenesIssue = null;
  const teile: HTMLElement[] = [];
  if (k.repo && state.keypair) teile.push(knopf(t("repo.neuesIssue"), "ghost mini issue-neu", () => void neuesIssue(k, neuLaden)));
  const liste = el("div", undefined, "repo-patches issue-liste");
  const filter = el("div", undefined, "repo-filter");
  // Label-Filter (C-20e): nur Labels, die es hier gibt; die Zahlen offen/geschlossen folgen ihm
  const vorhanden = issueLabels(zeilen);
  if (letztesLabel && !vorhanden.some((x) => x.label === letztesLabel)) letztesLabel = null;
  const zeige = (f: IssueFilter) => {
    letzterFilter = f;
    filter.querySelectorAll<HTMLButtonElement>("button[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === f)));
    const gezeigt = filtereIssues(zeilen, f, letztesLabel);
    liste.replaceChildren(...(gezeigt.length ? gezeigt.map((z) => issueZeile(z, name, neu)) : [el("p", t("repo.keineIssues"), "mono-sm muted")]));
  };
  for (const f of ["offen", "geschlossen"] as const) {
    const b = knopf(t("repo.filterZahl", { status: t(f === "offen" ? "repo.issueOffen" : "repo.issueGeschlossen"), n: filtereIssues(zeilen, f, letztesLabel).length }),
      "ghost mini repo-knopf", () => zeige(f));
    b.dataset.filter = f;
    filter.append(b);
  }
  if (vorhanden.length) {
    const wahl = el("select", undefined, "issue-label-wahl");
    wahl.id = "issue-label-wahl";
    wahl.setAttribute("aria-label", t("repo.labelFilter"));
    const alle = el("option", t("repo.alleLabels"));
    alle.value = "";
    wahl.append(alle);
    for (const x of vorhanden) {
      const o = el("option", t("repo.labelZahl", { label: x.label, n: x.n }));
      o.value = x.label;
      o.selected = x.label === letztesLabel;
      wahl.append(o);
    }
    wahl.addEventListener("change", () => {
      letztesLabel = wahl.value || null;
      neu();
      document.getElementById("issue-label-wahl")?.focus();
    });
    filter.append(wahl);
  }
  teile.push(filter, liste);
  zeige(letzterFilter);
  return teile;
}

function issueZeile(z: IssueZeile, name: (pk: string) => string, neu: () => void): HTMLElement {
  const zeile = el("div", undefined, "repo-patch issue-zeile");
  const links = el("div", undefined, "repo-patch-text");
  const titel = knopf(z.issue.betreff, "repo-patch-betreff issue-betreff", () => {
    offenesIssue = z.issue.id;
    neu();
    document.querySelector<HTMLElement>(".issue-zurueck")?.focus();
  });
  titel.dataset.issue = z.issue.id;
  const meta = el("div", t("repo.patchVon", { name: name(z.issue.autor), datum: datum(z.issue.zeit) }), "mono-sm muted");
  if (z.kommentare.length) meta.append(el("span", ` · ${t("repo.kommentareZahl", { n: z.kommentare.length })}`));
  links.append(titel, meta);
  const rechts = el("div", undefined, "repo-patch-status");
  rechts.append(...labels(z, neu), statusMarke(z));
  zeile.append(links, rechts);
  return zeile;
}

/**
 * Die Seite eines Issues: Titel, Status, Autorin, Labels, Text; wer darf
 * (Autorin, Eigentümer, Maintainer), schließt oder öffnet wieder (C-17b2);
 * darunter die Diskussion (`diskussion.ts`).
 */
function issueSeite(z: IssueZeile, k: RepoKarte, name: (pk: string) => string, neuLaden: () => Promise<void>, neu: () => void, zurueck: () => void): HTMLElement[] {
  const kopf = el("div", undefined, "issue-kopf");
  kopf.append(el("h3", z.issue.betreff, "patch-titel issue-titel"));
  const meta = el("p", undefined, "patch-meta mono-sm");
  meta.append(statusMarke(z), el("span", ` ${t("repo.patchVon", { name: name(z.issue.autor), datum: datum(z.issue.zeit) })}`, "muted"), ...labels(z, neu));
  // Beschreibung als Markdown wie bei GitHub (C-20a), Zeilenumbrüche bleiben
  const text = z.issue.text.trim() ? markdownDom(z.issue.text, "issue-text", { umbrueche: true }) : el("div", t("repo.issueOhneText"), "issue-text muted");
  const teile: HTMLElement[] = [knopf(t("repo.alleIssues"), "ghost mini issue-zurueck", zurueck), kopf, meta, text];
  if (z.darfStatus && k.repo) {
    const aktionen = el("div", undefined, "patch-aktionen issue-aktionen");
    const ziele: IssueStatus[] = z.status === "offen" ? ["erledigt", "geschlossen"] : ["offen"];
    aktionen.append(...ziele.map((ziel) => knopf(t(STATUS_AKTION[ziel]), "ghost mini repo-knopf", () => void setzeIssueStatus(z, k, ziel, neuLaden))));
    teile.push(aktionen);
  }
  teile.push(...diskussion({
    wurzel: { id: z.issue.id, autor: z.issue.autor, kind: KIND_ISSUE }, kommentare: z.kommentare, name, neuLaden,
    ...(k.privatRaum ? { privatRaum: k.privatRaum } : {}),
  }));
  return teile;
}

const STATUS_AKTION: Record<IssueStatus, string> = { erledigt: "repo.issueSchliessenErledigt", geschlossen: "repo.issueSchliessenNichtGeplant", offen: "repo.issueWiederOeffnen" };

/** Status setzen – öffentlich signiert, im privaten Raum nur in die Gruppe. */
async function setzeIssueStatus(z: IssueZeile, k: RepoKarte, status: IssueStatus, neuLaden: () => Promise<void>): Promise<void> {
  if (!state.keypair || !k.repo) return;
  try {
    const { baueIssueStatus, raumRepoIssueStatus } = await import("@freedomstack/protocol");
    const angaben = { issue: z.issue, status, eigentuemer: k.repo.eigentuemer };
    if (k.privatRaum) await sendeInRaum(k.privatRaum, raumRepoIssueStatus(k.privatRaum, angaben));
    else await (await ensurePool()).publish(await signiere(baueIssueStatus(angaben, state.keypair.pk)));
    toast(t(STATUS_MELDUNG[status]));
    await neuLaden();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}
const STATUS_MELDUNG: Record<IssueStatus, string> = { erledigt: "repo.issueErledigtGemeldet", geschlossen: "repo.issueGeschlossenGemeldet", offen: "repo.issueWiederOffenGemeldet" };

/** Neues Issue: Titel, Beschreibung, Labels – öffentlich signiert oder nur in die Gruppe des privaten Raums. */
async function neuesIssue(k: RepoKarte, neuLaden: () => Promise<void>): Promise<void> {
  const repo = k.repo;
  if (!repo || !state.keypair) return;
  const w = await dialog({
    titel: t("repo.neuesIssue"), ok: t("repo.issueAnlegen"),
    text: t(k.privatRaum ? "repo.issueHinweisRaum" : "repo.issueHinweis"),
    felder: [
      { art: "text", name: "titel", label: t("repo.issueTitel"), pflicht: true },
      { art: "textarea", name: "text", label: t("repo.issueText") },
      { art: "text", name: "labels", label: t("repo.issueLabels") },
    ],
  });
  const betreff = String(w?.titel ?? "").trim();
  if (!w || !betreff) return;
  const labels = String(w.labels ?? "").split(",").map((l) => l.trim()).filter(Boolean);
  const angaben = { repo, betreff, text: String(w.text ?? ""), labels };
  try {
    const { baueIssue, raumRepoIssue } = await import("@freedomstack/protocol");
    // Privater Raum: nur in die Gruppe – scheitert laut, statt aufs Relay auszuweichen
    if (k.privatRaum) await sendeInRaum(k.privatRaum, raumRepoIssue(k.privatRaum, angaben));
    else await (await ensurePool()).publish(await signiere(baueIssue(angaben, state.keypair.pk)));
    toast(t("repo.issueAngelegt", { titel: betreff.slice(0, 80) }));
    await neuLaden();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}
