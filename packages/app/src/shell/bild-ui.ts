/**
 * Bild eines Programms vom eigenen Knoten (VKg2b, Entscheidung VKg-W1/W2, `docs/VIBECODEN-ENTWURF.md` VKg2): Programme
 * ohne Web – Spiele, Fenster – laufen auf dem Knoten auf einem virtuellen Bildschirm; die App zeigt das Bild und schickt
 * Zeiger, Berührung, Rad und Tasten zurück. Wie ein Anruf (B-13) nur über den eigenen Vermittler: Zugang über
 * `eigenerTurnZugang()` (5079), `iceTransportPolicy: "relay"`, im Angebot nur Relay-Kandidaten (`nurRelaySdp()`,
 * `istBildSdp()`). Angebot und Antwort reisen versiegelt in der Code-Aktion `bild`; der Knoten sieht so nie die IP des
 * Geräts. Eingaben gehen nur über den Datenkanal `eingabe` (`eingabeText()`), nie etwas anderes.
 */
import { istBildSdp, type Kopplung } from "@freedomstack/protocol";
import { iceServerAus, nurRelaySdp } from "../anruf-ablauf.js";
import {
  BILD_ZEIT_MS, SAMMELN_MS, bildGroesse, eingabeText, gehtInsBild, knopfImBild, zeigerAnteil, type BildEingabe,
} from "../bild-ablauf.js";
import { t } from "../i18n.js";
import { eigenerTurnZugang } from "./anruf.js";
import type { frageKnotenCode } from "./knoten-code-ui.js";
import { el } from "./ui.js";

/** Kandidaten sammeln, bis die Sammlung endet oder kurz nach dem ersten Relay-Kandidaten – höchstens `SAMMELN_MS.hoechstens`. */
function sammle(pc: RTCPeerConnection): Promise<void> {
  return new Promise((fertig) => {
    if (pc.iceGatheringState === "complete") return fertig();
    const uhr = setTimeout(fertig, SAMMELN_MS.hoechstens);
    const ende = () => { clearTimeout(uhr); fertig(); };
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") ende(); });
    pc.addEventListener("icecandidate", (e) => { if (e.candidate && / typ relay /.test(e.candidate.candidate)) setTimeout(ende, SAMMELN_MS.nachRelay); });
  });
}

/**
 * Das Bild in `ziel` zeigen – zurück eine Funktion, die es beendet (Verbindung zu, `bild-ende` an den Knoten). Fehler und
 * Ablehnungen des Knotens stehen als Text in `ziel`.
 */
