/**
 * „Als Text“ an Sprachnachrichten (Sammlung B-38c1, SP-W1 A, SP-W5 A, `docs/SPRACHE-ENTWURF.md`): Der Browser wandelt die
 * Aufnahme selbst in WAV (`ton-wandeln.ts`), verschlüsselt sie und legt sie über den Weg zum Knoten ins Blob-Netz –
 * signiert mit einem frischen Sitzungsschlüssel, nie mit der eigenen Identität. Der Auftrag (5083) geht versiegelt mit
 * Nachweis nur an den gekoppelten Knoten (`baueSpracheAuftrag()`) und nur, wenn sein Status die Rolle `sprache` nennt –
 * ein älterer Knoten läse 5083 als gewöhnlichen Auftrag. Der Text erscheint nur als `textContent` unter dem Abspieler und
 * wird nirgends gespeichert. Diktieren im Agenten (B-38c2, `diktieren-ui.ts`) geht denselben Weg. Ist ein whisper-server
 * auf diesem Rechner geprüft (B-38c3, `sprache-lokal.ts`), geht der Ton nur dorthin – nicht zum Knoten.
 */
import {
  KIND_DVM_TEXT_AUS_SPRACHE, LocalSigner, SPRACHE_FAELLE, baueSpracheAuftrag, generateKeypair, leseTranskript, type Kopplung, type SpracheFall,
  type SpracheWahl,
} from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { ablehnungsGrund } from "../knoten-halten.js";
import { STATUS_TAKT_MS } from "../knoten-status-ansicht.js";
import { fehlerText } from "../protokoll-texte.js";
import { type TonFall, alsSpracheWav, browserDekoder } from "../ton-wandeln.js";
import { lokaleSprachAdresse, textAufDiesemGeraet } from "../sprache-lokal.js";
import { frageKnotenStatus, powFuerKnoten } from "./knoten-status-ui.js";
import { warteAufKnoten, wegZumKnoten } from "./knoten-weg-ui.js";
import { meineKopplung } from "./mein-knoten.js";
import { el } from "./ui.js";

/** So lange wartet die App auf den Text – Whisper lädt das Modell je Auftrag (B-38b1), auf der CPU dauert es. */
export const ALS_TEXT_ZEIT_MS = 180_000;

const TON_TEXT: Record<TonFall, string> = {
  "ton-unlesbar": "komm.alsTextUnlesbar", "ton-leer": "komm.alsTextLeer", "ton-lang": "komm.alsTextLang",
};

/** Je Kennung des Knotens ein eigener Satz – nie Text vom Knoten, wenn er eine Kennung nennt. */
export const SPRACHE_FALL_TEXT: Record<SpracheFall, string> = {
  "sprache-auftrag": "komm.alsTextAuftrag", "sprache-ton": "komm.alsTextTon", "sprache-wav": "komm.alsTextWav",
  "sprache-whisper": "komm.alsTextWhisper", "sprache-zeit": "komm.alsTextZeit", "sprache-belegt": "komm.alsTextBelegt",
};

/** Knoten, deren Status `sprache` nannte – nur für diese Sitzung; ein Nein fragt beim nächsten Mal erneut. */
const kannSprache = new Set<string>();

/** null, wenn der Knoten Text aus Sprache macht – sonst ein Satz, warum nicht. */
async function grundGegenKnoten(k: Kopplung): Promise<string | null> {
  if (kannSprache.has(k.knoten)) return null;
  const r = await frageKnotenStatus(k);
  if (!("status" in r)) return r.grund;
  if (!r.status.rollen.includes("sprache")) return t("komm.alsTextKeinWhisper");
  kannSprache.add(k.knoten);
  return null;
}

/** Gibt es einen Weg für Text aus Sprache – ein geprüfter Server auf diesem Rechner oder ein gekoppelter Knoten? */
export function textAusSpracheMoeglich(): boolean {
  return !!lokaleSprachAdresse(localStorage) || !!meineKopplung();
}

/**
 * Text zu einer Aufnahme – vom Server auf diesem Rechner, sonst vom eigenen Knoten – oder ein Satz, warum es keinen gibt.
 * Der Text kann leer sein (Stille); `sprache` ist `auto` für Nachrichten von Kontakten, beim Diktieren die Sprache der App.
 */
