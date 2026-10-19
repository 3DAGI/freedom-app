/**
 * Beitreten zu einem Gruppenanruf – die Regeln ohne Browser (B-34c2, LK3 A, LK4 A, `docs/GRUPPENANRUF-ENTWURF.md`):
 *
 * - **Zustimmung (LK4 A, Befund B-34d, LK5 A):** Die Signalverbindung von livekit-client (WebSocket) geht ohne eigenen Knoten
 *   direkt zum SFU des Anrufenden – sein Knoten sieht die IP-Adresse also auch dann, wenn Bild und Ton über den eigenen
 *   TURN laufen. Seit B-34e reicht der eigene Knoten sie weiter (5082, `signal`). Ohne Rückfrage tritt die App einem
 *   fremden Anruf nur bei, wenn beides über den eigenen Knoten geht – Signal und Bild und Ton (`zustimmungNoetig()`);
 *   beim eigenen läuft der SFU auf dem eigenen Knoten.
 * - **Weg:** mit eigenem Vermittler (TURN, 5079) Bild und Ton nur über ihn (`iceTransportPolicy: "relay"`), sonst direkt;
 *   das Signal über `signal` (Adresse aus `signalAdresse()`), sonst direkt zur Adresse aus der Einladung.
 * - **Schlüssel (LK3 A):** je MLS-Epoche einer aus `anrufSchluessel()`, im Ring von livekit-client unter dem Index
 *   `epoche % SCHLUESSEL_RING` – Bild und Ton aus der vorigen Epoche bleiben lesbar, bis alle nachgezogen haben.
 */
import { SIGNAL_PFAD, type TurnZugang } from "@freedomstack/protocol";
import { iceServerAus } from "./anruf-ablauf.js";

/** Plätze im Schlüsselring (livekit-client `keyringSize`; der Index reist mit jedem Frame). */
export const SCHLUESSEL_RING = 16;

export type BeitrittsWeg = { art: "turn" | "direkt"; rtc: RTCConfiguration; signal: string | null };

/**
 * Ob die App vor dem Beitritt fragen muss: bei jedem Anruf, den nicht ich selbst (`ich`, MLS-Schlüssel) begonnen habe –
 * außer Signal und Bild und Ton gehen beide über den eigenen Knoten (`weg`, B-34e).
 */
export function zustimmungNoetig(a: { von: string }, ich: string, weg?: BeitrittsWeg): boolean {
  return a.von !== ich && !(weg?.art === "turn" && weg.signal !== null);
}

/** Wie Bild und Ton zum SFU kommen (eigener Vermittler) und wohin das Signal geht (Weiterleitung des eigenen Knotens). */
export function beitrittsWeg(eigenerTurn: TurnZugang | null, signal: string | null = null): BeitrittsWeg {
  return eigenerTurn
    ? { art: "turn", rtc: { iceServers: [iceServerAus(eigenerTurn)], iceTransportPolicy: "relay" }, signal }
    : { art: "direkt", rtc: {}, signal };
}

/**
 * Die Adresse für livekit-client über den eigenen Knoten (B-34e, `docs/PROTOCOL.md` §41): Relay des Knotens
 * (`ws://` oder `wss://`, ohne Pfad) plus `/signal/<zeichen>` – livekit-client hängt `/rtc/v1` an. Sonst null.
 */
export function signalAdresse(relay: string, zeichen: string): string | null {
  if (!/^[0-9a-f]{64}$/.test(zeichen)) return null;
  let u: URL;
  try {
    u = new URL(relay);
  } catch {
    return null;
  }
  if ((u.protocol !== "wss:" && u.protocol !== "ws:") || u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) return null;
  return `${u.protocol}//${u.host}${SIGNAL_PFAD}${zeichen}`;
}

/** Index des Schlüssels einer Epoche im Ring. */
export function schluesselIndex(epoche: number): number {
  if (!Number.isSafeInteger(epoche) || epoche < 0) throw new RangeError("Epoche"); // kein UI-Text
  return epoche % SCHLUESSEL_RING;
}
