/**
 * Diskussion unter einem Issue oder Patch (Schritte C-17b2 und C-17c,
 * Sammlung C-17): die Kommentare nach NIP-22, ältester zuerst, und darunter
 * ein Feld zum Kommentieren – wie bei GitHub. Öffentlich signiert
 * (`baueKommentar()`), im privaten Raum nur als inneres Event der Gruppe
 * (`sendeInRaum(raumRepoKommentar())`) – der Hinweis unter dem Feld sagt,
 * wer mitliest.
 *
 * Nur DOM und `textContent` – Kommentare kommen von Fremden.
 */
import type { GelesenerKommentar, KommentarBezug } from "@freedomstack/protocol";
import { gebietsschema, t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
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

const datum = (s: number) => new Date(s * 1000).toLocaleDateString(gebietsschema(), { day: "numeric", month: "short", year: "numeric" });

export interface DiskussionAngaben {
  /** Issue oder Patch, unter dem diskutiert wird. */
  wurzel: KommentarBezug;
  kommentare: readonly GelesenerKommentar[];
  /** Gruppe des privaten Raums – dann geht jeder Kommentar nur dorthin. */
  privatRaum?: string;
  name: (pk: string) => string;
  neuLaden: () => Promise<void>;
}

/** Überschrift, Kommentare und – mit Identität – das Feld zum Kommentieren. */
export function diskussion(d: DiskussionAngaben): HTMLElement[] {
  const verlauf = el("div", undefined, "issue-kommentare");
  verlauf.append(...(d.kommentare.length ? d.kommentare.map((k) => {
    const box = el("div", undefined, "issue-kommentar");
    box.append(el("div", t("repo.patchVon", { name: d.name(k.autor), datum: datum(k.zeit) }), "mono-sm muted"), markdownDom(k.text, "issue-text", { umbrueche: true }));
    return box;
  }) : [el("p", t("repo.keineKommentare"), "mono-sm muted")]));
  const teile: HTMLElement[] = [el("h4", t("repo.kommentare"), "issue-abschnitt"), verlauf];
  if (state.keypair) teile.push(kommentarFeld(d));
  return teile;
}

function kommentarFeld(d: DiskussionAngaben): HTMLElement {
  const feld = el("form", undefined, "kommentar-feld");
  const id = `kommentar-${d.wurzel.id.slice(0, 12)}`; // kein UI-Text
  const label = el("label", t("repo.kommentarSchreiben"), "visually-hidden");
  label.htmlFor = id;
  const text = el("textarea", undefined, "kommentar-text");
  text.id = id;
  text.rows = 3;
  text.placeholder = t("repo.kommentarSchreiben");
  const senden = el("button", t("repo.kommentieren"), "mini kommentar-senden");
  senden.type = "submit";
  feld.append(label, text, el("p", t(d.privatRaum ? "repo.kommentarHinweisRaum" : "repo.kommentarHinweis"), "mono-sm muted"), senden);
  feld.addEventListener("submit", (e) => {
    e.preventDefault();
    void (async () => {
      const inhalt = text.value.trim();
      if (!inhalt || !state.keypair) return;
      senden.disabled = true;
      try {
        const { baueKommentar, raumRepoKommentar } = await import("@freedomstack/protocol");
        const angaben = { wurzel: d.wurzel, text: inhalt };
        // Privater Raum: nur in die Gruppe – scheitert laut, statt aufs Relay auszuweichen
        if (d.privatRaum) await sendeInRaum(d.privatRaum, raumRepoKommentar(d.privatRaum, angaben));
        else await (await ensurePool()).publish(await signiere(baueKommentar(angaben, state.keypair.pk)));
        text.value = "";
        toast(t("repo.kommentarGesendet"));
        await d.neuLaden();
      } catch (e) {
        toast(fehlerText(e), true);
      } finally {
        senden.disabled = false;
      }
    })();
  });
  return feld;
}
