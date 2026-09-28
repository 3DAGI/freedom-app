/**
 * Die App als Geraet einer Person (Schritt 8.6c), ohne DOM.
 *
 * Beim Ausstellen einer Vollmacht zeigt die App einen Geraetecode: Person und
 * Geraeteschluessel. Auf dem anderen Geraet eingegeben, meldet sich die App
 * mit dem Geraeteschluessel an und spricht fuer die Person – aber nur, solange
 * deren Vollmacht mit „nachrichten“ gilt. Die Person steht im Code, nicht in
 * einer Vollmacht vom Relay: Vollmachten kann jeder fuer jeden Schluessel
 * ausstellen, ein Fremder soll ein Geraet nicht still an sich binden.
 */
import { listDevices, type NostrEvent } from "@freedomstack/protocol";
import { t } from "./i18n.js";
import { geraetStatusText } from "./protokoll-texte.js";

/** Fuer wen dieses Geraet spricht (Hex). Kein Geheimnis – der Schluessel liegt wie sonst im Tresor. */
export const LS_GERAET_PERSON = "freedom.geraet.person";

const PRAEFIX = "freedom-geraet:";
const HEX64 = /^[0-9a-f]{64}$/;

/** Geraetecode: Person und Geraeteschluessel – nur auf dem neuen Geraet eingeben. */
export function geraeteCode(person: string, skHex: string): string {
  if (!HEX64.test(person) || !HEX64.test(skHex)) throw new Error(t("ein.codeHex"));
  return `${PRAEFIX}${person}:${skHex}`;
}

/** Geraetecode lesen – alles andere (Hex, nsec, Merkphrase) ist kein Geraetecode. */
export function leseGeraeteCode(text: string): { person: string; skHex: string } | null {
  const roh = text.trim().toLowerCase();
  if (!roh.startsWith(PRAEFIX)) return null;
  const [person, skHex, ...rest] = roh.slice(PRAEFIX.length).split(":");
  if (rest.length > 0 || !person || !skHex || !HEX64.test(person) || !HEX64.test(skHex)) return null;
  return { person, skHex };
}

export interface GeraeteStand {
  status: "aktiv" | "abgelaufen" | "entzogen" | "fehlt";
  /** Darf dieses Geraet jetzt fuer die Person schreiben? */
  darfSchreiben: boolean;
  text: string;
}

/** Stand der eigenen Vollmacht aus den Vollmachten und Entzuegen der Person. */
export function geraeteStand(selbst: string, person: string, events: readonly NostrEvent[], nowSecs?: number): GeraeteStand {
  const d = listDevices(person, [...events], { nowSecs }).find((x) => x.devicePubkey === selbst);
  if (!d) return { status: "fehlt", darfSchreiben: false, text: t("ein.keineVollmacht") };
  if (d.status !== "aktiv") return { status: d.status === "unbekannt" ? "fehlt" : d.status, darfSchreiben: false, text: geraetStatusText(d, nowSecs) };
  return d.permissions.has("nachrichten")
    ? { status: "aktiv", darfSchreiben: true, text: t("ein.geraetStand", { name: d.label, stand: geraetStatusText(d, nowSecs) }) }
    : { status: "aktiv", darfSchreiben: false, text: t("ein.geraetOhneNachrichten", { name: d.label }) };
}
