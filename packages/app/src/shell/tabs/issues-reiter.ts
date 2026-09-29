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
import { type IssueFilter, type IssueZeile, type RepoKarte, issueFilterVon } from "../../repo-ansicht.js";
import { dialog } from "../dialog.js";
import { sendeInRaum } from "../raum-repos.js";
import { ensurePool, signiere, state } from "../state.js";
import { toast } from "../ui.js";

/** Offenes Issue und gewählter Filter – nur im Speicher. */
let offenesIssue: string | null = null;
let letzterFilter: IssueFilter = "offen";
export const vergissIssue = (): void => {
  offenesIssue = null;
  letzterFilter = "offen";
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

function labels(z: IssueZeile): HTMLElement[] {
  return z.issue.labels.map((l) => el("span", l, "msg-role issue-label"));
}

/**
 * Der Reiter: Liste oder – wenn eines offen ist – die Seite des Issues.
 * `name(pk)` zeigt Namen statt Schlüsseln, `neu()` zeichnet den Reiter neu.
 */
export function issuesReiter(k: RepoKarte, name: (pk: string) => string, neu: () => void, neuLaden: () => Promise<void>): HTMLElement[] {
  const zeilen = k.issues ?? [];
  const offen = zeilen.find((z) => z.issue.id === offenesIssue);
  if (offen) return issueSeite(offen, name, () => {
    offenesIssue = null;
    neu();
    document.querySelector<HTMLElement>(`[data-issue="${CSS.escape(offen.issue.id)}"]`)?.focus();
  });
  offenesIssue = null;
  const teile: HTMLElement[] = [];
  if (k.repo && state.keypair) teile.push(knopf(t("repo.neuesIssue"), "ghost mini issue-neu", () => void neuesIssue(k, neuLaden)));
  const liste = el("div", undefined, "repo-patches issue-liste");
  const filter = el("div", undefined, "repo-filter");
  const zeige = (f: IssueFilter) => {
    letzterFilter = f;
    filter.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === f)));
    const gezeigt = zeilen.filter((z) => issueFilterVon(z.status) === f);
    liste.replaceChildren(...(gezeigt.length ? gezeigt.map((z) => issueZeile(z, name, neu)) : [el("p", t("repo.keineIssues"), "mono-sm muted")]));
  };
  for (const f of ["offen", "geschlossen"] as const) {
    const b = knopf(t("repo.filterZahl", { status: t(f === "offen" ? "repo.issueOffen" : "repo.issueGeschlossen"), n: zeilen.filter((z) => issueFilterVon(z.status) === f).length }),
      "ghost mini repo-knopf", () => zeige(f));
    b.dataset.filter = f;
    filter.append(b);
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
  rechts.append(...labels(z), statusMarke(z));
  zeile.append(links, rechts);
  return zeile;
}

/** Die Seite eines Issues: Titel, Status, Autorin, Labels, Text und die Kommentare, ältester zuerst. */
function issueSeite(z: IssueZeile, name: (pk: string) => string, zurueck: () => void): HTMLElement[] {
  const kopf = el("div", undefined, "issue-kopf");
  kopf.append(el("h3", z.issue.betreff, "patch-titel issue-titel"));
  const meta = el("p", undefined, "patch-meta mono-sm");
  meta.append(statusMarke(z), el("span", ` ${t("repo.patchVon", { name: name(z.issue.autor), datum: datum(z.issue.zeit) })}`, "muted"), ...labels(z));
  const text = el("div", z.issue.text.trim() || t("repo.issueOhneText"), z.issue.text.trim() ? "issue-text" : "issue-text muted");
  const verlauf = el("div", undefined, "issue-kommentare");
  verlauf.append(...(z.kommentare.length ? z.kommentare.map((k) => {
    const box = el("div", undefined, "issue-kommentar");
    box.append(el("div", t("repo.patchVon", { name: name(k.autor), datum: datum(k.zeit) }), "mono-sm muted"), el("div", k.text, "issue-text"));
    return box;
  }) : [el("p", t("repo.keineKommentare"), "mono-sm muted")]));
  return [knopf(t("repo.alleIssues"), "ghost mini issue-zurueck", zurueck), kopf, meta, text, el("h4", t("repo.kommentare"), "issue-abschnitt"), verlauf];
}

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
