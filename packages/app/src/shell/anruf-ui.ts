/**
 * Anrufe – Oberfläche (Sammlung B-13d3, Entscheidungen T1 A, T2 A, T3 B).
 * Knöpfe in der 1:1-Unterhaltung (Anrufen, Videoanruf) und eine Leiste, die
 * während eines Anrufs steht: wer, in welcher Phase, der Sicherheitscode
 * (B-4) und – bei einem eingehenden Anruf ohne eigenen Vermittler – vor dem
 * Annehmen der Hinweis, dass der Knoten der Anruferin die IP sieht (T3 B).
 *
 * Nur DOM mit `textContent`; Medien nur als Ströme an `<audio>`/`<video>`.
 * Logik und Verbindung in `anruf.ts`.
 */
import { sicherheitscode, type EndeGrund } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { beiAnruf, legeAuf, nimmAn, rufeAn, vergissAnruf, type AnrufAnsicht } from "./anruf.js";
import { pruefStand } from "./kontakt-pruefen-ui.js";
import { meineKopplung } from "./mein-knoten.js";
import { sprichtFuer } from "./state.js";
import { el, toast } from "./ui.js";

const ENDE_TEXT: Record<EndeGrund, string> = {
  aufgelegt: "komm.anrufEndeAufgelegt", abgelehnt: "komm.anrufEndeAbgelehnt", besetzt: "komm.anrufEndeBesetzt",
  zeit: "komm.anrufEndeZeit", fehler: "komm.anrufEndeFehler",
};
const GRUND_TEXT = {
  laeuft: "komm.anrufLaeuft", "kein-kontakt": "komm.anrufKeinKontakt", "kein-vermittler": "komm.anrufKeinVermittler", fehler: "komm.anrufFehler",
} as const;

/** Name eines Kontakts – aus der Liste, sonst gekürzt (nur als Text). */
async function name(pk: string): Promise<string> {
  return (await import("./tabs/raeume.js")).kontaktName(pk);
}

/** Knopf mit Symbol und Namen für Vorleser. */
function knopf(text: string, klasse: string, los: () => void): HTMLButtonElement {
  const b = el("button", text, klasse);
  b.type = "button";
  b.addEventListener("click", los);
  return b;
}

let leiste: HTMLElement | null = null;
let entferntesMedium: HTMLMediaElement | null = null;
let eigenesBild: HTMLVideoElement | null = null;

/** Die Leiste für den Zustand neu zeichnen – oder entfernen, wenn kein Anruf ist. */
async function zeichne(a: AnrufAnsicht): Promise<void> {
  const anruf = a.anruf;
  if (!anruf) {
    leiste?.remove();
    leiste = entferntesMedium = eigenesBild = null;
    return;
  }
  if (!leiste) {
    leiste = el("section", undefined, "anruf-leiste");
    leiste.setAttribute("role", "region");
    leiste.setAttribute("aria-label", t("komm.anrufAria"));
    leiste.setAttribute("aria-live", "polite");
    document.body.append(leiste);
  }
  const wer = await name(anruf.partner);
  const zeilen: HTMLElement[] = [];
  const titel = anruf.phase === "beendet" ? t(ENDE_TEXT[anruf.grund ?? "aufgelegt"])
    : anruf.phase === "eingehend" ? t(anruf.medien.includes("video") ? "komm.anrufEinVideo" : "komm.anrufEin", { name: wer })
    : anruf.phase === "klingelt" ? t("komm.anrufAus", { name: wer })
    : anruf.phase === "verbindet" ? t("komm.anrufVerbindet")
    : t("komm.anrufVerbunden", { name: wer });
  zeilen.push(el("strong", titel, "anruf-titel"));
  if (anruf.phase !== "beendet") {
    const ich = sprichtFuer();
    const code = ich ? sicherheitscode(ich, anruf.partner) : undefined;
    if (code) zeilen.push(el("div", t("komm.anrufCode", { code, stand: pruefStand(anruf.partner) }), "mono-sm"));
  }
  const knoepfe = el("div", undefined, "anruf-knoepfe");
  if (anruf.phase === "eingehend") {
    // T3 B: vor dem Annehmen sagen, wer die IP sieht – und ob es überhaupt geht
    if (anruf.fremderVermittler) zeilen.push(el("p", t("komm.anrufFremd", { name: wer }), "mono-sm warn"));
    else if (!meineKopplung()) zeilen.push(el("p", t("komm.anrufKeinWeg"), "mono-sm warn"));
    const an = knopf(t("komm.anrufAnnehmen"), "send-btn", () => void nimmAn());
    an.disabled = !anruf.fremderVermittler && !meineKopplung();
    knoepfe.append(an, knopf(t("komm.anrufAblehnen"), "ghost", () => void legeAuf("abgelehnt")));
  } else if (anruf.phase === "beendet") {
    knoepfe.append(knopf(t("komm.anrufSchliessen"), "ghost", () => vergissAnruf()));
  } else {
    knoepfe.append(knopf(t("komm.anrufAuflegen"), "ghost anruf-auflegen", () => void legeAuf("aufgelegt")));
  }
  // Medien: das Gegenüber hören (und sehen), sich selbst nur sehen – stumm
  const video = anruf.medien.includes("video");
  if (a.entfernt && anruf.phase !== "beendet") {
    if (!entferntesMedium) {
      entferntesMedium = document.createElement(video ? "video" : "audio");
      entferntesMedium.autoplay = true;
      if (entferntesMedium instanceof HTMLVideoElement) entferntesMedium.playsInline = true;
      entferntesMedium.className = video ? "anruf-video" : "anruf-ton";
    }
    if (entferntesMedium.srcObject !== a.entfernt) entferntesMedium.srcObject = a.entfernt;
  } else {
    entferntesMedium = null;
  }
  if (video && a.lokal && anruf.phase !== "beendet") {
    if (!eigenesBild) {
      eigenesBild = document.createElement("video");
      eigenesBild.autoplay = eigenesBild.muted = eigenesBild.playsInline = true;
      eigenesBild.className = "anruf-eigen";
    }
    if (eigenesBild.srcObject !== a.lokal) eigenesBild.srcObject = a.lokal;
  } else {
    eigenesBild = null;
  }
  leiste.replaceChildren(...zeilen, ...[entferntesMedium, eigenesBild].filter((m): m is HTMLMediaElement => m !== null), knoepfe);
}

/** Anrufen aus der offenen 1:1-Unterhaltung. */
async function anrufen(video: boolean): Promise<void> {
  const { activeConversation, conversations } = await import("./tabs/kommunikation.js");
  const c = conversations.find((x) => x.id === activeConversation);
  if (!c || c.type !== "dm") return toast(t("komm.anrufNur11"), true);
  const r = await rufeAn(c.id, video ? ["audio", "video"] : ["audio"]);
  if (r) toast(t(GRUND_TEXT[r]), true);
}

/** Knöpfe und Leiste (einmal beim Start) – angerufen wird nur auf Klick. */
export function wireAnrufe(): void {
  for (const [id, video] of [["chat-anruf", false], ["chat-video", true]] as const) {
    document.getElementById(id)?.addEventListener("click", () => void anrufen(video));
  }
  beiAnruf((a) => void zeichne(a));
}
