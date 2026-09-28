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
import { type RepoKarte, filtereKarten, raumAuswahl, repoKarten } from "../../repo-ansicht.js";
import { bestaetige, dialog } from "../dialog.js";
import { ensurePool, signiere, state } from "../state.js";
import { toast } from "../ui.js";
import { oeffentlicheRaeume } from "./raeume.js";
import { eigentuemerName, vergissReiter, zeigeRepoSeite } from "./repo-seite.js";

const STATUS_KINDS = [1630, 1631, 1632, 1633];

let karten: RepoKarte[] = [];
/** Offenes Repo – nur im Speicher, nie in der Adresse (C.1a). */
let offenesRepo: string | null = null;
let nurMeine = false;
/** Beiträge (38056), einmal je Laden der Liste geholt – erst, wenn ein Reiter „Mitwirkende“ sie braucht. */
let beitraege: Promise<NostrEvent[]> | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, klasse?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

/** Ankündigungen, Bundle-Verweise, Patches und Status laden und zeigen. */
export async function ladeNip34Repos(): Promise<void> {
  const box = document.getElementById("repos-karten");
  if (!box) return;
  try {
    const pool = await ensurePool();
    const { KIND_REPO_ANKUENDIGUNG, KIND_PATCH, KIND_GIT_REPO_REF } = await import("@freedomstack/protocol");
    const [ankuendigungen, bundles] = await Promise.all([
      pool.query({ kinds: [KIND_REPO_ANKUENDIGUNG], limit: 100 }),
      pool.query({ kinds: [KIND_GIT_REPO_REF], limit: 50 }),
    ]);
    const adressen = ankuendigungen.map((ev) => `${KIND_REPO_ANKUENDIGUNG}:${ev.pubkey}:${ev.tags.find((x) => x[0] === "d")?.[1] ?? ""}`);
    const patches: NostrEvent[] = adressen.length ? await pool.query({ kinds: [KIND_PATCH], "#a": adressen, limit: 300 }) : [];
    const status = patches.length ? await pool.query({ kinds: STATUS_KINDS, "#e": patches.map((p) => p.id), limit: 1000 }) : [];
    // Räume, auf die Repos verweisen (11.4a): ihre Rollen bestimmen, wer mitpflegt
    const { leseRaumAdresse } = await import("@freedomstack/protocol");
    const raumIds = [...new Set(ankuendigungen.flatMap((ev) => ev.tags.filter((x) => x[0] === "a").map((x) => leseRaumAdresse(x[1])?.spaceId ?? "")).filter(Boolean))];
    karten = repoKarten(ankuendigungen, bundles, patches, status, state.keypair?.pk, await raumStruktur(raumIds));
    beitraege = null;
    zeige();
  } catch {
    box.textContent = t("repo.relaysWeg");
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
  return raumAuswahl(await raumStruktur(oeffentlicheRaeume()), state.keypair.pk);
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
    });
    if (fokus) seite.querySelector<HTMLElement>(".repo-zurueck")?.focus();
    return;
  }
  const suche = (document.getElementById("repos-suche") as HTMLInputElement | null)?.value ?? "";
  const gezeigt = filtereKarten(karten, suche, nurMeine, state.keypair?.pk);
  box.replaceChildren(...(gezeigt.length ? gezeigt.map(karte) : [el("p", t(karten.length ? "repo.nichtsGefunden" : "repo.keineRepos"), "mono-sm muted")]));
}

