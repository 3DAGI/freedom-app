/**
 * Gruppenanrufe im privaten Raum – Oberfläche (B-34d, Entscheidungen LK2–LK4 A, `docs/GRUPPENANRUF-ENTWURF.md`).
 * Ein Knopf im Kopf des Kanals ruft an (nur gekoppelt – die Zugänge kommen vom eigenen Knoten); über dem Verlauf steht je
 * laufendem Anruf des Raums eine Zeile: beitreten (Ton oder mit Bild), den eigenen beenden. Einem fremden Anruf tritt die
 * App erst nach der Rückfrage bei, dass der Knoten der anrufenden Person die IP-Adresse sieht (`zustimmungNoetig()`).
 * Im Anruf steht eine Leiste über allem (wie bei 1:1, auch auf anderen Seiten): Bild und Ton, stumm, verlassen.
 *
 * Nur DOM mit `textContent`; Bild und Ton nur als Spuren aus `beiMedien()`. livekit-client lädt erst beim Beitreten.
 */
import { LIVEKIT_GRENZEN, type RaumGruppenanruf } from "@freedomstack/protocol";
import { zustimmungNoetig } from "../gruppenanruf-ablauf.js";
import { t } from "../i18n.js";
import { bestaetige } from "./dialog.js";
import { beendeGruppenanruf, laufendeGruppenanrufe, starteGruppenanruf, type GruppenanrufStart } from "./gruppenanruf.js";
import { beiMedien, imGruppenanruf, mikrofon, trittBei, verlasse, type AnrufSpur, type Beitritt } from "./gruppenanruf-verbindung.js";
import { meineKopplung } from "./mein-knoten.js";
import type { PrivaterRaum } from "./raum-mls.js";
import { el, toast } from "./ui.js";

const START_TEXT: Record<Exclude<GruppenanrufStart, "gestartet">, string> = {
  "zu-viele": "gruppenanruf.zuViele", "kein-zugang": "gruppenanruf.keinKnotenZugang", "nicht-gesendet": "komm.nichtGesendet",
};
const BEITRITT_TEXT: Record<Exclude<Beitritt, "beigetreten">, string> = {
  warnung: "gruppenanruf.fehler", "kein-zugang": "gruppenanruf.keinZugang", "kein-schluessel": "gruppenanruf.keinSchluessel",
  besetzt: "gruppenanruf.besetzt", fehler: "gruppenanruf.fehler",
};

let ansicht: { box: HTMLElement; raum: PrivaterRaum; name: (pk: string) => string; neu: () => void } | null = null;
/** Nach dem Anrufen gleich beitreten, sobald die eigene Einladung im Raum steht. */
let gleichBeitreten: string | null = null;
let spuren: AnrufSpur[] = [];
let stumm = false;
let leiste: HTMLElement | null = null;
let medien = new Map<string, HTMLMediaElement>();

function knopf(text: string, klasse: string, los: () => void): HTMLButtonElement {
  const b = el("button", text, klasse);
  b.type = "button";
  b.addEventListener("click", los);
  return b;
}

/** Beitreten – bei einem fremden Anruf erst nach der Rückfrage. */
async function beitreten(raum: PrivaterRaum, a: RaumGruppenanruf, art: ("audio" | "video")[], name: string): Promise<void> {
  let zugestimmt = !zustimmungNoetig(a, raum.ich);
  if (!zugestimmt) {
    zugestimmt = await bestaetige({ titel: t("gruppenanruf.ipTitel"), text: t("gruppenanruf.ipText", { name }), ok: t("gruppenanruf.trotzdem") });
    if (!zugestimmt) return;
  }
  stumm = false;
  const r = await trittBei(raum.gruppe, a, { zugestimmt, medien: art }).catch((): Beitritt => "fehler");
  if (r !== "beigetreten") toast(t(BEITRITT_TEXT[r]), true);
  zeichne();
}

/** Je laufendem Anruf eine Zeile; wer drin ist, sieht „im Anruf“ statt der Knöpfe. */
function zeile(raum: PrivaterRaum, a: RaumGruppenanruf, name: (pk: string) => string): HTMLElement {
  const z = el("div", undefined, "gruppenanruf-zeile");
  z.dataset.anruf = a.anruf;
  const eigen = a.von === raum.ich;
  const wer = eigen ? t("gruppenanruf.deiner") : t("gruppenanruf.von", { name: name(a.von) });
  z.append(el("strong", wer), el("span", t("gruppenanruf.eingeladen", { n: a.teilnehmer }), "mono-sm muted"));
  const knoepfe = el("div", undefined, "gruppenanruf-knoepfe");
  if (imGruppenanruf()?.anruf === a.anruf) knoepfe.append(el("span", t("gruppenanruf.drin"), "mono-sm ok"));
  else if (a.zugang) {
    knoepfe.append(
      knopf(t("gruppenanruf.beitreten"), "ghost mini gruppenanruf-knopf", () => void beitreten(raum, a, ["audio"], name(a.von))),
      knopf(t("gruppenanruf.mitBild"), "ghost mini gruppenanruf-knopf", () => void beitreten(raum, a, ["audio", "video"], name(a.von))),
    );
  } else knoepfe.append(el("span", t("gruppenanruf.keinZugang"), "mono-sm muted"));
  if (eigen) {
    knoepfe.append(knopf(t("gruppenanruf.beenden"), "ghost mini gruppenanruf-knopf", async () => {
      if (!(await beendeGruppenanruf(raum, a.anruf))) return toast(t("komm.nichtGesendet"), true);
      if (imGruppenanruf()?.anruf === a.anruf) await verlasse();
      ansicht?.neu();
    }));
  }
  z.append(knoepfe);
  return z;
}

