/**
 * Labels ändern und Zuständige an Issues und Patches (Schritt C-20i2,
 * Sammlung C-20) – wie bei GitHub. Format aus C-20i1 (`repo-labels.ts`,
 * NIP-32 Kind 1985): je Namensraum der ganze Stand. Ändern dürfen nur
 * Eigentümer und Maintainer; öffentlich signiert, im privaten Raum nur in die
 * Gruppe (`sendeInRaum()`).
 *
 * Nur DOM und `textContent` – Labels kommen von Fremden.
 */
import type { LabelArt } from "@freedomstack/protocol";
import { t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import { dialog } from "../dialog.js";
import { sendeInRaum } from "../raum-repos.js";
import { ensurePool, signiere, state } from "../state.js";
import { toast } from "../ui.js";

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

// Wie beim Bauen eines Issues (`nip34.ts`) und in `repo-labels.ts`
const LABEL = /^[^\s,]{1,40}$/;
const LABELS_MAX = 20;

export interface LabelAngaben {
  /** Issue (1621) oder Patch (1617). */
  ziel: { id: string; kind: number };
  labels: readonly string[];
  zustaendige: readonly string[];
  /** Eigentümer und Maintainer dürfen ändern. */
  darf: boolean;
  /** Wer zugewiesen werden kann: Eigentümer, Maintainer, wer das Issue oder den Patch schrieb. */
  kandidaten: readonly string[];
  privatRaum?: string;
  name: (pk: string) => string;
  neuLaden: () => Promise<void>;
  /** Labels zeigt die Seite selbst schon (Issue-Seite, C-20e) – dann nur Zuständige. */
  ohneLabels?: boolean;
}

/** Zuständige (und auf Wunsch Labels) als Zeile, darunter die Knöpfe zum Ändern. */
export function labelLeiste(a: LabelAngaben): HTMLElement {
  const box = el("div", undefined, "label-leiste mono-sm");
  if (!a.ohneLabels) {
    const zeile = el("p", undefined, "label-zeile");
    zeile.append(el("span", t("repo.labels"), "muted"), ...(a.labels.length ? a.labels.map((l) => el("span", l, "msg-role issue-label")) : [el("span", t("repo.keine"))]));
    box.append(zeile);
  }
  const zust = el("p", undefined, "label-zeile label-zustaendig");
  zust.append(el("span", t("repo.zustaendig"), "muted"), el("span", a.zustaendige.length ? a.zustaendige.map(a.name).join(", ") : t("repo.niemand")));
  box.append(zust);
  if (a.darf && state.keypair) {
    const knoepfe = el("div", undefined, "label-knoepfe");
    knoepfe.append(knopf(t("repo.labelsBearbeiten"), "ghost mini labels-bearbeiten", () => void labelsBearbeiten(a)),
      knopf(t("repo.zustaendigeWaehlen"), "ghost mini zustaendige-waehlen", () => void zustaendigeWaehlen(a)));
    box.append(knoepfe);
  }
  return box;
}

const hinweis = (a: LabelAngaben) => t(a.privatRaum ? "repo.labelHinweisRaum" : "repo.labelHinweis");

async function labelsBearbeiten(a: LabelAngaben): Promise<void> {
  const w = await dialog({
    titel: t("repo.labelsBearbeiten"), ok: t("repo.labelSpeichern"), text: hinweis(a),
    felder: [{ art: "text", name: "labels", label: t("repo.issueLabels"), wert: a.labels.join(", ") }],
    pruefe: (werte) => {
      const liste = String(werte.labels ?? "").split(",").map((l) => l.trim()).filter(Boolean);
      return liste.every((l) => LABEL.test(l)) && new Set(liste).size <= LABELS_MAX ? null : t("repo.labelsUngueltig", { n: LABELS_MAX });
    },
  });
  if (!w) return;
  await sende(a, "labels", String(w.labels ?? "").split(",").map((l) => l.trim()).filter(Boolean));
}

async function zustaendigeWaehlen(a: LabelAngaben): Promise<void> {
  const kandidaten = [...new Set([...a.kandidaten, ...a.zustaendige])];
  const w = await dialog({
    titel: t("repo.zustaendigeWaehlen"), ok: t("repo.labelSpeichern"), text: hinweis(a),
    felder: [{ art: "mehrfach", name: "wer", label: t("repo.zustaendig"), optionen: kandidaten.map((pk) => ({ wert: pk, text: a.name(pk) })), werte: [...a.zustaendige] }],
  });
  if (!w) return;
  await sende(a, "zustaendig", Array.isArray(w.wer) ? w.wer : []);
}

/** Den ganzen Stand senden – öffentlich signiert, im privaten Raum nur in die Gruppe. */
async function sende(a: LabelAngaben, art: LabelArt, werte: string[]): Promise<void> {
  if (!state.keypair) return;
  try {
    const { baueLabelStand, raumRepoLabels } = await import("@freedomstack/protocol");
    const angaben = { ziel: a.ziel, art, werte };
    // Privater Raum: nur in die Gruppe – scheitert laut, statt aufs Relay auszuweichen
    if (a.privatRaum) await sendeInRaum(a.privatRaum, raumRepoLabels(a.privatRaum, angaben));
    else await (await ensurePool()).publish(await signiere(baueLabelStand(angaben, state.keypair.pk)));
    toast(t(art === "labels" ? "repo.labelsGespeichert" : "repo.zustaendigeGespeichert"));
    await a.neuLaden();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}
