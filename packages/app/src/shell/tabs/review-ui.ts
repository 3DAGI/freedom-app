/**
 * Reviews an Patches (Schritt C-20g2, Sammlung C-20): Kommentare an Zeilen
 * des Diffs und eine Bewertung „genehmigt“ / „Änderungen erbeten“ – wie bei
 * GitHub. Format aus C-20g1 (`review.ts`, `docs/PROTOCOL.md` 19). Öffentlich
 * signiert, im privaten Raum nur als inneres Event der Gruppe (`sendeInRaum()`).
 * Eine Bewertung ändert den Status nie – annehmen bleibt bei Eigentümer und
 * Maintainern (`darfAnnehmen()`).
 *
 * Nur DOM und `textContent` – Kommentare kommen von Fremden.
 */
import { KIND_KOMMENTAR, type Bewertung, type GelesenerZeilenKommentar, type KommentarBezug, type Zeilenbezug } from "@freedomstack/protocol";
import { gebietsschema, t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import type { PatchReview } from "../../repo-ansicht.js";
import { dialog } from "../dialog.js";
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

function knopf(text: string, klasse: string, tun: () => void): HTMLButtonElement {
  const b = el("button", text, klasse);
  b.type = "button";
  b.addEventListener("click", tun);
  return b;
}

const datum = (s: number) => new Date(s * 1000).toLocaleDateString(gebietsschema(), { day: "numeric", month: "short", year: "numeric" });

export interface ReviewAngaben {
  patch: KommentarBezug;
  review: PatchReview;
  /** Gruppe des privaten Raums – dann geht alles nur dorthin. */
  privatRaum?: string;
  name: (pk: string) => string;
  neuLaden: () => Promise<void>;
}

/** Was die Patch-Seite für den Diff braucht. */
export interface ReviewAnsicht {
  /** Stand der Bewertungen und die Knöpfe dazu – über den Änderungen. */
  kopf: HTMLElement;
  /** Kommentare an dieser Zeile, oder nichts. */
  faden(z: Zeilenbezug): HTMLElement | null;
  /** Neuer Kommentar an einer Zeile – nur mit Identität. */
  kommentieren?: (z: Zeilenbezug) => void;
  /** Kommentare an Zeilen, die im Diff nicht stehen (gekürzt oder geändert). */
  rest(gezeigt: ReadonlySet<string>): HTMLElement | null;
}

/** Schlüssel einer Zeile – Seite, Nummer, Pfad. */
export const zeilenSchluessel = (z: Zeilenbezug): string => `${z.seite}:${z.zeile}:${z.pfad}`; // kein UI-Text

const BEWERTUNG_TEXT: Record<Bewertung, string> = { genehmigt: "review.genehmigt", aenderungen: "review.aenderungen" };

export function reviewAnsicht(r: ReviewAngaben): ReviewAnsicht {
  const faeden = new Map<string, GelesenerZeilenKommentar[]>();
  for (const k of r.review.zeilen) {
    const s = zeilenSchluessel(k.zeile);
    faeden.set(s, [...(faeden.get(s) ?? []), k]);
  }
  const ich = state.keypair?.pk;
  const fadenEl = (liste: GelesenerZeilenKommentar[], ort?: string): HTMLElement => {
    const box = el("div", undefined, "review-faden");
    if (ort) box.append(el("div", ort, "mono-sm"));
    for (const k of liste) {
      const eintrag = el("div", undefined, "review-kommentar");
      eintrag.append(el("div", t("repo.patchVon", { name: r.name(k.autor), datum: datum(k.zeit) }), "mono-sm muted"), markdownDom(k.text, "issue-text", { umbrueche: true }));
      box.append(eintrag);
    }
    // Antworten bleiben an derselben Zeile und hängen am ersten Kommentar des Fadens
    const erster = liste[0]!;
    if (ich) {
      box.append(knopf(t("review.antworten"), "ghost mini review-antworten", () => void zeileSchreiben(r, erster.zeile, { id: erster.id, autor: erster.autor, kind: KIND_KOMMENTAR })));
    }
    return box;
  };
  return {
    kopf: kopf(r, ich),
    faden: (z) => {
      const liste = faeden.get(zeilenSchluessel(z));
      return liste?.length ? fadenEl(liste) : null;
    },
    ...(ich ? { kommentieren: (z: Zeilenbezug) => void zeileSchreiben(r, z) } : {}),
    rest: (gezeigt) => {
      const uebrig = [...faeden.entries()].filter(([s]) => !gezeigt.has(s));
      if (!uebrig.length) return null;
      const box = el("section", undefined, "review-rest");
      box.append(el("h4", t("review.ausserhalb"), "issue-abschnitt"));
      for (const [, liste] of uebrig) {
        const z = liste[0]!.zeile;
        box.append(fadenEl(liste, t(z.seite === "alt" ? "review.ortAlt" : "review.ort", { pfad: z.pfad, zeile: z.zeile })));
      }
      return box;
    },
  };
}

function kopf(r: ReviewAngaben, ich: string | undefined): HTMLElement {
  const box = el("section", undefined, "review-kopf");
  const b = r.review.bewertungen;
  const zahl = (w: Bewertung) => b.filter((x) => x.bewertung === w).length;
  const titel = el("h4", t("review.titel"), "issue-abschnitt");
  titel.append(el("span", b.length ? t("review.stand", { genehmigt: zahl("genehmigt"), aenderungen: zahl("aenderungen") }) : t("review.keine"), "mono-sm muted"));
  box.append(titel);
  for (const x of b) {
    const zeile = el("div", undefined, "review-bewertung");
    zeile.dataset.bewertung = x.bewertung;
    const wer = el("div", undefined, "mono-sm");
    wer.append(el("span", r.name(x.autor)), el("span", t(BEWERTUNG_TEXT[x.bewertung]), `review-${x.bewertung}`));
    if (x.maintainer) wer.append(el("span", t("review.maintainer"), "msg-role"));
    wer.append(el("span", datum(x.zeit), "muted"));
    zeile.append(wer);
    if (x.text) zeile.append(markdownDom(x.text, "issue-text", { umbrueche: true }));
    box.append(zeile);
  }
  // Die eigene Bewertung des Patch-Autors zählt nicht (C-20g1) – also keine Knöpfe für ihn
  if (ich && ich !== r.patch.autor) {
    const knoepfe = el("div", undefined, "review-knoepfe");
    knoepfe.append(knopf(t("review.genehmigen"), "ghost mini review-genehmigen", () => void bewerten(r, "genehmigt")),
      knopf(t("review.aenderungenErbitten"), "ghost mini review-aendern", () => void bewerten(r, "aenderungen")));
    box.append(knoepfe);
  }
  return box;
}

async function frageText(r: ReviewAngaben, titel: string, ok: string, pflicht: boolean, hinweis?: string): Promise<string | null> {
  const datenschutz = t(r.privatRaum ? "repo.kommentarHinweisRaum" : "repo.kommentarHinweis");
  const w = await dialog({
    titel, ok, text: hinweis ? `${hinweis} ${datenschutz}` : datenschutz,
    felder: [{ art: "textarea", name: "text", label: t(pflicht ? "review.text" : "review.begruendung"), pflicht }],
  });
  if (!w) return null;
  return typeof w.text === "string" ? w.text.trim() : "";
}

async function zeileSchreiben(r: ReviewAngaben, zeile: Zeilenbezug, eltern?: KommentarBezug): Promise<void> {
  const titel = t(zeile.seite === "alt" ? "review.ortAlt" : "review.ort", { pfad: zeile.pfad, zeile: zeile.zeile });
  const text = await frageText(r, titel, t("repo.kommentieren"), true);
  if (!text || !state.keypair) return;
  await sende(r, async () => {
    const { baueZeilenKommentar, raumRepoZeilenKommentar } = await import("@freedomstack/protocol");
    const k = { patch: r.patch, zeile, text, ...(eltern ? { eltern } : {}) };
    // Privater Raum: nur in die Gruppe – scheitert laut, statt aufs Relay auszuweichen
    if (r.privatRaum) await sendeInRaum(r.privatRaum, raumRepoZeilenKommentar(r.privatRaum, k));
    else await (await ensurePool()).publish(await signiere(baueZeilenKommentar(k, state.keypair!.pk)));
  });
}

async function bewerten(r: ReviewAngaben, bewertung: Bewertung): Promise<void> {
  const text = await frageText(r, t(bewertung === "genehmigt" ? "review.genehmigen" : "review.aenderungenErbitten"), t("review.senden"),
    bewertung === "aenderungen", t("review.bewertungHinweis"));
  if (text === null || !state.keypair) return;
  await sende(r, async () => {
    const { baueBewertung, raumRepoBewertung } = await import("@freedomstack/protocol");
    const b = { patch: r.patch, bewertung, text };
    if (r.privatRaum) await sendeInRaum(r.privatRaum, raumRepoBewertung(r.privatRaum, b));
    else await (await ensurePool()).publish(await signiere(baueBewertung(b, state.keypair!.pk)));
  });
}

async function sende(r: ReviewAngaben, tun: () => Promise<void>): Promise<void> {
  try {
    await tun();
    toast(t("repo.kommentarGesendet"));
    await r.neuLaden();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}
