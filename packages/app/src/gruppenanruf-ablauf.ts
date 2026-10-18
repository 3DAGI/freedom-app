/**
 * Beitreten zu einem Gruppenanruf – die Regeln ohne Browser (B-34c2, LK3 A, LK4 A, `docs/GRUPPENANRUF-ENTWURF.md`):
 *
 * - **Zustimmung (LK4 A, Befund B-34d):** Die Signalverbindung von livekit-client (WebSocket) geht immer direkt zum SFU
 *   des Anrufenden – sein Knoten sieht die IP-Adresse also auch dann, wenn Bild und Ton über den eigenen TURN laufen.
 *   Einem fremden Anruf tritt die App deshalb nur nach Zustimmung bei (`zustimmungNoetig()`); beim eigenen läuft der SFU
 *   auf dem eigenen Knoten.
 * - **Weg:** mit eigenem Vermittler (TURN, 5079) Bild und Ton nur über ihn (`iceTransportPolicy: "relay"`), sonst direkt.
 * - **Schlüssel (LK3 A):** je MLS-Epoche einer aus `anrufSchluessel()`, im Ring von livekit-client unter dem Index
 *   `epoche % SCHLUESSEL_RING` – Bild und Ton aus der vorigen Epoche bleiben lesbar, bis alle nachgezogen haben.
 */
import type { TurnZugang } from "@freedomstack/protocol";
import { iceServerAus } from "./anruf-ablauf.js";

/** Plätze im Schlüsselring (livekit-client `keyringSize`; der Index reist mit jedem Frame). */
export const SCHLUESSEL_RING = 16;

export type BeitrittsWeg = { art: "turn"; rtc: RTCConfiguration } | { art: "direkt"; rtc: RTCConfiguration };

/** Ob die App vor dem Beitritt fragen muss: bei jedem Anruf, den nicht ich selbst (`ich`, MLS-Schlüssel) begonnen habe. */
export function zustimmungNoetig(a: { von: string }, ich: string): boolean {
  return a.von !== ich;
}

/** Wie Bild und Ton zum SFU kommen – erst nach der Zustimmung gefragt. */
export function beitrittsWeg(eigenerTurn: TurnZugang | null): BeitrittsWeg {
  return eigenerTurn ? { art: "turn", rtc: { iceServers: [iceServerAus(eigenerTurn)], iceTransportPolicy: "relay" } } : { art: "direkt", rtc: {} };
}

/** Index des Schlüssels einer Epoche im Ring. */
export function schluesselIndex(epoche: number): number {
  if (!Number.isSafeInteger(epoche) || epoche < 0) throw new RangeError("Epoche"); // kein UI-Text
  return epoche % SCHLUESSEL_RING;
}
