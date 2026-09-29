/**
 * Git über Nostr nach NIP-34 (Schritt 8.10): Repos ankündigen (Kind 30617),
 * Patches einreichen (1617), Status setzen (1630 offen, 1631 angenommen, 1632
 * geschlossen, 1633 Entwurf). Damit arbeiten Menschen an einem Repo, ohne
 * dass ein Server die Patches, Diskussionen oder Rechte verwaltet – und mit
 * denselben Events wie andere NIP-34-Clients (ngit, gitworkshop).
 *
 * Öffentlich mit Absicht: Code, Patches und wer sie angenommen hat, sind
 * gemeinsame Arbeit und signiert. Wer anonym beitragen will, nimmt eine eigene
 * Identität dafür.
 *
 * Angenommen gilt ein Patch nur, wenn der Eigentümer oder ein eingetragener
 * Maintainer des Repos es sagt – der Autor selbst oder Fremde koennen einen
 * Patch nicht „annehmen“. Sonst gilt der neueste Status des Autors oder eines
 * Maintainers; ohne Status ist ein Patch offen.
 *
 * Klon-Adressen duerfen auch Radicle sein (`rad:…`): So kuendigt ein Repo
 * seinen Radicle-Spiegel an; spiegeln tut der Betreiber mit `rad`.
 */
import { type NostrEvent, type UnsignedEvent, buildEvent, getTag, getTags } from "./event.js";
import { ProtokollFehler } from "./fehler.js";
import { leseRaumAdresse } from "./spaces.js";

export const KIND_REPO_ANKUENDIGUNG = 30617;
export const KIND_PATCH = 1617;
export const KIND_STATUS_OFFEN = 1630;
export const KIND_STATUS_ANGENOMMEN = 1631;
export const KIND_STATUS_GESCHLOSSEN = 1632;
export const KIND_STATUS_ENTWURF = 1633;

/** Obergrenze eines Patches im Event – groessere Aenderungen gehoeren in ein Bundle. */
export const PATCH_MAX_BYTES = 60_000;

const HEX64 = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const REPO_ID = /^[a-zA-Z0-9._-]{1,64}$/;
/** Klon-Adressen: https/http/ssh/git und Radicle. */
const KLON = /^(https?:\/\/|ssh:\/\/|git:\/\/|git@[^\s:]+:|rad:)[^\s]{1,300}$/;

export interface RepoAnkuendigung {
  /** Kennung (d-Tag), z. B. „freedom-app“. */
  id: string;
  name: string;
  beschreibung?: string;
  /** Klon-Adressen – auch ein Radicle-Spiegel (`rad:…`). */
  klon: string[];
  web?: string[];
  /** Erster Commit – verbindet Forks desselben Repos (NIP-34 „euc“). */
  ersterCommit?: string;
  /** Weitere Maintainer (Pubkeys) neben dem Eigentuemer. */
  maintainer?: string[];
  /** Öffentlicher Raum, zu dem das Repo gehört (`raumAdresse()`, 11.4a) – Tag „a“. */
  raum?: string;
}

export function repoAdresse(eigentuemer: string, id: string): string {
  return `${KIND_REPO_ANKUENDIGUNG}:${eigentuemer}:${id}`;
}

