/**
 * Gruppenanruf im privaten Raum (B-34c1, Entscheidungen LK2–LK4 A, `docs/GRUPPENANRUF-ENTWURF.md`): Wer anruft, holt
 * bei seinem Knoten je Mitglied einen Zugang (Kind 5081, nur gekoppelt, über `wegZumKnoten()` mit frischem
 * Sitzungsschlüssel) und schickt die Einladung als inneres Event in die MLS-Gruppe (`raumGruppenanruf()`) – nie offen.
 * Gelesen werden laufende Anrufe nur über `raumGruppenanrufe()` aus den inneren Events des Raums.
 *
 * Beitreten (livekit-client, Schlüssel aus `anrufSchluessel()`, nur über TURN oder nach der IP-Warnung) und die
 * Oberfläche kommen mit B-34c2. Seit B-34e holt `signalWegVomKnoten()` den Weg des Signals über den eigenen Knoten.
 */
import {
  KIND_DVM_LIVEKIT, KIND_DVM_SIGNAL, LIVEKIT_GRENZEN, LocalSigner, baueLivekitAnfrage, baueSignalAnfrage, generateKeypair, leseLivekitZugaenge,
  leseSignalZugang, raumGruppenanruf, raumGruppenanrufe, raumGruppenanrufEnde, toHex, type InneresSenden, type LivekitAnfrage, type LivekitZugaenge,
  type RaumGruppenanruf,
} from "@freedomstack/protocol";
import { signalAdresse } from "../gruppenanruf-ablauf.js";
import { STATUS_TAKT_MS, STATUS_ZEIT_MS } from "../knoten-status-ansicht.js";
import { frageKnotenStatus, powFuerKnoten } from "./knoten-status-ui.js";
import { knotenRelay, warteAufKnoten, wegZumKnoten } from "./knoten-weg-ui.js";
import { meineKopplung } from "./mein-knoten.js";
import { mlsSendeEvent } from "./mls-konto.js";
import type { PrivaterRaum } from "./raum-mls.js";

export type GruppenanrufStart = "gestartet" | "zu-viele" | "kein-zugang" | "nicht-gesendet";

export interface GruppenanrufUmgebung {
  /** Zugänge für diesen Anruf – in der App vom eigenen Knoten. */
  zugaenge(anfrage: LivekitAnfrage): Promise<LivekitZugaenge | null>;
  /** In die Gruppe – in der App `mlsSendeEvent()`. */
  sende(gruppe: string, s: InneresSenden): Promise<boolean>;
}

/** Zugänge vom gekoppelten Knoten; ohne Kopplung oder Antwort null. */
export async function livekitZugaengeVomKnoten(anfrage: LivekitAnfrage): Promise<LivekitZugaenge | null> {
  const k = meineKopplung();
  if (!k) return null;
  const powBits = await powFuerKnoten(k.knoten);
  const sitzung = new LocalSigner(generateKeypair().sk);
  const weg = await wegZumKnoten(k.knoten, sitzung);
  if (!weg) return null;
  try {
    const { wrap, requestId } = await baueLivekitAnfrage({ sitzung, kopplung: k, raum: anfrage.raum, anzahl: anfrage.anzahl, powBits });
    await weg.publish(wrap);
    const a = await warteAufKnoten(weg, sitzung, requestId, KIND_DVM_LIVEKIT + 1000, STATUS_ZEIT_MS, STATUS_TAKT_MS);
    return a && "ergebnis" in a ? leseLivekitZugaenge(a.ergebnis, anfrage) : null;
  } finally {
    weg.schliesse();
  }
}

/**
 * Der Weg des Signals zu einem fremden Anruf über den eigenen Knoten (B-34e, LK5 A): nur mit Relay des Knotens und nur,
 * wenn sein Status die Rolle `signal` nennt – ein älterer Knoten läse 5082 als gewöhnlichen Auftrag. Dann ein Zeichen
 * für genau dieses Ziel bis zum Ablauf der Einladung; zurück die Adresse für livekit-client, sonst null.
 */
export async function signalWegVomKnoten(ziel: string, bis: number): Promise<string | null> {
  const k = meineKopplung();
  if (!k) return null;
  const [relay, status] = await Promise.all([knotenRelay(k.knoten), frageKnotenStatus(k)]);
  if (!relay || !("status" in status) || !status.status.rollen.includes("signal")) return null;
  const powBits = await powFuerKnoten(k.knoten);
  const sitzung = new LocalSigner(generateKeypair().sk);
  const weg = await wegZumKnoten(k.knoten, sitzung);
  if (!weg) return null;
  try {
    const { wrap, requestId } = await baueSignalAnfrage({ sitzung, kopplung: k, ziel, bis, powBits });
    await weg.publish(wrap);
    const a = await warteAufKnoten(weg, sitzung, requestId, KIND_DVM_SIGNAL + 1000, STATUS_ZEIT_MS, STATUS_TAKT_MS);
    const z = a && "ergebnis" in a ? leseSignalZugang(a.ergebnis) : null;
    return z ? signalAdresse(relay, z.zeichen) : null;
  } finally {
    weg.schliesse();
  }
}

const APP: GruppenanrufUmgebung = { zugaenge: livekitZugaengeVomKnoten, sende: mlsSendeEvent };

/** Einen Anruf im Raum beginnen: eine zufällige Kennung, je Mitglied (auch man selbst) ein Zugang, dann die Einladung. */
export async function starteGruppenanruf(raum: PrivaterRaum, u: GruppenanrufUmgebung = APP): Promise<GruppenanrufStart> {
  const mitglieder = [...new Set(raum.mitglieder)];
  if (mitglieder.length > LIVEKIT_GRENZEN.teilnehmer) return "zu-viele";
  const anfrage = { raum: toHex(crypto.getRandomValues(new Uint8Array(16))), anzahl: mitglieder.length };
  const z = await u.zugaenge(anfrage);
  if (!z) return "kein-zugang";
  return (await u.sende(raum.gruppe, raumGruppenanruf(raum.gruppe, z, mitglieder))) ? "gestartet" : "nicht-gesendet";
}

/** Den eigenen Anruf beenden – ein Ende von anderen zählt nicht. */
export async function beendeGruppenanruf(raum: PrivaterRaum, anruf: string, u: GruppenanrufUmgebung = APP): Promise<boolean> {
  return u.sende(raum.gruppe, raumGruppenanrufEnde(raum.gruppe, anruf));
}

/** Die laufenden Anrufe im Raum, neueste zuerst – mit meinem Zugang, wenn einer für mich dabei ist. */
export function laufendeGruppenanrufe(raum: PrivaterRaum, jetzt?: number): RaumGruppenanruf[] {
  return raumGruppenanrufe(raum.gruppe, raum.ereignisse, { ich: raum.ich, jetzt });
}
