/**
 * Beitreten zu einem Gruppenanruf – die Regeln ohne Browser (B-34c2, LK3 A, LK4 A, `docs/GRUPPENANRUF-ENTWURF.md`):
 *
 * - **Weg (LK4 A):** mit eigenem Vermittler (TURN, 5079) nur über ihn (`iceTransportPolicy: "relay"`) – der SFU des
 *   Anrufenden sieht dann nur die Adresse des eigenen TURN. Ohne eigenen nur nach Zustimmung (`zugestimmt`): dann sieht
 *   der Knoten des Anrufenden die IP-Adresse; die App sagt das vor dem Beitritt.
 * - **Schlüssel (LK3 A):** je MLS-Epoche einer aus `anrufSchluessel()`, im Ring von livekit-client unter dem Index
 *   `epoche % SCHLUESSEL_RING` – Bild und Ton aus der vorigen Epoche bleiben lesbar, bis alle nachgezogen haben.
 */
import type { TurnZugang } from "@freedomstack/protocol";
import { iceServerAus } from "./anruf-ablauf.js";

/** Plätze im Schlüsselring (livekit-client `keyringSize`; der Index reist mit jedem Frame). */
export const SCHLUESSEL_RING = 16;

export type BeitrittsWeg = { art: "turn"; rtc: RTCConfiguration } | { art: "direkt"; rtc: RTCConfiguration };

/** Wie man zum SFU kommt – oder `"warnung"`: ohne eigenen TURN erst nach Zustimmung. */
export function beitrittsWeg(eigenerTurn: TurnZugang | null, zugestimmt: boolean): BeitrittsWeg | "warnung" {
  if (eigenerTurn) return { art: "turn", rtc: { iceServers: [iceServerAus(eigenerTurn)], iceTransportPolicy: "relay" } };
  return zugestimmt ? { art: "direkt", rtc: {} } : "warnung";
}

/** Index des Schlüssels einer Epoche im Ring. */
export function schluesselIndex(epoche: number): number {
  if (!Number.isSafeInteger(epoche) || epoche < 0) throw new RangeError("Epoche"); // kein UI-Text
  return epoche % SCHLUESSEL_RING;
}
