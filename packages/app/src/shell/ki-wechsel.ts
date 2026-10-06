/**
 * Neuer Sitzungsschlüssel je Unterhaltung (D1b2, `docs/DATENSCHUTZ-PROVIDER.md`).
 *
 * Wer eine neue Aufgabe beginnt oder eine andere Unterhaltung öffnet, fragt
 * jeden Provider danach unter einem neuen Schlüssel – über den Schlüssel kann
 * er zwei Unterhaltungen nicht verbinden. Was die bisherigen Schlüssel noch
 * schulden, begleicht die App vorher mit ihnen (ab 1 sat, `begleiche()`), damit
 * nichts offen bleibt, das später nur der neue Schlüssel zahlen könnte.
 * Ein unklarer Ausgang wird nie von selbst wiederholt.
 */
import type { LocalSigner } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import type { SessionClient } from "../session-client.js";
import { providerZahlung } from "./ki-zahlung.js";
import { quittungNachBegleichen } from "./quittungen.js";
import { kiSitzungen, state } from "./state.js";
import { toast } from "./ui.js";

/** Neue Unterhaltung: neue Schlüssel, offene Beträge der bisherigen begleichen. */
export function wechsleKiSchluessel(): void {
  const bisher = kiSitzungen.neueUnterhaltung();
  const sc = state.sessionClient;
  if (!sc || bisher.length === 0) return;
  void (async () => {
    for (const kunde of bisher) {
      for (const provider of sc.offeneVon(kunde.publicKey())) await begleiche(sc, provider, kunde);
    }
  })().catch(() => { /* beim nächsten Wechsel oder mit der nächsten Antwort an diesen Schlüssel */ });
}

/**
 * Nach der Abrechnung einer späten Antwort an einen verlassenen Schlüssel: gleich
 * begleichen – ein späterer Wechsel kommt an diesem Schlüssel nicht mehr vorbei.
 */
export async function begleicheWennVerlassen(sc: SessionClient, provider: string, kunde: LocalSigner | undefined): Promise<void> {
  if (!kunde || kiSitzungen.aktuell(provider) === kunde) return;
  if (sc.offeneVon(kunde.publicKey()).includes(provider)) await begleiche(sc, provider, kunde);
}

async function begleiche(sc: SessionClient, provider: string, kunde: LocalSigner): Promise<void> {
  const { zahlung } = await providerZahlung(provider);
  if (!zahlung) return; // ohne Wallet oder Adresse bleibt es ein Beleg wie bisher
  const r = await sc.begleiche(provider, kunde, zahlung);
  if (r.unklar) toast(t("agent.zahlungUnklar"), true);
  await quittungNachBegleichen(provider, r);
}
