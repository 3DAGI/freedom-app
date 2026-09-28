/**
 * Reiter „Code“ (Schritt C.3c1, E4): das Bundle eines Repos in der App lesen
 * (`git-bundle.ts`) – der letzte Commit, die Dateien im obersten Ordner und
 * die README. Ordner, Dateien und Commits im Einzelnen folgen mit C.3c2.
 *
 * Geladen wird erst auf Knopfdruck – das Bundle kommt verschlüsselt aus dem
 * Speichernetz; gelesen wird nur im Speicher. Nur DOM und `textContent`:
 * Namen, Nachrichten und die README kommen von Fremden.
 */
import type { NostrEvent } from "@freedomstack/protocol";
import { BundleFehler, type BundleFehlerArt, type GelesenesBundle, commitsAb, kopfCommit, leseBaum, leseBundle } from "../../git-bundle.js";
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

/** Gelesene Bundles je Referenz (Event-Id) – nur im Speicher, höchstens drei. */
const gelesen = new Map<string, GelesenesBundle>();
const README = /^readme(\.(md|markdown|txt))?$/i;
const TEXT_MAX = 100_000;

export function codeReiter(bundle: NostrEvent | undefined, neu: () => void): HTMLElement[] {
  if (!bundle) return [el("p", t("repo.codeOhneBundle"), "mono-sm muted")];
  const b = gelesen.get(bundle.id);
  if (b) return zeigeCode(b);
  const hinweis = el("p", t("repo.codeLadenText"), "mono-sm muted");
  const fehler = el("p", undefined, "repo-fehler");
  fehler.setAttribute("role", "alert");
  const knopf = el("button", t("repo.codeLaden"), "ghost mini repo-knopf code-laden");
  knopf.type = "button";
  knopf.addEventListener("click", () => void (async () => {
    knopf.disabled = true;
    fehler.textContent = "";
    try {
      const bytes = await holeBundle(bundle);
      if (!bytes) {
        fehler.textContent = t("agent.bundleKaputt");
        return;
      }
      const gelesenesBundle = await leseBundle(bytes);
      if (gelesen.size >= 3) gelesen.delete(gelesen.keys().next().value!);
      gelesen.set(bundle.id, gelesenesBundle);
      neu();
    } catch (e) {
      fehler.textContent = e instanceof BundleFehler ? t(FEHLER[e.art]) : fehlerText(e);
    } finally {
      knopf.disabled = false;
    }
  })());
  return [hinweis, knopf, fehler];
}

function zeigeCode(b: GelesenesBundle): HTMLElement[] {
  const kopf = kopfCommit(b);
  if (!kopf) return [el("p", t("repo.keinKopf"), "mono-sm muted")];
  const [c] = commitsAb(b, kopf, 1);
  const teile: HTMLElement[] = [];
  const datum = new Date(c!.zeit * 1000).toLocaleDateString(gebietsschema(), { day: "numeric", month: "short", year: "numeric" });
  teile.push(el("div", t("repo.commitZeile", { betreff: c!.betreff, autor: c!.autor, datum, sha: kopf.slice(0, 7) }), "code-commit mono-sm"));
  const baum = b.objekte.get(c!.baum);
  if (baum?.art !== "tree") return [...teile, el("p", t("repo.bundleKaputt"), "mono-sm muted")];
  const eintraege = leseBaum(baum.daten);
  const liste = el("ul", undefined, "code-dateien");
  for (const e of eintraege) liste.append(el("li", e.art === "ordner" ? `${e.name}/` : e.name, `code-${e.art} mono`));
  teile.push(liste);
  const readme = eintraege.find((e) => e.art === "datei" && README.test(e.name));
  const daten = readme ? b.objekte.get(readme.sha)?.daten : undefined;
  if (daten && !daten.subarray(0, 8000).includes(0)) {
    teile.push(el("h4", readme!.name, "code-readme-titel"), el("pre", new TextDecoder().decode(daten.subarray(0, TEXT_MAX)), "code-readme"));
  }
  return teile;
}