/** Die Anrufe des offenen privaten Raums über dem Verlauf (ohne privaten Raum: nichts); ist der Anruf beendet, verlässt die App ihn. */
export function zeigeGruppenanrufe(box: HTMLElement, raum: PrivaterRaum | null, name: (pk: string) => string, neu: () => void): void {
  ansicht = raum ? { box, raum, name, neu } : null;
  if (!raum) {
    box.replaceChildren();
    box.classList.add("hidden");
    return;
  }
  const laufend = laufendeGruppenanrufe(raum);
  const drin = imGruppenanruf();
  if (drin && drin.gruppe === raum.gruppe && !laufend.some((a) => a.anruf === drin.anruf)) void verlasse().then(zeichne);
  const meiner = gleichBeitreten === raum.gruppe ? laufend.find((a) => a.von === raum.ich && a.zugang) : undefined;
  if (meiner) {
    gleichBeitreten = null;
    void beitreten(raum, meiner, ["audio"], "");
  }
  box.replaceChildren(...laufend.map((a) => zeile(raum, a, name)));
  box.classList.toggle("hidden", laufend.length === 0);
}

/** Anrufen (Knopf im Kopf des Kanals): Zugänge vom eigenen Knoten, Einladung in die Gruppe, dann gleich beitreten. */
export async function rufeImRaumAn(raum: PrivaterRaum): Promise<void> {
  if (!meineKopplung()) return toast(t("gruppenanruf.ohneKnoten"), true);
  if (imGruppenanruf()) return toast(t("gruppenanruf.besetzt"), true);
  toast(t("gruppenanruf.startet"));
  const r = await starteGruppenanruf(raum);
  if (r !== "gestartet") return toast(t(START_TEXT[r], { n: LIVEKIT_GRENZEN.teilnehmer }), true);
  gleichBeitreten = raum.gruppe;
  ansicht?.neu();
}

/** Bild und Ton: Elemente je Spur bleiben bestehen (sonst begänne die Wiedergabe neu); den eigenen Ton nie abspielen. */
function medienAnsicht(): HTMLElement[] {
  const neu = new Map<string, HTMLMediaElement>();
  for (const s of spuren) {
    if (s.eigen && s.art === "audio") continue;
    let m = medien.get(s.spur.id);
    if (!m) {
      m = document.createElement(s.art);
      m.autoplay = true;
      if (m instanceof HTMLVideoElement) m.playsInline = m.muted = true;
      m.className = s.art === "audio" ? "gruppenanruf-ton" : s.eigen ? "anruf-eigen" : "anruf-video";
      m.srcObject = new MediaStream([s.spur]);
    }
    neu.set(s.spur.id, m);
  }
  medien = neu;
  return [...neu.values()];
}

/** Die Leiste im Anruf (über allem) und die Zeilen des offenen Raums neu zeichnen. */
function zeichne(): void {
  if (ansicht) {
    const { box, raum, name } = ansicht;
    box.replaceChildren(...laufendeGruppenanrufe(raum).map((a) => zeile(raum, a, name)));
  }
  if (!imGruppenanruf()) {
    leiste?.remove();
    leiste = null;
    medien = new Map();
    return;
  }
  if (!leiste) {
    leiste = el("section", undefined, "anruf-leiste gruppenanruf-leiste");
    leiste.setAttribute("role", "region");
    leiste.setAttribute("aria-label", t("gruppenanruf.aria"));
    leiste.setAttribute("aria-live", "polite");
    document.body.append(leiste);
  }
  const knoepfe = el("div", undefined, "anruf-knoepfe");
  knoepfe.append(
    knopf(t(stumm ? "gruppenanruf.tonAn" : "gruppenanruf.stumm"), "ghost", async () => {
      stumm = !stumm;
      await mikrofon(!stumm);
    }),
    knopf(t("gruppenanruf.verlassen"), "ghost anruf-auflegen", () => void verlasse()),
  );
  leiste.replaceChildren(el("strong", t("gruppenanruf.leiste"), "anruf-titel"), ...medienAnsicht(), knoepfe);
}

/** Einmal beim Start: Spuren aus der Verbindung in die Leiste. */
export function wireGruppenanrufe(): void {
  beiMedien((s) => {
    spuren = s ?? [];
    zeichne();
  });
}
