/**
 * QR-Codes in der App (Schritt 11.1b): zeigen und scannen.
 *
 * - Zeigen: ein SVG aus `qrCode()` und `qrSvgPfad()` (11.1a), nur über
 *   `createElementNS`/`setAttribute` – kein `innerHTML`, kein Bild-URL, kein
 *   Herunterladen.
 * - Geheimes (Gerätecode, trägt den Schlüssel des neuen Geräts): nur auf
 *   Klick, mit Warnung daneben, nach `QR_SICHTBAR_MS` wieder weg; gespeichert
 *   wird nichts.
 * - Scannen: Kamera nur auf Klick, erkannt von der eingebauten Erkennung des
 *   Browsers (`BarcodeDetector`, Chromium) oder – wo es sie nicht gibt
 *   (Firefox, Safari, seit A-20) – von jsQR in der App; beides im Gerät, das
 *   Bild geht nirgends hin. Ohne Kamera sagt die App das und bietet das
 *   Einfügen an. Nach dem ersten Code, beim Stoppen und beim Schließen des
 *   Dialogs ist die Kamera wieder aus.
 */
import jsQRModul from "jsqr";
import { qrCode, qrSvgPfad } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { fehlerText } from "../protokoll-texte.js";

/** So lange bleibt ein geheimer QR-Code sichtbar. */
export const QR_SICHTBAR_MS = 60_000;
const SVG_NS = "http://www.w3.org/2000/svg";
const RAND = 4;

/** Nur die Werte, die das SVG braucht – ohne DOM prüfbar. */
export function qrSvgDaten(text: string): { viewBox: string; d: string; groesse: number } {
  const q = qrCode(text);
  const g = q.groesse + 2 * RAND;
  return { viewBox: `0 0 ${g} ${g}`, d: qrSvgPfad(q, RAND), groesse: g };
}

/** Das Bild: schwarz auf weiß (Scanner brauchen den Kontrast), mit Ruhezone. */
export function qrSvg(text: string, beschriftung: string): SVGSVGElement {
  const { viewBox, d, groesse } = qrSvgDaten(text);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", beschriftung);
  svg.setAttribute("class", "qr-bild");
  svg.setAttribute("shape-rendering", "crispEdges");
  const grund = document.createElementNS(SVG_NS, "rect");
  grund.setAttribute("width", String(groesse));
  grund.setAttribute("height", String(groesse));
  grund.setAttribute("fill", "#fff");
  const pfad = document.createElementNS(SVG_NS, "path");
  pfad.setAttribute("d", d);
  pfad.setAttribute("fill", "#000");
  svg.append(grund, pfad);
  return svg;
}

function knopf(text: string, klasse: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = klasse;
  b.textContent = text;
  return b;
}

/**
 * „QR-Code zeigen“: das Bild erst auf Klick. Mit `geheim` steht die Warnung
 * schon vorher da, und das Bild verschwindet nach `QR_SICHTBAR_MS`.
 */
export function qrKnopf(text: string, o: { beschriftung: string; geheim?: boolean }): HTMLElement {
  const box = document.createElement("div");
  box.className = "qr-box";
  const zeigen = knopf(t("qr.zeigen"), "ghost qr-zeigen");
  zeigen.setAttribute("aria-expanded", "false");
  const hinweis = document.createElement("p");
  hinweis.className = "mono-sm qr-hinweis";
  hinweis.textContent = o.geheim ? t("qr.geheimWarnung") : "";
  let uhr: ReturnType<typeof setTimeout> | undefined;
  const verbirg = () => {
    clearTimeout(uhr);
    box.querySelector(".qr-bild")?.remove();
    zeigen.textContent = t("qr.zeigen");
    zeigen.setAttribute("aria-expanded", "false");
    if (o.geheim) hinweis.textContent = t("qr.geheimWarnung");
  };
  zeigen.addEventListener("click", () => {
    if (box.querySelector(".qr-bild")) return verbirg();
    try {
      box.insertBefore(qrSvg(text, o.beschriftung), hinweis);
    } catch (e) {
      hinweis.textContent = fehlerText(e); // zu lang (`qr-zu-lang`)
      return;
    }
    zeigen.textContent = t("qr.verbergen");
    zeigen.setAttribute("aria-expanded", "true");
    if (o.geheim) {
      hinweis.textContent = t("qr.verschwindet", { s: QR_SICHTBAR_MS / 1000 });
      uhr = setTimeout(verbirg, QR_SICHTBAR_MS);
    }
  });
  box.append(zeigen, hinweis);
  return box;
}

interface Erkannt { rawValue: string }
interface Erkenner { detect(bild: HTMLVideoElement): Promise<Erkannt[]> }
interface ErkennerKlasse {
  new (o: { formats: string[] }): Erkenner;
  getSupportedFormats(): Promise<string[]>;
}

const erkennerKlasse = (): ErkennerKlasse | undefined =>
  (globalThis as unknown as { BarcodeDetector?: ErkennerKlasse }).BarcodeDetector;

