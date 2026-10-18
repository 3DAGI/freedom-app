/**
 * Gruppenanruf im privaten Raum (B-34c1, Entscheidungen LK2–LK4 A, `docs/GRUPPENANRUF-ENTWURF.md`): Wer anruft, holt
 * bei seinem Knoten je Mitglied einen Zugang (Kind 5081, nur gekoppelt, über `wegZumKnoten()` mit frischem
 * Sitzungsschlüssel) und schickt die Einladung als inneres Event in die MLS-Gruppe (`raumGruppenanruf()`) – nie offen.
 * Gelesen werden laufende Anrufe nur über `raumGruppenanrufe()` aus den inneren Events des Raums.
 *
 * Beitreten (livekit-client, Schlüssel aus `anrufSchluessel()`, nur über TURN oder nach der IP-Warnung) und die
 * Oberfläche kommen mit B-34c2.
 */
import {
  KIND_DVM_LIVEKIT, LIVEKIT_GRENZEN, LocalSigner, baueLivekitAnfrage, generateKeypair, leseLivekitZugaenge, raumGruppenanruf,
  raumGruppenanrufe, raumGruppenanrufEnde, toHex, type InneresSenden, type LivekitAnfrage, type LivekitZugaenge, type RaumGruppenanruf,
} from "@freedomstack/protocol";
import { STATUS_TAKT_MS, STATUS_ZEIT_MS } from "../knoten-status-ansicht.js";
import { powFuerKnoten } from "./knoten-status-ui.js";
import { warteAufKnoten, wegZumKnoten } from "./knoten-weg-ui.js";
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