export function baueRepoAnkuendigung(r: RepoAnkuendigung, eigentuemer: string): UnsignedEvent {
  if (!REPO_ID.test(r.id)) throw new ProtokollFehler("repo-kennung", "Repo-Kennung: Buchstaben, Ziffern, . _ - (höchstens 64)");
  for (const k of r.klon) if (!KLON.test(k)) throw new ProtokollFehler("repo-klon", `Keine Klon-Adresse: ${k.slice(0, 40)}`, { adresse: k.slice(0, 40) });
  for (const m of r.maintainer ?? []) if (!HEX64.test(m)) throw new ProtokollFehler("repo-maintainer", "Maintainer muss ein 64-stelliger Hex-Schlüssel sein");
  if (r.ersterCommit !== undefined && !SHA1.test(r.ersterCommit)) throw new ProtokollFehler("repo-erster-commit", "Erster Commit muss ein SHA-1 sein");
  if (r.raum !== undefined && !leseRaumAdresse(r.raum)) throw new ProtokollFehler("repo-raum", "Kein öffentlicher Raum (34700:<Schlüssel>:space:<Kennung>)");
  const tags: string[][] = [["d", r.id], ["name", r.name.slice(0, 100)]];
  if (r.beschreibung) tags.push(["description", r.beschreibung.slice(0, 500)]);
  if (r.klon.length) tags.push(["clone", ...r.klon]);
  if (r.web?.length) tags.push(["web", ...r.web]);
  if (r.ersterCommit) tags.push(["r", r.ersterCommit, "euc"]);
  if (r.maintainer?.length) tags.push(["maintainers", ...r.maintainer]);
  if (r.raum) tags.push(["a", r.raum]);
  return buildEvent(eigentuemer, KIND_REPO_ANKUENDIGUNG, tags, "");
}

export type GelesenesRepo = RepoAnkuendigung & { eigentuemer: string; adresse: string; maintainer: string[] };

/** Ankuendigung streng lesen: fremde Daten – ungueltige Klon-Adressen und Schluessel fallen heraus. */
export function leseRepoAnkuendigung(ev: UnsignedEvent): GelesenesRepo {
  if (ev.kind !== KIND_REPO_ANKUENDIGUNG) throw new Error(`Keine Repo-Ankündigung: Kind ${ev.kind}`);
  const id = getTag(ev, "d") ?? "";
  if (!REPO_ID.test(id)) throw new Error("Repo ohne gültige Kennung");
  const alle = (name: string) => getTags(ev, name).flatMap((t) => t.slice(1));
  const euc = ev.tags.find((t) => t[0] === "r" && t[2] === "euc")?.[1];
  const raum = ev.tags.find((t) => t[0] === "a" && leseRaumAdresse(t[1]))?.[1];
  return {
    id,
    name: (getTag(ev, "name") ?? id).slice(0, 100),
    beschreibung: getTag(ev, "description")?.slice(0, 500),
    klon: alle("clone").filter((k) => KLON.test(k)),
    web: alle("web").filter((w) => /^https?:\/\/[^\s]{1,300}$/.test(w)),
    ersterCommit: euc && SHA1.test(euc) ? euc : undefined,
    maintainer: alle("maintainers").filter((m) => HEX64.test(m) && m !== ev.pubkey),
    ...(raum ? { raum } : {}),
    eigentuemer: ev.pubkey,
    adresse: repoAdresse(ev.pubkey, id),
  };
}

/** Wer darf annehmen: Eigentuemer und eingetragene Maintainer. */
export function darfAnnehmen(repo: Pick<GelesenesRepo, "eigentuemer" | "maintainer">, pk: string): boolean {
  return pk === repo.eigentuemer || repo.maintainer.includes(pk);
}

/**
 * Patch einreichen: der Text aus `git format-patch` (eine Aenderung), an das
 * Repo adressiert. Der Betreff und der Commit kommen aus dem Patch selbst.
 */
export function bauePatch(p: { repo: Pick<GelesenesRepo, "eigentuemer" | "id" | "ersterCommit">; text: string; wurzel?: boolean }, autor: string): UnsignedEvent {
  const kopf = lesePatchText(p.text);
  const tags: string[][] = [["a", repoAdresse(p.repo.eigentuemer, p.repo.id)], ["p", p.repo.eigentuemer]];
  if (p.repo.ersterCommit) tags.push(["r", p.repo.ersterCommit]);
  if (p.wurzel ?? true) tags.push(["t", "root"]);
  tags.push(["commit", kopf.commit]);
  return buildEvent(autor, KIND_PATCH, tags, p.text);
}