export async function textAusSprache(bytes: Uint8Array, sprache: SpracheWahl = "auto"): Promise<{ text: string } | { grund: string }> {
  const lokal = lokaleSprachAdresse(localStorage);
  const k = meineKopplung();
  if (!lokal && !k) return { grund: t("komm.alsTextOhneKnoten") };
  const dekoder = browserDekoder();
  if (!dekoder) return { grund: t("komm.alsTextUnlesbar") };
  // Erst wandeln: was der Browser nicht lesen kann, fragt weder Server noch Knoten
  const ton = await alsSpracheWav(bytes, dekoder);
  if (!ton.ok) return { grund: t(TON_TEXT[ton.fall]) };
  // Dieses Gerät geht vor: der Ton verlässt den Rechner nicht (B-38c3)
  if (lokal) {
    try {
      return { text: await textAufDiesemGeraet({ adresse: lokal, wav: ton.wav, sprache }) };
    } catch (e) {
      return { grund: fehlerText(e) };
    } finally {
      ton.wav.fill(0);
    }
  }
  if (!k) return { grund: t("komm.alsTextOhneKnoten") };
  const nein = await grundGegenKnoten(k);
  if (nein) return { grund: nein };
  const powBits = await powFuerKnoten(k.knoten);
  const sitzung = new LocalSigner(generateKeypair().sk);
  // Alles über meinen Knoten (B-9c2): mit Haken nur über sein Relay – auch der Ton
  const weg = await wegZumKnoten(k.knoten, sitzung);
  if (!weg) return { grund: t("set.knotenOhneRelay") };
  let antwort: Awaited<ReturnType<typeof warteAufKnoten>>;
  try {
    const { uploadAnhang } = await import("../blob-client.js");
    const r = await uploadAnhang(new File([ton.wav as BlobPart], "", { type: "application/octet-stream" }), weg, sitzung);
    ton.wav.fill(0);
    const { wrap, requestId } = await baueSpracheAuftrag({
      sitzung, kopplung: k, powBits,
      auftrag: { ton: { blob: r.blobId, manifest: r.manifestEventId, schluessel: r.schluessel }, sprache },
    });
    await weg.publish(wrap);
    antwort = await warteAufKnoten(weg, sitzung, requestId, KIND_DVM_TEXT_AUS_SPRACHE + 1000, ALS_TEXT_ZEIT_MS, STATUS_TAKT_MS);
  } finally {
    weg.schliesse();
  }
  if (!antwort) return { grund: t("komm.alsTextSchweigt") };
  if ("abgelehnt" in antwort) {
    const fall = antwort.fall as SpracheFall | undefined;
    return { grund: fall && SPRACHE_FAELLE.includes(fall) ? t(SPRACHE_FALL_TEXT[fall]) : t("komm.alsTextAbgelehnt", { grund: ablehnungsGrund(antwort.abgelehnt) }) };
  }
  const transkript = leseTranskript(antwort.ergebnis);
  if (!transkript) return { grund: t("komm.alsTextUnlesbarAntwort") };
  return { text: transkript.text.trim() };
}

/**
 * Den Abspieler einer Sprachnachricht um „Als Text“ ergänzen – nur mit einem Weg dafür (Server auf diesem Rechner oder
 * eigener Knoten), sonst bleibt er, wie er ist. Gefragt wird erst beim Klick; die Bytes holt `bytes()` erst dann.
 */
export function mitAlsText(ton: HTMLElement, bytes: () => Promise<Uint8Array>): HTMLElement {
  if (!textAusSpracheMoeglich()) return ton;
  const knopf = el("button", t("komm.alsText"), "ghost mini ton-als-text");
  knopf.type = "button";
  knopf.title = t("komm.alsTextTitel");
  const aus = el("div", undefined, "ton-text");
  aus.setAttribute("aria-live", "polite");
  knopf.addEventListener("click", async () => {
    knopf.disabled = true;
    aus.textContent = t("komm.alsTextLaeuft");
    try {
      // Sprachnachrichten kommen von Kontakten in jeder Sprache – Whisper erkennt sie selbst
      const r = await textAusSprache(await bytes(), "auto");
      aus.textContent = "text" in r ? r.text || t("komm.alsTextStille") : r.grund;
      aus.classList.toggle("ton-text-hinweis", !("text" in r));
    } catch (e) {
      aus.textContent = t("komm.alsTextFehler", { fehler: fehlerText(e) });
      aus.classList.add("ton-text-hinweis");
    } finally {
      knopf.disabled = false;
    }
  });
  const huelle = el("div", undefined, "ton-mit-text");
  huelle.append(ton, knopf, aus);
  return huelle;
}