/** Eine Karte: Name, Eigentümer, Beschreibung, offene Patches, letzte Aktivität, Marke „Bundle“. */
function karte(k: RepoKarte): HTMLElement {
  const b = el("button", undefined, "repo-karte");
  b.type = "button";
  b.dataset.schluessel = k.schluessel;
  const kopf = el("div", undefined, "repo-karte-kopf");
  kopf.append(el("span", eigentuemerName(k.eigentuemer), "repo-eigentuemer"), el("span", " / ", "muted"), el("span", k.name, "repo-name"));
  if (k.bundle) kopf.append(el("span", t("repo.markeBundle"), "msg-role"));
  b.append(kopf);
  if (k.beschreibung) b.append(el("span", k.beschreibung, "repo-karte-text"));
  const datum = new Date(k.zuletzt * 1000).toLocaleDateString(gebietsschema(), { day: "numeric", month: "short", year: "numeric" });
  b.append(el("span", t("repo.karteFuss", { n: k.offen, datum }), "mono-sm muted"));
  b.addEventListener("click", () => {
    offenesRepo = k.schluessel;
    vergissReiter();
    zeige(true);
  });
  return b;
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
 */
export async function ladeBundleHoch(datei: File, kennung: string): Promise<boolean> {
  if (!state.keypair) return false;
  try {
    const bytes = new Uint8Array(await datei.arrayBuffer());
    const { uploadAnhang } = await import("../../blob-client.js");
    const pool = await ensurePool();
    toast(t("ein.gitPubliziere", { name: datei.name, kb: Math.round(bytes.length / 1024) }));
    const res = await uploadAnhang(new File([bytes], "", { type: "application/octet-stream" }), pool as never, state.signer!);
    const { buildGitRepoRef } = await import("@freedomstack/protocol");
    const ref = buildGitRepoRef(
      { name: kennung, blobId: res.blobId, headSha: "local", branch: "main", message: `bundle ${datei.name}`, version: Math.floor(Date.now() / 1000), schluessel: res.schluessel }, // kein UI-Text
      state.keypair.pk,
    );
    await pool.publish(await signiere(ref));
    toast(t("ein.gitPubliziert", { name: kennung, blob: res.blobId.slice(0, 8) }));
    await ladeNip34Repos();
    return true;
  } catch (e) {
    toast(t("ein.gitFehler", { fehler: fehlerText(e) }), true);
    return false;
  }
}

/** Patch senden – nach der Vorschau auf der Repo-Seite (seit C.3b1); öffentlich und signiert. */
async function sendePatch(r: GelesenesRepo, text: string): Promise<boolean> {
  if (!state.keypair) return false;
  try {
    const { bauePatch, lesePatchText } = await import("@freedomstack/protocol");
    const { betreff } = lesePatchText(text);
    await (await ensurePool()).publish(await signiere(bauePatch({ repo: r, text }, state.keypair.pk)));
    toast(t("repo.patchGesendet", { betreff }));
    return true;
  } catch (e) {
    toast(fehlerText(e), true);
    return false;
  }
}

/** Repo ankündigen: Kennung, Beschreibung und Klon-Adressen (auch ein Radicle-Spiegel rad:…). */
async function kuendigeAn(): Promise<void> {
  if (!state.keypair) return;
  const w = await dialog({
    titel: t("agent.repoAnkuendigen"), ok: t("agent.repoAnkuendigen"),
    felder: [
      { art: "text", name: "id", label: t("agent.repoKennungPh"), pflicht: true, mono: true },
      { art: "textarea", name: "beschreibung", label: t("repo.beschreibung") },
      { art: "text", name: "klon", label: t("agent.klonPh"), mono: true },
    ],
  });
  const id = String(w?.id ?? "").trim();
  if (!w || !id) return;
  const klon = String(w.klon ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  const beschreibung = String(w.beschreibung ?? "").trim();
  try {
    const { baueRepoAnkuendigung } = await import("@freedomstack/protocol");
    const ev = baueRepoAnkuendigung({ id, name: id, klon, ...(beschreibung ? { beschreibung } : {}) }, state.keypair.pk);
    if (!await bestaetige({ titel: t("agent.repoAnkuendigen"), text: t("repo.ankuendigenFrage", { id }), ok: t("agent.repoAnkuendigen") })) return;
    await (await ensurePool()).publish(await signiere(ev));
    toast(t("repo.angekuendigt", { id }));
    await ladeNip34Repos();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

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
    document.querySelectorAll("#repos-filter button").forEach((x) => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-pressed", String(x === b));
    });
    zeige();
  }));
  void ladeNip34Repos();
}