/**
 * Kopfzeile nach RFC 2047 dekodieren: git kodiert Umlaute im Betreff als
 * `=?UTF-8?q?…?=` (oder `?b?`) und bricht lange Betreffe um.
 */
function dekodiereKopf(roh: string): string {
  const wort = /=\?utf-8\?([qb])\?([^?]*)\?=/gi;
  const bytes = (art: string, inhalt: string): number[] => art.toLowerCase() === "b"
    ? Array.from(atob(inhalt), (c) => c.charCodeAt(0))
    : Array.from(inhalt.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})|./g, (m, h: string | undefined) => h ? String.fromCharCode(parseInt(h, 16)) : m), (c) => c.charCodeAt(0));
  // Leerraum zwischen zwei kodierten Woertern gehoert nicht zum Text.
  const zusammen = roh.replace(/(\?=)\s+(?==\?)/g, "$1");
  return zusammen.replace(wort, (_m, art: string, inhalt: string) => new TextDecoder().decode(new Uint8Array(bytes(art, inhalt))));
}

/** Kopf eines `git format-patch`-Textes: Commit und Betreff; alles andere ist kein Patch. */
export function lesePatchText(text: string): { commit: string; betreff: string } {
  if (new TextEncoder().encode(text).length > PATCH_MAX_BYTES) throw new ProtokollFehler("patch-gross", `Patch zu groß (höchstens ${PATCH_MAX_BYTES / 1000} KB) – größere Änderungen als Bundle`, { kb: PATCH_MAX_BYTES / 1000 });
  const erste = /^From ([0-9a-f]{40}) /.exec(text);
  if (!erste) throw new ProtokollFehler("patch-format", "Kein Patch aus `git format-patch` (erste Zeile „From <commit> …“ fehlt)");
  // Betreff samt Folgezeilen (beginnen mit Leerraum), dann dekodiert.
  const kopf = /^Subject: (.*(?:\r?\n[ \t].*)*)$/m.exec(text)?.[1];
  const betreff = kopf ? dekodiereKopf(kopf.replace(/\r?\n[ \t]+/g, " ")).replace(/^\[PATCH[^\]]*\]\s*/, "").trim() : "";
  if (!betreff) throw new ProtokollFehler("patch-betreff", "Patch ohne Betreff");
  if (!/^diff --git /m.test(text)) throw new ProtokollFehler("patch-diff", "Patch ohne Änderung (kein „diff --git“)");
  return { commit: erste[1], betreff: betreff.slice(0, 200) };
}

export interface GelesenerPatch {
  id: string;
  autor: string;
  repoAdresse: string;
  commit: string;
  betreff: string;
  text: string;
  zeit: number;
}

export function lesePatch(ev: NostrEvent): GelesenerPatch {
  if (ev.kind !== KIND_PATCH) throw new Error(`Kein Patch: Kind ${ev.kind}`);
  const adresse = getTag(ev, "a");
  if (!adresse?.startsWith(`${KIND_REPO_ANKUENDIGUNG}:`)) throw new Error("Patch ohne Repo");
  const kopf = lesePatchText(ev.content);
  return { id: ev.id, autor: ev.pubkey, repoAdresse: adresse, commit: kopf.commit, betreff: kopf.betreff, text: ev.content, zeit: ev.created_at };
}

export type PatchStatus = "offen" | "angenommen" | "geschlossen" | "entwurf";

const STATUS_KIND: Record<PatchStatus, number> = {
  offen: KIND_STATUS_OFFEN,
  angenommen: KIND_STATUS_ANGENOMMEN,
  geschlossen: KIND_STATUS_GESCHLOSSEN,
  entwurf: KIND_STATUS_ENTWURF,
};

