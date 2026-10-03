/**
 * Repositories nach NIP-34 (Schritt 8.10b), seit C.3a als eigene Seite: Liste
 * mit Suche und „Alle / Meine“, je Repo eine Karte, dahinter die Repo-Seite
 * (`repo-seite.ts`). Ein Repo = Ankündigung (30617) + Bundle-Verweis (38042)
 * desselben Eigentümers mit derselben Kennung – nur in der Anzeige verbunden.
 * Öffentlich und signiert – wie bei jedem Git-Projekt; andere Nostr-Clients
 * (ngit, gitworkshop) lesen dieselben Events.
 *
 * Die Liste wird mit DOM-Aufrufen und textContent gebaut, nie per innerHTML:
 * Namen, Betreffe und Adressen kommen von Fremden.
 */
import type { GelesenesRepo, NostrEvent } from "@freedomstack/protocol";
import { gebietsschema, t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import { type RaumZiel, type RepoKarte, filtereKarten, mitIssues, mitSternen, privateRaumKarten, raumAuswahl, reposImRaum, repoKarten } from "../../repo-ansicht.js";
import { ladeBeobachtet } from "./repo-sterne-ui.js";
import { type PrivateRepos, privateRaumRepos, sendeInRaum } from "../raum-repos.js";
import { bestaetige, dialog } from "../dialog.js";
import { ensurePool, signiere, state } from "../state.js";
import { toast } from "../ui.js";
import { switchTab } from "../app.js";
import { geheZuRaum, oeffentlicheRaeume } from "./raeume.js";
import { kennungVon } from "../../oeffentliche-raeume.js";
import { eigentuemerName, vergissReiter, zeigeRepoSeite } from "./repo-seite.js";
import { geheim } from "../tresor.js";
import { type Gesehen, LS_REPOS_GESEHEN, type Neuigkeiten, beteiligt, gesehenAbgleichen, leseGesehen, neuGesamt, neuigkeiten } from "../../repo-neuigkeiten.js";
import { LOKAL_MAX, LokalVoll } from "../../lokale-repos.js";
import { BUNDLE_GRENZEN } from "../../git-bundle.js";
import { lokaleRepos } from "../lokale-repos-ablage.js";
import { halteBeiMeinemKnoten } from "../knoten-halten-ui.js";

const STATUS_KINDS = [1630, 1631, 1632, 1633];

let karten: RepoKarte[] = [];
/** Wert für „Wo“: nur auf diesem Gerät (B-2) – Gruppen-Ids sind Hex, kein Zusammenstoß. */
const LOKAL = "lokal"; // kein UI-Text
/** Wahlwert eines öffentlichen Raums im „Wo“ (C-15) – davor die Adresse des Raums. */
const OEFFENTLICH = "raum:"; // kein UI-Text
/** Offenes Repo – nur im Speicher, nie in der Adresse (C.1a). */
let offenesRepo: string | null = null;
let nurMeine = false;
/** „Neu“-Filter und „zuletzt gesehen“ je Repo (C-20f) – gemerkt nur im Tresor (`geheim`), die Liste verrät, was man verfolgt. */
let nurNeu = false;
let gesehen: Gesehen | null = null;
const jetztSek = () => Math.floor(Date.now() / 1000);
function gesehenVon(): Gesehen {
  gesehen ??= leseGesehen(geheim.getItem(LS_REPOS_GESEHEN));
  return gesehen;
}
function merkeGesehen(g: Gesehen): void {
  gesehen = g;
  geheim.setItem(LS_REPOS_GESEHEN, JSON.stringify(g));
}
/** Was seit dem letzten Blick neu ist – nur für Repos, an denen man beteiligt ist; sonst `null`. */
function neuIn(k: RepoKarte): Neuigkeiten | null {
  const ich = state.keypair?.pk;
  if (!beteiligt(k, ich)) return null;
  const was = neuigkeiten(k, gesehenVon()[k.schluessel] ?? jetztSek(), ich);
  return neuGesamt(was) ? was : null;
}
/** Ein Repo geöffnet: alles darin gilt als gesehen. */
function gesehenJetzt(schluessel: string): void {
  merkeGesehen({ ...gesehenVon(), [schluessel]: jetztSek() });
}
/** Beiträge (38056), einmal je Laden der Liste geholt – erst, wenn ein Reiter „Mitwirkende“ sie braucht. */
let beitraege: Promise<NostrEvent[]> | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, klasse?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

/** Repos privater Räume (11.4b2) vom letzten Laden – auch für „Wo“ beim Ankündigen. */
let privat: PrivateRepos[] = [];

/**
 * Öffentliche Räume, die in dieser Sitzung offen waren (11.4c): ihre Repos lädt
 * die Liste mit, auch wenn sie nicht unter den neuesten sind. Nur im Speicher;
 * das Relay erfuhr den Raum schon beim Öffnen.
 */
const raumAdressen = new Set<string>();
/** Wer nach jedem Laden neu zeichnet (die Liste im Raum, 11.4c). */
const nachLaden = new Set<() => void>();
export const beiReposGeladen = (fn: () => void): void => void nachLaden.add(fn);

/** Einen offenen öffentlichen Raum merken – neu gemerkt, lädt die Liste nach. */
export function merkeRaumAdresse(adresse: string): void {
  if (raumAdressen.has(adresse)) return;
  raumAdressen.add(adresse);
  void ladeNip34Repos();
}

/** Die Repos eines Raums aus dem letzten Laden (11.4c). */
export const reposVonRaum = (ziel: RaumZiel): RepoKarte[] => reposImRaum(karten, ziel);

let laeuft: Promise<void> | null = null;
let danach: Promise<void> | null = null;
/**
 * Repos privater Räume erst, wenn die Seite Repos oder ein privater Raum offen war (C-11):
 * sie kommen aus dem MLS-Verlauf, und die Engine lädt nie beim Start.
 */
let mitPrivaten = false;

/** Laden – läuft es schon, danach genau einmal neu, damit inzwischen Gemerktes (Raum, neues Event) dabei ist. */
export function ladeNip34Repos(opts: { privat?: boolean } = {}): Promise<void> {
  if (opts.privat) mitPrivaten = true;
  if (!laeuft) {
    laeuft = ladeJetzt().finally(() => { laeuft = null; });
    return laeuft;
  }
  danach ??= laeuft.then(() => { danach = null; return ladeNip34Repos(); });
  return danach;
}

/** Ankündigungen, Bundle-Verweise, Patches und Status laden und zeigen. */
async function ladeJetzt(): Promise<void> {
  const box = document.getElementById("repos-karten");
  if (!box) return;
  try {
    const pool = await ensurePool();
    const { KIND_REPO_ANKUENDIGUNG, KIND_PATCH, KIND_GIT_REPO_REF, KIND_ISSUE, KIND_KOMMENTAR, KIND_REPO_RELEASE, KIND_LABEL, KIND_REAKTION, KIND_LOESCHUNG } = await import("@freedomstack/protocol");
    const [allgemein, bundles, ausRaeumen] = await Promise.all([
      pool.query({ kinds: [KIND_REPO_ANKUENDIGUNG], limit: 100 }),
      pool.query({ kinds: [KIND_GIT_REPO_REF], limit: 50 }),
      raumAdressen.size ? pool.query({ kinds: [KIND_REPO_ANKUENDIGUNG], "#a": [...raumAdressen].slice(0, 50), limit: 100 }) : Promise.resolve([] as NostrEvent[]),
    ]);
    const ankuendigungen = [...new Map([...allgemein, ...ausRaeumen].map((ev) => [ev.id, ev])).values()];
    const adressen = ankuendigungen.map((ev) => `${KIND_REPO_ANKUENDIGUNG}:${ev.pubkey}:${ev.tags.find((x) => x[0] === "d")?.[1] ?? ""}`);
    // Issues (C-17b) laufen neben den Patches
    const issuesLaden = adressen.length ? pool.query({ kinds: [KIND_ISSUE], "#a": adressen, limit: 300 }) : Promise.resolve([] as NostrEvent[]);
    // Releases (C-20h2) ebenso – nach Repo-Adresse, wie Issues
    const releasesLaden = adressen.length ? pool.query({ kinds: [KIND_REPO_RELEASE], "#a": adressen, limit: 300 }) : Promise.resolve([] as NostrEvent[]);
    // Sterne (C-20j2) ebenso; die eigene Beobachtungsliste nur verschlüsselt
    const sterneLaden = adressen.length ? pool.query({ kinds: [KIND_REAKTION], "#a": adressen, limit: 1000 }) : Promise.resolve([] as NostrEvent[]);
    const beobachtetLaden = ladeBeobachtet(pool).catch(() => new Set<string>());
    const patches: NostrEvent[] = adressen.length ? await pool.query({ kinds: [KIND_PATCH], "#a": adressen, limit: 300 }) : [];
    const status = patches.length ? await pool.query({ kinds: STATUS_KINDS, "#e": patches.map((p) => p.id), limit: 1000 }) : [];
    // Räume, auf die Repos verweisen (11.4a): ihre Rollen bestimmen, wer mitpflegt
    const { leseRaumAdresse } = await import("@freedomstack/protocol");
    const raumIds = [...new Set(ankuendigungen.flatMap((ev) => ev.tags.filter((x) => x[0] === "a").map((x) => leseRaumAdresse(x[1])?.spaceId ?? "")).filter(Boolean))];
    // Repos privater Räume (11.4b2) nur aus dem MLS-Verlauf – eigene Karten, Aktionen nur in die Gruppe
    if (mitPrivaten) privat = await privateRaumRepos().catch(() => []);
    karten = [...repoKarten(ankuendigungen, bundles, patches, status, state.keypair?.pk, await raumStruktur(raumIds)),
      ...privat.flatMap((p) => privateRaumKarten(p, state.keypair?.pk))].sort((a, b) => b.zuletzt - a.zuletzt || a.name.localeCompare(b.name));
    // Issues, ihr Status und Kommentare an Issues und Patches (C-17b): öffentliche nur an öffentliche Karten
    const issues = await issuesLaden;
    const wurzeln = [...issues, ...patches].map((e) => e.id);
    // Labels und Zuständige (C-20i2) nach Ziel wie die Kommentare
    const [issueStatus, kommentare, labels] = wurzeln.length ? await Promise.all([
      issues.length ? pool.query({ kinds: STATUS_KINDS, "#e": issues.map((e) => e.id), limit: 1000 }) : Promise.resolve([] as NostrEvent[]),
      pool.query({ kinds: [KIND_KOMMENTAR], "#E": wurzeln, limit: 1000 }),
      pool.query({ kinds: [KIND_LABEL], "#e": wurzeln, limit: 1000 }),
    ]) : [[], [], []];
    karten = mitIssues(karten, { issues, status: issueStatus, kommentare, releases: await releasesLaden, labels }, privat, state.keypair?.pk);
    const sterne = await sterneLaden;
    const loeschungen = sterne.length ? await pool.query({ kinds: [KIND_LOESCHUNG], "#e": sterne.map((e) => e.id), limit: 1000 }) : [];
    karten = mitSternen(karten, [...sterne, ...loeschungen], state.keypair?.pk, await beobachtetLaden);
    // Repos nur auf diesem Gerät (B-2) erst danach: nie Issues eines öffentlichen Repos gleicher Kennung
    karten = [...karten, ...lokaleRepos.karten(state.keypair?.pk)].sort((a, b) => b.zuletzt - a.zuletzt || a.name.localeCompare(b.name));
    // Neu beteiligte Repos beginnen jetzt – sonst wäre beim ersten Mal alles „neu“ (C-20f)
    const abgleich = gesehenAbgleichen(gesehenVon(), karten, state.keypair?.pk, jetztSek());
    if (abgleich.geaendert) merkeGesehen(abgleich.gesehen);
    beitraege = null;
    zeige();
    for (const fn of nachLaden) fn();
  } catch {
    // Ohne Relays bleiben die Repos dieses Geräts (B-2) sichtbar
    karten = lokaleRepos.karten(state.keypair?.pk);
    if (!karten.length) {
      box.textContent = t("repo.relaysWeg");
      return;
    }
    zeige();
    box.prepend(el("p", t("repo.relaysWeg"), "mono-sm muted"));
  }
}

/** Struktur öffentlicher Räume (Definition, Rollen, Zuweisungen) – ausgewertet wird in `raumZustandFuer()`. */
async function raumStruktur(ids: readonly string[]): Promise<NostrEvent[]> {
  if (ids.length === 0) return [];
  const { KIND_SPACE, KIND_SPACE_ROLES, KIND_ROLE_GRANT } = await import("@freedomstack/protocol");
  return (await ensurePool()).query({ kinds: [KIND_SPACE, KIND_SPACE_ROLES, KIND_ROLE_GRANT], "#space": ids.slice(0, 50), limit: 500 });
}

/** Meine öffentlichen Räume, in denen ich Repos pflegen darf (11.4a) – für die Einstellungen eines Repos. */
async function meineRepoRaeume(): Promise<{ adresse: string; name: string }[]> {
  if (!state.keypair) return [];
  // Seit B-7 stehen dort Adressen – gefragt wird nach der Kennung, gewählt nur ein beigetretener Raum
  const eintraege = oeffentlicheRaeume();
  const kennungen = [...new Set(eintraege.map(kennungVon).filter((k): k is string => !!k))];
  return raumAuswahl(await raumStruktur(kennungen), state.keypair.pk)
    .filter((r) => eintraege.includes(r.adresse) || eintraege.includes(kennungVon(r.adresse) ?? ""));
}

/** Liste oder – wenn eines offen ist – die Repo-Seite; `fokus`: gerade geöffnet, Fokus auf „‹ Alle Repos“. */
function zeige(fokus = false): void {
  const liste = document.getElementById("repos-liste-ansicht");
  const seite = document.getElementById("repo-seite");
  const box = document.getElementById("repos-karten");
  if (!liste || !seite || !box) return;
  const offen = karten.find((k) => k.schluessel === offenesRepo);
  liste.classList.toggle("hidden", !!offen);
  seite.classList.toggle("hidden", !offen);
  if (offen) {
    // Neu gezeichnet nach dem Laden (etwa aus dem Raum geöffnet, 11.4c) behält „‹ Alle Repos“ den Fokus
    const warZurueck = document.activeElement?.classList.contains("repo-zurueck") ?? false;
    zeigeRepoSeite(seite, offen, {
      zurueck: () => {
        offenesRepo = null;
        zeige();
        box.querySelector<HTMLElement>(`[data-schluessel="${CSS.escape(offen.schluessel)}"]`)?.focus();
      },
      neuLaden: ladeNip34Repos,
      patchSenden: sendePatch,
      mitwirkende: ladeBeitraege,
      hochladen: ladeBundleHoch,
      raeume: meineRepoRaeume,
      zumRaum: () => {
        offenesRepo = null;
        zeige();
        void geheZuRaum(offen);
      },
      veroeffentlichen: veroeffentlicheLokal,
    });
    if (fokus || warZurueck) seite.querySelector<HTMLElement>(".repo-zurueck")?.focus();
    return;
  }
  const suche = (document.getElementById("repos-suche") as HTMLInputElement | null)?.value ?? "";
  const gezeigt = filtereKarten(karten, suche, nurMeine, state.keypair?.pk).filter((k) => !nurNeu || neuIn(k));
  const leer = nurNeu ? "repo.nichtsNeues" : karten.length ? "repo.nichtsGefunden" : "repo.keineRepos";
  box.replaceChildren(...(gezeigt.length ? gezeigt.map(karte) : [el("p", t(leer), "mono-sm muted")]));
}

/** Eine Karte: Name, Eigentümer, Beschreibung, offene Patches, letzte Aktivität, Marke „Bundle“. */
function karte(k: RepoKarte): HTMLElement {
  const b = el("button", undefined, "repo-karte");
  b.type = "button";
  b.dataset.schluessel = k.schluessel;
  const kopf = el("div", undefined, "repo-karte-kopf");
  kopf.append(el("span", eigentuemerName(k.eigentuemer), "repo-eigentuemer"), el("span", " / ", "muted"), el("span", k.name, "repo-name"));
  if (k.bundle) kopf.append(el("span", t("repo.markeBundle"), "msg-role"));
  if (k.privatRaum) kopf.append(el("span", t("repo.markePrivat"), "msg-role"));
  if (k.lokal) kopf.append(el("span", t("repo.markeLokal"), "msg-role"));
  if (k.sterne?.anzahl) kopf.append(el("span", t("repo.markeSterne", { n: k.sterne.anzahl }), "msg-role repo-marke-sterne"));
  // Raum (11.4c): nur, wenn das Repo bestätigt dazugehört – der Name ist fremder Text
  if (k.raumName) kopf.append(el("span", t("repo.markeRaum", { name: k.raumName }), "msg-role repo-marke-raum"));
  // Neu seit dem letzten Blick (C-20f): Issues, Patches, Kommentare von anderen
  const was = neuIn(k);
  if (was) {
    const marke = el("span", t("repo.markeNeu", { n: neuGesamt(was) }), "msg-role repo-marke-neu");
    marke.title = t("repo.neuDetails", { issues: was.issues, patches: was.patches, kommentare: was.kommentare });
    kopf.append(marke);
  }
  b.append(kopf);
  if (k.beschreibung) b.append(el("span", k.beschreibung, "repo-karte-text"));
  const datum = new Date(k.zuletzt * 1000).toLocaleDateString(gebietsschema(), { day: "numeric", month: "short", year: "numeric" });
  b.append(el("span", t("repo.karteFuss", { n: k.offen, datum }), "mono-sm muted"));
  b.addEventListener("click", () => {
    offenesRepo = k.schluessel;
    gesehenJetzt(k.schluessel);
    vergissReiter();
    zeige(true);
  });
  return b;
}

/** Ein Repo aus seinem Raum öffnen (11.4c): Seite „Repos“, gleich die Repo-Seite. */
export function oeffneRepo(schluessel: string): void {
  offenesRepo = schluessel;
  gesehenJetzt(schluessel);
  vergissReiter();
  switchTab("repos");
  zeige(true);
}

/** Alle Beiträge (38056) – gefiltert wird lokal, wie in der Karte „Mitwirkende“ (`earn.ts`). */
function ladeBeitraege(): Promise<NostrEvent[]> {
  beitraege ??= (async () => {
    const { KIND_GIT_CONTRIBUTION } = await import("@freedomstack/protocol");
    return (await ensurePool()).query({ kinds: [KIND_GIT_CONTRIBUTION], limit: 1000 });
  })();
  const laden = beitraege;
  laden.catch(() => { if (beitraege === laden) beitraege = null; });
  return laden;
}

/**
 * Bundle hochladen (seit C.3a2 hier, vorher in `app.ts`): für ein neues Repo
 * aus der Liste, für eine neue Version von der Repo-Seite. Seit 8.9b
 * verschlüsselt ins Blob-Netz, der Schlüssel steht öffentlich in der Referenz
 * (Entscheidung 26.09.2026): lesen kann jeder, Speicherknoten halten nur Chiffrat.
 * Im privaten Raum (11.4b2) geht die Referenz samt Schlüssel nur in die Gruppe.
 */
export async function ladeBundleHoch(datei: File, kennung: string, gruppe?: string, lokal = false): Promise<boolean> {
  if (!state.keypair) return false;
  try {
    const bytes = new Uint8Array(await datei.arrayBuffer());
    // Nur auf diesem Gerät (B-2): verschlüsselt in die eigene IndexedDB, nichts geht hinaus
    if (lokal) {
      if (bytes.length > BUNDLE_GRENZEN.bytes) {
        toast(t("repo.bundleGross"), true);
        return false;
      }
      await lokaleRepos.legeBundleAb(state.keypair.pk, kennung, bytes);
      toast(t("repo.lokalBundle", { name: kennung, kb: Math.round(bytes.length / 1024) }));
      await ladeNip34Repos();
      return true;
    }
    const { uploadAnhang } = await import("../../blob-client.js");
    const pool = await ensurePool();
    toast(t(gruppe ? "repo.ladeVerschluesseltHoch" : "ein.gitPubliziere", { name: datei.name, kb: Math.round(bytes.length / 1024) }));
    const res = await uploadAnhang(new File([bytes], "", { type: "application/octet-stream" }), pool as never, state.signer!);
    const { buildGitRepoRef, raumRepoBundle } = await import("@freedomstack/protocol");
    const angaben = { name: kennung, blobId: res.blobId, headSha: "local", branch: "main", message: `bundle ${datei.name}`, version: Math.floor(Date.now() / 1000), schluessel: res.schluessel }; // kein UI-Text
    // Privater Raum (11.4b2): der Verweis trägt den Schlüssel – nur in die Gruppe
    if (gruppe) await sendeInRaum(gruppe, raumRepoBundle(gruppe, angaben));
    else await pool.publish(await signiere(buildGitRepoRef(angaben, state.keypair.pk)));
    toast(t(gruppe ? "repo.bundleImRaum" : "ein.gitPubliziert", { name: kennung, blob: res.blobId.slice(0, 8) }));
    void halteBeiMeinemKnoten(res); // B-9b2: gekoppelt und mit Haken hält der eigene Knoten das Chiffrat
    await ladeNip34Repos();
    return true;
  } catch (e) {
    toast(t("ein.gitFehler", { fehler: fehlerText(e) }), true);
    return false;
  }
}

/**
 * Ein Repo nur auf diesem Gerät veröffentlichen (B-2c, Wechsel nach S1): nach
 * Rückfrage geht die Ankündigung signiert hinaus, das Bundle wie jede neue
 * Version verschlüsselt ins Blob-Netz (der Schlüssel steht öffentlich in der
 * Referenz). Erst wenn beides draußen ist, entfällt die Kopie auf dem Gerät –
 * scheitert etwas, bleibt sie, und ein zweiter Versuch ersetzt die Ankündigung.
 */
async function veroeffentlicheLokal(k: RepoKarte): Promise<void> {
  if (!state.keypair || !k.lokal) return;
  const ich = state.keypair.pk;
  const r = lokaleRepos.finde(ich, k.id);
  if (!r) return;
  // Ein öffentliches Repo gleicher Kennung wird ersetzt (30617 ist je Kennung ersetzbar) – das sagt die Rückfrage
  const ersetzt = karten.some((x) => !x.lokal && !x.privatRaum && x.schluessel === `${ich}:${k.id}`);
  const frage = ersetzt ? "repo.lokalVeroeffentlichenErsetzt" : "repo.lokalVeroeffentlichenFrage";
  if (!await bestaetige({ titel: t("repo.lokalVeroeffentlichen"), text: t(frage, { id: k.id }), ok: t("repo.lokalVeroeffentlichen") })) return;
  try {
    const { baueRepoAnkuendigung } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(await signiere(baueRepoAnkuendigung(r.angaben, ich)));
    if (r.bundle) {
      const bytes = await lokaleRepos.holeBundle(ich, k.id);
      if (!bytes) {
        toast(t("agent.bundleKaputt"), true);
        return;
      }
      // Wie jede neue Version; einen Fehler meldet ladeBundleHoch – die lokale Kopie bleibt
      if (!await ladeBundleHoch(new File([bytes as BlobPart], `${k.id}.bundle`), k.id)) return;
    }
    await lokaleRepos.entferne(ich, k.id);
    toast(t("repo.lokalVeroeffentlicht", { id: k.id }));
    offenesRepo = `${ich}:${k.id}`;
    await ladeNip34Repos();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

/** Patch senden – nach der Vorschau auf der Repo-Seite (seit C.3b1); öffentlich und signiert, im privaten Raum nur in die Gruppe (11.4b2). */
async function sendePatch(r: GelesenesRepo, text: string, gruppe?: string): Promise<boolean> {
  if (!state.keypair) return false;
  try {
    const { bauePatch, lesePatchText, raumRepoPatch } = await import("@freedomstack/protocol");
    const { betreff } = lesePatchText(text);
    if (gruppe) await sendeInRaum(gruppe, raumRepoPatch(gruppe, { repo: r, text }));
    else await (await ensurePool()).publish(await signiere(bauePatch({ repo: r, text }, state.keypair.pk)));
    toast(t("repo.patchGesendet", { betreff }));
    return true;
  } catch (e) {
    toast(fehlerText(e), true);
    return false;
  }
}

/**
 * Repo ankündigen: Kennung, Beschreibung und Klon-Adressen (auch ein Radicle-Spiegel rad:…).
 * Aus einem Raum (11.4c) steht „Wo“ fest: öffentlich mit Verweis auf den Raum, privat nur in die Gruppe.
 */
async function kuendigeAn(imRaum?: RaumZiel & { name: string }): Promise<void> {
  if (!state.keypair) return;
  // Wo (11.4b2): öffentlich, nur auf diesem Gerät (B-2) oder in einem Raum, in dem ich Repos pflegen darf –
  // privat aus dem MLS-Verlauf, seit C-15 auch beigetretene öffentliche (Rechte aus ihrem Zustand)
  const raeume = privat.filter((p) => p.darfPflegen);
  const oeffentlich = imRaum ? [] : await meineRepoRaeume().catch(() => []);
  const w = await dialog({
    titel: t("agent.repoAnkuendigen"), ok: t("agent.repoAnkuendigen"),
    felder: [
      { art: "text", name: "id", label: t("agent.repoKennungPh"), pflicht: true, mono: true },
      { art: "textarea", name: "beschreibung", label: t("repo.beschreibung") },
      { art: "text", name: "klon", label: t("agent.klonPh"), mono: true },
      ...(!imRaum ? [{ art: "wahl" as const, name: "wo", label: t("repo.wo"), wert: "", optionen: [
        { wert: "", text: t("repo.woOeffentlich") }, { wert: LOKAL, text: t("repo.woLokal") },
        ...raeume.map((p) => ({ wert: p.gruppe, text: p.name || t("repo.privaterRaum") })),
        ...oeffentlich.map((r) => ({ wert: OEFFENTLICH + r.adresse, text: t("repo.oeffentlicherRaum", { name: r.name }) })),
      ] }] : []),
    ],
  });
  const id = String(w?.id ?? "").trim();
  if (!w || !id) return;
  const klon = String(w.klon ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  const beschreibung = String(w.beschreibung ?? "").trim();
  const gruppe = imRaum ? ("gruppe" in imRaum ? imRaum.gruppe : undefined) : raeume.find((p) => p.gruppe === w.wo)?.gruppe;
  const gewaehlt = imRaum ? undefined : oeffentlich.find((r) => OEFFENTLICH + r.adresse === w.wo);
  const raum = imRaum && "adresse" in imRaum ? imRaum.adresse : gewaehlt?.adresse;
  try {
    const { baueRepoAnkuendigung, raumRepoAnkuendigung } = await import("@freedomstack/protocol");
    const angaben = { id, name: id, klon, ...(beschreibung ? { beschreibung } : {}), ...(raum ? { raum } : {}) };
    // Nur auf diesem Gerät (B-2): gemerkt, nichts geht hinaus – keine Rückfrage nötig
    if (!imRaum && w.wo === LOKAL) {
      await lokaleRepos.merke(state.keypair.pk, angaben);
      toast(t("repo.lokalAngelegt", { id }));
      await ladeNip34Repos();
      return;
    }
    const ev = baueRepoAnkuendigung(angaben, state.keypair.pk);
    const frage = gruppe ? "repo.ankuendigenFrageRaum" : raum ? "repo.ankuendigenFrageOeffentlich" : "repo.ankuendigenFrage";
    if (!await bestaetige({ titel: t("agent.repoAnkuendigen"), text: t(frage, { id, raum: imRaum?.name ?? gewaehlt?.name ?? "" }), ok: t("agent.repoAnkuendigen") })) return;
    if (gruppe) await sendeInRaum(gruppe, raumRepoAnkuendigung(gruppe, angaben));
    else await (await ensurePool()).publish(await signiere(ev));
    toast(t("repo.angekuendigt", { id }));
    await ladeNip34Repos();
  } catch (e) {
    toast(e instanceof LokalVoll ? t("repo.lokalVoll", { n: LOKAL_MAX }) : fehlerText(e), true);
  }
}

/** „Repo anlegen“ im Raum-Menü (11.4c) – nur, wo ich Repos pflegen darf (das prüft der Raum). */
export const legeRepoImRaumAn = (ziel: RaumZiel, name: string): Promise<void> => kuendigeAn({ ...ziel, name });

/** Knoepfe verdrahten und die Liste laden (einmal beim Start). */
export function wireNip34(): void {
  const an = document.getElementById("nip34-ankuendigen");
  if (!an) return;
  an.addEventListener("click", () => void kuendigeAn());
  // Bundle für ein neues Repo (Name aus dem Feld, sonst aus dem Dateinamen); neue Versionen auf der Repo-Seite
  const hoch = document.getElementById("git-repo-publish");
  const bundle = document.getElementById("git-bundle-file") as HTMLInputElement | null;
  if (hoch && bundle) {
    hoch.addEventListener("click", () => bundle.click());
    bundle.addEventListener("change", () => {
      const f = bundle.files?.[0];
      bundle.value = "";
      const feld = document.getElementById("git-repo-name") as HTMLInputElement | null;
      if (f) void ladeBundleHoch(f, (feld?.value.trim() ?? "").replace(/[^a-z0-9-_]/gi, "-") || f.name.replace(/\.bundle$/i, ""));
    });
  }
  document.getElementById("repos-suche")?.addEventListener("input", () => zeige());
  document.querySelectorAll<HTMLButtonElement>("#repos-filter button").forEach((b) => b.addEventListener("click", () => {
    nurMeine = b.dataset.filter === "meine";
    nurNeu = b.dataset.filter === "neu";
    document.querySelectorAll("#repos-filter button").forEach((x) => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-pressed", String(x === b));
    });
    zeige();
  }));
  // Geladen wird erst beim Öffnen der Seite Repos oder eines Raums (C-15) – beim Start lud die Liste
  // sonst doppelt, wenn der erste Raum öffentlich ist (Start und merkeRaumAdresse)
}