export function zeigeBild(ziel: HTMLElement, projekt: string, k: Kopplung, frage: typeof frageKnotenCode): () => void {
  const status = el("p", t("set.bildVerbindet"), "mono-sm projekt-bild-status");
  status.setAttribute("role", "status");
  const video = el("video", undefined, "projekt-bild-video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.tabIndex = 0;
  video.setAttribute("aria-label", t("set.bildVideo", { name: projekt }));
  const tastatur = el("input", undefined, "projekt-bild-tastatur");
  tastatur.setAttribute("aria-label", t("set.bildTastatur"));
  tastatur.setAttribute("autocomplete", "off");
  tastatur.setAttribute("autocapitalize", "off");
  const tastaturKnopf = el("button", t("set.bildTastaturKnopf"), "ghost projekt-bild-tastatur-knopf");
  tastaturKnopf.type = "button";
  const vollKnopf = el("button", t("set.bildVoll"), "ghost projekt-bild-voll");
  vollKnopf.type = "button";
  const leiste = el("div", undefined, "projekt-bild-leiste");
  leiste.append(tastaturKnopf, vollKnopf, tastatur);
  const rahmen = el("div", undefined, "projekt-bild");
  rahmen.append(video, leiste);
  ziel.replaceChildren(el("p", t("set.bildText")), status, rahmen);

  let pc: RTCPeerConnection | null = null;
  let kanal: RTCDataChannel | null = null;
  let vorbei = false;
  const sende = (e: BildEingabe): void => {
    const text = eingabeText(e);
    if (text && kanal?.readyState === "open") kanal.send(text);
  };
  const stelle = (ev: { clientX: number; clientY: number }) =>
    zeigerAnteil({ x: ev.clientX, y: ev.clientY }, video.getBoundingClientRect(), { breite: video.videoWidth, hoehe: video.videoHeight });

  // Zeiger und Berührung: Bewegung höchstens einmal je Bild, Knöpfe sofort
  let wartet: { x: number; y: number } | null = null;
  video.addEventListener("pointermove", (ev) => {
    const p = stelle(ev);
    if (!p) return;
    if (!wartet) requestAnimationFrame(() => { if (wartet) sende({ t: "b", ...wartet }); wartet = null; });
    wartet = p;
  });
  for (const [art, t_] of [["pointerdown", "d"], ["pointerup", "u"]] as const) {
    video.addEventListener(art, (ev) => {
      const p = stelle(ev), k_ = knopfImBild(ev.button);
      if (!p || !k_) return;
      ev.preventDefault();
      if (art === "pointerdown") video.focus();
      sende({ t: t_, ...p, k: k_ });
    });
  }
  video.addEventListener("contextmenu", (ev) => ev.preventDefault());
  video.addEventListener("wheel", (ev) => { ev.preventDefault(); sende({ t: "r", dy: Math.round(ev.deltaY) }); }, { passive: false });
  // Tasten, wenn das Bild den Fokus hat; am Handy über das Eingabefeld der Leiste
  for (const [art, t_] of [["keydown", "kd"], ["keyup", "ku"]] as const) {
    video.addEventListener(art, (ev) => {
      if (!gehtInsBild(ev.key)) return;
      ev.preventDefault();
      sende({ t: t_, s: ev.key });
    });
  }
  tastaturKnopf.addEventListener("click", () => tastatur.focus());
  tastatur.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== "Backspace") return; // kein UI-Text
    ev.preventDefault();
    sende({ t: "kd", s: ev.key });
    sende({ t: "ku", s: ev.key });
  });
  tastatur.addEventListener("input", () => {
    for (const z of tastatur.value) { sende({ t: "kd", s: z }); sende({ t: "ku", s: z }); }
    tastatur.value = "";
  });
  vollKnopf.addEventListener("click", () => void rahmen.requestFullscreen?.().catch(() => undefined));

  const fehler = (text: string): void => {
    if (vorbei) return;
    status.textContent = text;
    rahmen.hidden = true;
    pc?.close();
  };

  void (async () => {
    const zugang = await eigenerTurnZugang();
    if (vorbei) return;
    if (!zugang) return fehler(t("set.bildOhneTurn"));
    pc = new RTCPeerConnection({ iceServers: [iceServerAus(zugang)], iceTransportPolicy: "relay" });
    pc.addTransceiver("video", { direction: "recvonly" });
    kanal = pc.createDataChannel("eingabe", { ordered: true });
    pc.addEventListener("track", (e) => { video.srcObject = e.streams[0] ?? new MediaStream([e.track]); });
    pc.addEventListener("connectionstatechange", () => {
      if (!pc || vorbei) return;
      if (pc.connectionState === "connected") status.textContent = t("set.bildVerbunden");
      else if (pc.connectionState === "failed") fehler(t("set.bildAbgebrochen"));
    });
    await pc.setLocalDescription(await pc.createOffer());
    await sammle(pc);
    const sdp = pc.localDescription ? nurRelaySdp(pc.localDescription.sdp) : null;
    if (vorbei) return;
    if (!sdp || !istBildSdp(sdp)) return fehler(t("set.bildKeinWeg"));
    const r = ziel.getBoundingClientRect();
    const groesse = bildGroesse(r.width, Math.min(r.width * 0.75, window.innerHeight * 0.7), window.devicePixelRatio);
    const a = await frage(k, { aktion: "bild", projekt, sdp, ...groesse }, BILD_ZEIT_MS);
    if (vorbei) return;
    if ("grund" in a) return fehler(a.grund);
    if (a.antwort.aktion !== "bild") return fehler(t("set.statusUnlesbar"));
    await pc.setRemoteDescription({ type: "answer", sdp: a.antwort.sdp });
  })().catch(() => fehler(t("set.bildAbgebrochen")));

  return () => {
    if (vorbei) return;
    vorbei = true;
    kanal?.close();
    pc?.close();
    video.srcObject = null;
    void frage(k, { aktion: "bild-ende", projekt }, BILD_ZEIT_MS);
  };
}