/** Status setzen – bei „angenommen“ optional die Commits, als die er eingespielt wurde. */
export function baueStatus(
  p: { patch: Pick<GelesenerPatch, "id" | "autor" | "repoAdresse">; status: PatchStatus; eigentuemer: string; commits?: string[]; notiz?: string },
  von: string,
): UnsignedEvent {
  for (const c of p.commits ?? []) if (!SHA1.test(c)) throw new ProtokollFehler("patch-commit", "Commit muss ein SHA-1 sein");
  const tags: string[][] = [["e", p.patch.id, "", "root"], ["p", p.patch.autor], ["a", p.patch.repoAdresse]];
  if (p.eigentuemer !== p.patch.autor) tags.push(["p", p.eigentuemer]);
  if (p.status === "angenommen" && p.commits?.length) tags.push(["applied-as-commits", ...p.commits]);
  return buildEvent(von, STATUS_KIND[p.status], tags, (p.notiz ?? "").slice(0, 1000));
}

/**
 * Status eines Patches aus den Status-Events: der neueste gueltige zaehlt.
 * „Angenommen“ nur von Eigentuemer oder Maintainer; die uebrigen auch vom Autor.
 * Events anderer zaehlen nicht.
 */
export function patchStatus(
  patch: Pick<GelesenerPatch, "id" | "autor">,
  repo: Pick<GelesenesRepo, "eigentuemer" | "maintainer">,
  events: readonly NostrEvent[],
): { status: PatchStatus; von?: string; zeit?: number; commits?: string[] } {
  const art = new Map<number, PatchStatus>(Object.entries(STATUS_KIND).map(([s, k]) => [k, s as PatchStatus]));
  let bester: NostrEvent | undefined;
  for (const ev of events) {
    const status = art.get(ev.kind);
    if (!status || !ev.tags.some((t) => t[0] === "e" && t[1] === patch.id)) continue;
    const maintainer = darfAnnehmen(repo, ev.pubkey);
    if (!maintainer && (status === "angenommen" || ev.pubkey !== patch.autor)) continue;
    if (!bester || ev.created_at > bester.created_at) bester = ev;
  }
  if (!bester) return { status: "offen" };
  const status = art.get(bester.kind)!;
  const commits = status === "angenommen" ? getTags(bester, "applied-as-commits").flatMap((t) => t.slice(1)).filter((c) => SHA1.test(c)) : undefined;
  return { status, von: bester.pubkey, zeit: bester.created_at, ...(commits?.length ? { commits } : {}) };
}

// ------------------------------------------------------------ Issues (C-17a)

/**
 * Issues nach NIP-34 (Kind 1621): Betreff im Tag `subject`, Text als Inhalt,
 * Labels als `t`-Tags, an das Repo adressiert wie ein Patch. Status mit
 * denselben Arten wie bei Patches: 1630 offen, 1631 erledigt, 1632
 * geschlossen. Kommentare dazu nach NIP-22 (`kommentar.ts`).
 */
export const KIND_ISSUE = 1621;
/** Obergrenze des Issue-Texts – wie bei Patches: Größeres gehört in eine Datei oder ein Bundle. */
export const ISSUE_MAX_BYTES = 30_000;
const LABEL = /^[^\s,]{1,40}$/;

export interface GelesenesIssue {
  id: string;
  autor: string;
  repoAdresse: string;
  betreff: string;
  text: string;
  labels: string[];
  zeit: number;
}

export function baueIssue(
  i: { repo: Pick<GelesenesRepo, "eigentuemer" | "id">; betreff: string; text: string; labels?: string[] },
  autor: string,
): UnsignedEvent {
  const betreff = i.betreff.trim();
  if (!betreff) throw new ProtokollFehler("issue-betreff", "Issue ohne Betreff");
  if (new TextEncoder().encode(i.text).length > ISSUE_MAX_BYTES) {
    throw new ProtokollFehler("issue-gross", `Issue zu groß (höchstens ${ISSUE_MAX_BYTES / 1000} KB)`, { kb: ISSUE_MAX_BYTES / 1000 });
  }
  for (const l of i.labels ?? []) if (!LABEL.test(l)) throw new ProtokollFehler("issue-label", "Label: ohne Leerzeichen und Komma, höchstens 40 Zeichen");
  const tags: string[][] = [["a", repoAdresse(i.repo.eigentuemer, i.repo.id)], ["p", i.repo.eigentuemer], ["subject", betreff.slice(0, 200)]];
  for (const l of new Set(i.labels ?? [])) tags.push(["t", l]);
  return buildEvent(autor, KIND_ISSUE, tags, i.text);
}

