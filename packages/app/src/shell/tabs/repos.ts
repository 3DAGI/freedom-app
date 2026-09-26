/**
 * Repositories nach NIP-34 (Schritt 8.10b): Repo ankuendigen, Patch senden,
 * Patches mit Status, annehmen oder schliessen als Maintainer, zurueckziehen
 * als Autor. Oeffentlich und signiert – wie bei jedem Git-Projekt; andere
 * Nostr-Clients (ngit, gitworkshop) lesen dieselben Events.
 *
 * Die Liste wird mit DOM-Aufrufen und textContent gebaut, nie per innerHTML:
 * Namen, Betreffe und Adressen kommen von Fremden.
 */
import type { GelesenerPatch, GelesenesRepo } from "@freedomstack/protocol";
import { pkShort } from "../../shell-logic.js";
import { type PatchAktion, STATUS_TEXT, patchZeilen, repoZeilen } from "../../repo-ansicht.js";
import { ensurePool, signiere, state } from "../state.js";
import { $, toast } from "../ui.js";

const AKTION_TEXT: Record<PatchAktion, string> = { annehmen: "annehmen", schliessen: "schließen", zurueckziehen: "zurückziehen" };
const STATUS_KINDS = [1630, 1631, 1632, 1633];

let repos: GelesenesRepo[] = [];
/** Fuer welches Repo gerade eine Patch-Datei gewaehlt wird. */
let patchZiel: GelesenesRepo | null = null;

function el(tag: string, text?: string, klasse?: string): HTMLElement {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

function knopf(text: string, fn: () => void): HTMLButtonElement {
  const b = el("button", text, "ghost") as HTMLButtonElement;
  b.style.cssText = "width:auto;padding:3px 8px;margin-left:4px";
  b.addEventListener("click", fn);
  return b;
}

/** Repos, Patches und Status laden und zeigen. */
export async function ladeNip34Repos(): Promise<void> {
  const box = document.getElementById("nip34-liste");
  if (!box) return;
  try {
    const pool = await ensurePool();
    const { KIND_REPO_ANKUENDIGUNG, KIND_PATCH } = await import("@freedomstack/protocol");
    repos = repoZeilen(await pool.query({ kinds: [KIND_REPO_ANKUENDIGUNG], limit: 100 }));
    if (repos.length === 0) {
      box.textContent = "Noch keine Repos nach NIP-34 – kündige das erste an.";
      return;
    }
    const patches = await pool.query({ kinds: [KIND_PATCH], "#a": repos.map((r) => r.adresse), limit: 300 });
    const status = patches.length ? await pool.query({ kinds: STATUS_KINDS, "#e": patches.map((p) => p.id), limit: 1000 }) : [];
    box.replaceChildren(...repos.map((r) => repoBlock(r, patchZeilen(r, patches, status, state.keypair?.pk))));
  } catch {
    box.textContent = "Relays nicht erreichbar";
  }
}

function repoBlock(r: GelesenesRepo, zeilen: ReturnType<typeof patchZeilen>): HTMLElement {
  const block = el("div");
  block.style.marginBottom = "10px";
  const kopf = el("div", undefined, "stat");
  const titel = el("span", `📦 ${r.name} `, "k");
  titel.append(el("span", pkShort(r.eigentuemer), "mono-sm"));
  const rechts = el("span");
  rechts.append(knopf("Patch senden", () => waehlePatch(r)));
  kopf.append(titel, rechts);
  block.append(kopf);
  if (r.beschreibung) block.append(el("div", r.beschreibung, "mono-sm muted"));
  if (r.klon.length) block.append(el("div", `Klonen: ${r.klon.join(" · ")}`, "mono-sm muted"));
  for (const z of zeilen) {
    const zeile = el("div", undefined, "usage-row");
    const links = el("span", `${z.patch.betreff} `);
    links.append(el("span", pkShort(z.patch.autor), "muted"));
    const st = el("span", STATUS_TEXT[z.status]);
    for (const a of z.aktionen) st.append(knopf(AKTION_TEXT[a], () => void setzeStatus(r, z.patch, a)));
    zeile.append(links, st);
    block.append(zeile);
  }
  if (zeilen.length === 0) block.append(el("div", "Keine Patches.", "mono-sm muted"));
  return block;
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
    if (!confirm(`Patch „${betreff}“ an ${r.name} senden?\n\nÖffentlich und mit deinem Schlüssel signiert – wie bei jedem Git-Projekt.`)) return;
    await (await ensurePool()).publish(await signiere(bauePatch({ repo: r, text }, state.keypair.pk)));
    toast(`Patch gesendet: ${betreff}`);
    await ladeNip34Repos();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

async function setzeStatus(r: GelesenesRepo, patch: GelesenerPatch, aktion: PatchAktion): Promise<void> {
  if (!state.keypair) return;
  try {
    const { baueStatus } = await import("@freedomstack/protocol");
    let commits: string[] | undefined;
    if (aktion === "annehmen") {
      const c = prompt("Als welcher Commit eingespielt? (SHA-1, leer lassen, wenn noch nicht)")?.trim();
      if (c === undefined) return;
      commits = c ? [c.toLowerCase()] : undefined;
    }
    const status = aktion === "annehmen" ? "angenommen" : "geschlossen";
    await (await ensurePool()).publish(await signiere(baueStatus({ patch, status, eigentuemer: r.eigentuemer, commits }, state.keypair.pk)));
    toast(aktion === "annehmen" ? "Patch angenommen" : aktion === "zurueckziehen" ? "Patch zurückgezogen" : "Patch geschlossen");
    await ladeNip34Repos();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/** Repo ankuendigen: Kennung und Klon-Adressen (auch ein Radicle-Spiegel rad:…). */
async function kuendigeAn(): Promise<void> {
  if (!state.keypair) return;
  const id = ($("#nip34-id") as HTMLInputElement).value.trim();
  const klon = ($("#nip34-klon") as HTMLInputElement).value.split(",").map((k) => k.trim()).filter(Boolean);
  try {
    const { baueRepoAnkuendigung } = await import("@freedomstack/protocol");
    const ev = baueRepoAnkuendigung({ id, name: id, klon }, state.keypair.pk);
    if (!confirm(`Repo „${id}“ ankündigen?\n\nÖffentlich und mit deinem Schlüssel signiert.`)) return;
    await (await ensurePool()).publish(await signiere(ev));
    toast(`Repo ${id} angekündigt`);
    await ladeNip34Repos();
  } catch (e) {
    toast((e as Error).message, true);
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
  void ladeNip34Repos();
}
