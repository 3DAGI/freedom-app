/**
 * Reiter „Releases“ der Repo-Seite (Schritt C-20h2, Sammlung C-20): Versionen
 * mit Titel, Notizen und dem Bundle genau dieser Version – wie bei GitHub.
 * Format aus C-20h1 (`repo-release.ts`, Kind 30063). Veröffentlichen und
 * zurückziehen nur Eigentümer und Maintainer; öffentlich signiert, im privaten
 * Raum nur in die Gruppe (`sendeInRaum()`).
 *
 * Nur DOM und `textContent` – Titel und Notizen kommen von Fremden.
 */
import { darfAnnehmen, gueltigeReleaseVersion, neuestesRepoRelease, parseGitRepoRef, type GelesenesRepoRelease } from "@freedomstack/protocol";
import { gebietsschema, t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import type { RepoKarte } from "../../repo-ansicht.js";
import { bestaetige, dialog, type Option } from "../dialog.js";
import { markdownDom } from "../markdown-ui.js";
import { sendeInRaum } from "../raum-repos.js";
import { ensurePool, signiere, state } from "../state.js";
import { toast } from "../ui.js";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, klasse?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

function knopf(text: string, klasse: string, tun: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = el("button", text, klasse);
  b.type = "button";
  b.addEventListener("click", () => tun(b));
  return b;
}

const datum = (s: number) => new Date(s * 1000).toLocaleDateString(gebietsschema(), { day: "numeric", month: "short", year: "numeric" });
const SHA1 = /^[0-9a-f]{40}$/;

export function releasesReiter(k: RepoKarte, name: (pk: string) => string, neuLaden: () => Promise<void>): HTMLElement[] {
  const ich = state.keypair?.pk;
  const pflegt = !!(ich && k.repo && darfAnnehmen(k.repo, ich));
  const liste = k.releases ?? [];
  const teile: HTMLElement[] = [];
  if (pflegt) teile.push(knopf(t("repo.neuesRelease"), "ghost mini release-neu", () => void neuesRelease(k, neuLaden)));
  if (!liste.length) return [...teile, el("p", t("repo.keineReleases"), "mono-sm muted")];
  const neuestes = neuestesRepoRelease(liste);
  return [...teile, ...liste.map((r) => releaseKarte(k, r, r === neuestes, pflegt, name, neuLaden))];
}

function releaseKarte(k: RepoKarte, r: GelesenesRepoRelease, neuestes: boolean, pflegt: boolean, name: (pk: string) => string, neuLaden: () => Promise<void>): HTMLElement {
  const box = el("section", undefined, "release-karte");
  box.append(el("h4", r.titel, "release-titel"));
  const meta = el("div", undefined, "release-meta mono-sm");
  meta.append(el("span", r.version, "release-version"));
  if (neuestes) meta.append(el("span", t("repo.releaseNeuestes"), "release-neuestes"));
  if (r.vorab) meta.append(el("span", t("repo.releaseVorab"), "msg-role"));
  meta.append(el("span", t("repo.patchVon", { name: name(r.autor), datum: datum(r.zeit) }), "muted"));
  if (r.commit) meta.append(el("span", t("repo.commitKurz", { sha: r.commit.slice(0, 7) }), "muted"));
  box.append(meta);
  if (r.notizen) box.append(markdownDom(r.notizen, "issue-text", { umbrueche: true }));
  const aktionen = el("div", undefined, "release-aktionen");
  const bundle = r.bundle;
  if (bundle) aktionen.append(knopf(t("repo.releaseBundle"), "ghost mini release-bundle", (b) => void ladeBundle(b, k, r.version, bundle)));
  if (pflegt) aktionen.append(knopf(t("repo.releaseZurueckziehen"), "ghost mini release-zurueckziehen", () => void zurueckziehen(k, r, neuLaden)));
  if (aktionen.childElementCount) box.append(aktionen);
  return box;
}

/** Das Bundle dieser Version holen und entschlüsseln – der Schlüssel steht im Release (wie im Verweis 38042). */
async function ladeBundle(b: HTMLButtonElement, k: RepoKarte, version: string, bundle: NonNullable<GelesenesRepoRelease["bundle"]>): Promise<void> {
  b.disabled = true;
  try {
    const { downloadBlob, oeffneAnhang } = await import("../../blob-client.js");
    const res = await downloadBlob(bundle.blobId, (await ensurePool()) as never);
    if (!res) {
      toast(t("agent.bundleKaputt"), true);
      return;
    }
    const bytes = await oeffneAnhang(res.bytes, bundle.schluessel);
    const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${k.id}-${version}.bundle`.replace(/[^a-z0-9._-]/gi, "-");
    a.click();
    URL.revokeObjectURL(url);
    toast(t("agent.bundleGeladen", { datei: a.download }));
  } catch (e) {
    toast(t("agent.fehlerText", { fehler: fehlerText(e) }), true);
  } finally {
    b.disabled = false;
  }
}

/** Neues Release: Version, Titel, Notizen, auf Wunsch das aktuelle Bundle und „Vorabversion“. */
async function neuesRelease(k: RepoKarte, neuLaden: () => Promise<void>): Promise<void> {
  const repo = k.repo;
  if (!repo || !state.keypair) return;
  let ref: ReturnType<typeof parseGitRepoRef> | undefined;
  try {
    ref = k.bundle ? parseGitRepoRef(k.bundle) : undefined;
  } catch { /* kaputter Verweis – dann ohne Bundle */ }
  const schluessel = ref?.schluessel;
  const optionen: Option[] = [
    ...(ref && schluessel ? [{ wert: "bundle", text: t("repo.releaseMitBundle", { version: ref.version }) }] : []),
    { wert: "vorab", text: t("repo.releaseAlsVorab") },
  ];
  const vorhanden = new Set((k.releases ?? []).map((r) => r.version));
  const w = await dialog({
    titel: t("repo.neuesRelease"), ok: t("repo.releaseVeroeffentlichen"),
    text: t(k.privatRaum ? "repo.releaseHinweisRaum" : "repo.releaseHinweis"),
    felder: [
      { art: "text", name: "version", label: t("repo.releaseVersion"), pflicht: true, mono: true },
      { art: "text", name: "titel", label: t("repo.releaseTitel"), pflicht: true },
      { art: "textarea", name: "notizen", label: t("repo.releaseNotizen") },
      { art: "mehrfach", name: "optionen", label: t("repo.releaseOptionen"), optionen, werte: ref && schluessel ? ["bundle"] : [] },
    ],
    pruefe: (werte) => {
      const v = String(werte.version ?? "").trim();
      if (!gueltigeReleaseVersion(v)) return t("pf.releaseVersion");
      return vorhanden.has(v) ? t("repo.releaseGibtEs", { version: v }) : null;
    },
  });
  if (!w) return;
  const gewaehlt = Array.isArray(w.optionen) ? w.optionen : [];
  const version = String(w.version ?? "").trim();
  const angaben = {
    repo, version, titel: String(w.titel ?? "").trim(), notizen: String(w.notizen ?? ""),
    // Das Bundle von jetzt hält die Version fest – der Verweis 38042 zeigt morgen schon auf ein neueres
    ...(ref && schluessel && gewaehlt.includes("bundle") ? { bundle: { blobId: ref.blobId, schluessel }, ...(SHA1.test(ref.headSha) ? { commit: ref.headSha } : {}) } : {}),
    ...(gewaehlt.includes("vorab") ? { vorab: true } : {}),
  };
  try {
    const { baueRepoRelease, raumRepoRelease } = await import("@freedomstack/protocol");
    // Privater Raum: nur in die Gruppe – scheitert laut, statt aufs Relay auszuweichen
    if (k.privatRaum) await sendeInRaum(k.privatRaum, raumRepoRelease(k.privatRaum, angaben));
    else await (await ensurePool()).publish(await signiere(baueRepoRelease(angaben, state.keypair.pk)));
    toast(t("repo.releaseVeroeffentlicht", { version }));
    await neuLaden();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

async function zurueckziehen(k: RepoKarte, r: GelesenesRepoRelease, neuLaden: () => Promise<void>): Promise<void> {
  const repo = k.repo;
  if (!repo || !state.keypair) return;
  const ja = await bestaetige({
    titel: t("repo.releaseZurueckziehenFrage", { version: r.version }), ok: t("repo.releaseZurueckziehen"), gefahr: true,
    text: t(k.privatRaum ? "repo.releaseRueckzugRaum" : "repo.releaseRueckzug"),
  });
  if (!ja) return;
  try {
    const { baueRepoReleaseRueckzug, raumRepoReleaseRueckzug } = await import("@freedomstack/protocol");
    const angaben = { repo, version: r.version };
    if (k.privatRaum) await sendeInRaum(k.privatRaum, raumRepoReleaseRueckzug(k.privatRaum, angaben));
    else await (await ensurePool()).publish(await signiere(baueRepoReleaseRueckzug(angaben, state.keypair.pk)));
    toast(t("repo.releaseZurueckgezogen", { version: r.version }));
    await neuLaden();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}