/** Issue streng lesen: fremde Daten – ohne Repo oder Betreff kein Issue, Labels nur in gültiger Form. */
export function leseIssue(ev: NostrEvent): GelesenesIssue {
  if (ev.kind !== KIND_ISSUE) throw new Error(`Kein Issue: Kind ${ev.kind}`);
  const adresse = getTag(ev, "a");
  if (!adresse?.startsWith(`${KIND_REPO_ANKUENDIGUNG}:`)) throw new Error("Issue ohne Repo");
  const betreff = (getTag(ev, "subject") ?? "").trim();
  if (!betreff) throw new Error("Issue ohne Betreff");
  if (new TextEncoder().encode(ev.content).length > ISSUE_MAX_BYTES) throw new Error("Issue zu groß");
  const labels = [...new Set(getTags(ev, "t").map((t) => t[1] ?? "").filter((l) => LABEL.test(l)))].slice(0, 20);
  return { id: ev.id, autor: ev.pubkey, repoAdresse: adresse, betreff: betreff.slice(0, 200), text: ev.content, labels, zeit: ev.created_at };
}

export type IssueStatus = "offen" | "erledigt" | "geschlossen";
const ISSUE_STATUS_KIND: Record<IssueStatus, number> = { offen: KIND_STATUS_OFFEN, erledigt: KIND_STATUS_ANGENOMMEN, geschlossen: KIND_STATUS_GESCHLOSSEN };

/** Status eines Issues setzen – wie bei GitHub dürfen Autor, Eigentümer und Maintainer schließen und wieder öffnen. */
export function baueIssueStatus(
  p: { issue: Pick<GelesenesIssue, "id" | "autor" | "repoAdresse">; status: IssueStatus; eigentuemer: string; notiz?: string },
  von: string,
): UnsignedEvent {
  const tags: string[][] = [["e", p.issue.id, "", "root"], ["p", p.issue.autor], ["a", p.issue.repoAdresse]];
  if (p.eigentuemer !== p.issue.autor) tags.push(["p", p.eigentuemer]);
  return buildEvent(von, ISSUE_STATUS_KIND[p.status], tags, (p.notiz ?? "").slice(0, 1000));
}

/**
 * Status eines Issues: der neueste gültige zählt – von Autor, Eigentümer oder
 * Maintainer; Status anderer zählen nicht. 1633 (Entwurf) gibt es für Issues
 * nicht und zählt nicht. Ohne Status ist ein Issue offen.
 */
export function issueStatus(
  issue: Pick<GelesenesIssue, "id" | "autor">,
  repo: Pick<GelesenesRepo, "eigentuemer" | "maintainer">,
  events: readonly NostrEvent[],
): { status: IssueStatus; von?: string; zeit?: number } {
  const art = new Map<number, IssueStatus>(Object.entries(ISSUE_STATUS_KIND).map(([s, k]) => [k, s as IssueStatus]));
  let bester: NostrEvent | undefined;
  for (const ev of events) {
    const status = art.get(ev.kind);
    if (!status || !ev.tags.some((t) => t[0] === "e" && t[1] === issue.id)) continue;
    if (ev.pubkey !== issue.autor && !darfAnnehmen(repo, ev.pubkey)) continue;
    if (!bester || ev.created_at > bester.created_at) bester = ev;
  }
  return bester ? { status: art.get(bester.kind)!, von: bester.pubkey, zeit: bester.created_at } : { status: "offen" };
}