// jsQR ist CommonJS: je nach Umgebung kommt die Funktion selbst oder `{ default }`
type JsQr = typeof jsQRModul.default;
const jsQR: JsQr = (jsQRModul as { default?: JsQr }).default ?? (jsQRModul as unknown as JsQr);

/** So breit wird ein Einzelbild für jsQR höchstens – reicht für einen Code vor der Kamera, spart Rechenzeit. */
export const SCAN_BREITE_MAX = 640;

/** Einen QR-Code aus einem Bild (RGBA) lesen – mit jsQR, im Gerät (A-20); auch hell auf dunkel. */
export function leseQrAusBild(daten: Uint8ClampedArray, breite: number, hoehe: number): string | null {
  if (!(breite > 0 && hoehe > 0) || daten.length !== breite * hoehe * 4) return null;
  return jsQR(daten, breite, hoehe, { inversionAttempts: "attemptBoth" })?.data || null; // kein UI-Text
}

/** Ersatz für `BarcodeDetector` (A-20): ein Einzelbild aus dem Video, verkleinert, an jsQR. */
class JsQrErkenner implements Erkenner {
  private leinwand = document.createElement("canvas");
  async detect(video: HTMLVideoElement): Promise<Erkannt[]> {
    const f = Math.min(1, SCAN_BREITE_MAX / (video.videoWidth || 1));
    const b = Math.round(video.videoWidth * f);
    const h = Math.round(video.videoHeight * f);
    if (!b || !h) return [];
    this.leinwand.width = b;
    this.leinwand.height = h;
    const ctx = this.leinwand.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];
    ctx.drawImage(video, 0, 0, b, h);
    const wert = leseQrAusBild(ctx.getImageData(0, 0, b, h).data, b, h);
    return wert ? [{ rawValue: wert }] : [];
  }
}

/** Die Erkennung des Browsers, wenn sie QR kann – sonst jsQR. */
async function waehleErkenner(): Promise<Erkenner> {
  const K = erkennerKlasse();
  try {
    if (K && (await K.getSupportedFormats()).includes("qr_code")) return new K({ formats: ["qr_code"] }); // kein UI-Text
  } catch {
    // Erkennung des Browsers kaputt – jsQR
  }
  return new JsQrErkenner();
}

/** Kann diese App hier QR-Codes mit der Kamera lesen? Seit A-20 überall, wo es eine Kamera-Schnittstelle gibt. */
export async function kannScannen(): Promise<boolean> {
  return !!navigator.mediaDevices?.getUserMedia;
}

/**
 * „Mit der Kamera scannen“ für ein Eingabefeld: Der erste erkannte Code
 * landet im Feld, danach ist die Kamera aus. Ohne Erkennung ein ehrlicher
 * Hinweis – das Feld bleibt zum Einfügen.
 */
export function scanKnopf(ziel: HTMLInputElement | HTMLTextAreaElement): HTMLElement {
  const box = document.createElement("div");
  box.className = "qr-scan";
  const start = knopf(t("qr.scannen"), "ghost qr-scannen");
  start.hidden = true;
  const hinweis = document.createElement("p");
  hinweis.className = "mono-sm qr-hinweis";
  hinweis.setAttribute("aria-live", "polite");
  box.append(start, hinweis);
  void kannScannen().then((ja) => {
    start.hidden = !ja;
    if (!ja) hinweis.textContent = t("qr.keinScan");
  });

  let strom: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  const stopp = (text = "") => {
    strom?.getTracks().forEach((s) => s.stop());
    strom = null;
    video?.remove();
    video = null;
    start.textContent = t("qr.scannen");
    hinweis.textContent = text;
  };
  start.addEventListener("click", async () => {
    if (strom) return stopp();
    try {
      strom = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }); // kein UI-Text
    } catch {
      return stopp(t("qr.keineKamera"));
    }
    video = document.createElement("video");
    video.className = "qr-video";
    video.muted = true;
    video.playsInline = true;
    video.srcObject = strom;
    box.append(video);
    start.textContent = t("qr.scanStopp");
    hinweis.textContent = t("qr.halteHin");
    try {
      await video.play();
    } catch {
      return stopp(t("qr.keineKamera"));
    }
    const erkenner = await waehleErkenner();
    const schritt = async () => {
      if (!strom || !video) return;
      if (!box.isConnected) return stopp(); // Dialog geschlossen: Kamera aus
      try {
        const wert = (await erkenner.detect(video)).find((c) => c.rawValue)?.rawValue;
        if (wert) {
          ziel.value = wert;
          ziel.dispatchEvent(new Event("input", { bubbles: true }));
          stopp(t("qr.gelesen"));
          ziel.focus();
          return;
        }
      } catch {
        // Bild noch nicht bereit – beim nächsten Versuch
      }
      setTimeout(() => void schritt(), 250);
    };
    void schritt();
  });
  return box;
}
