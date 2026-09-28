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
import { type RepoKarte, filtereKarten, repoKarten } from "../../repo-ansicht.js";
import { bestaetige, dialog } from "../dialog.js";
import { ensurePool, signiere, state } from "../state.js";
import { $, toast } from "../ui.js";
import { eigentuemerName, zeigeRepoSeite } from "./repo-seite.js";

const STATUS_KINDS = [1630, 1631, 1632, 1633];

let karten: RepoKarte[] = [];
/** Offenes Repo – nur im Speicher, nie in der Adresse (C.1a). */
let offenesRepo: string | null = null;
let nurMeine = false;
/** Fuer welches Repo gerade eine Patch-Datei gewaehlt wird. */
let patchZiel: GelesenesRepo | null = null;

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
    karten = repoKarten(ankuendigungen, bundles, patches, status, state.keypair?.pk);
    zeige();
  } catch {
    box.textContent = t("repo.relaysWeg");
  }
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
      patchSenden: waehlePatch,
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
    zeige(true);
  });
  return b;
}

function waehlePatch(r: GelesenesRepo): void {
  patchZiel = r;
  ($("#nip34-patch-datei") as HTMLInputElement).click();
}

/** Patch-Datei aus `git format-patch` lesen, pruefen, nach Rueckfrage senden. */
async function sendePatch(datei: File): Promise<void> {
  const r = patchZiel;
  patchZiel = null;
  if (!r || !state.keypair) return;
  try {
    const { bauePatch, lesePatchText } = await import("@freedomstack/protocol");
    const text = await datei.text();
    const { betreff } = lesePatchText(text);
    if (!await bestaetige({ titel: t("repo.patchSenden"), text: t("repo.patchFrage", { betreff, repo: r.name }), ok: t("repo.patchSenden") })) return;
    await (await ensurePool()).publish(await signiere(bauePatch({ repo: r, text }, state.keypair.pk)));
    toast(t("repo.patchGesendet", { betreff }));
    await ladeNip34Repos();
  } catch (e) {
    toast(fehlerText(e), true);
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
  const datei = $("#nip34-patch-datei") as HTMLInputElement;
  datei.addEventListener("change", () => {
    const f = datei.files?.[0];
    datei.value = "";
    if (f) void sendePatch(f);
  });
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
