/**
 * Direktnachrichten an alle Geraete einer Person (Schritt 8.6b, Entscheidung
 * MENSCH 26.09.2026).
 *
 * Ein Geraet hat einen eigenen Schluessel (Vollmacht 38070 der Hauptidentitaet,
 * `devices.ts`). An die Hauptidentitaet versiegelte Nachrichten kann es nicht
 * oeffnen. Deshalb versiegelt der Absender dieselbe Nachricht an die Person
 * UND an jedes ihrer Geraete mit dem Recht „nachrichten“ – und seine eigene
 * Kopie an sich und seine eigenen Geraete (`buildPrivateDm`, Feld
 * `weitereEmpfaenger`). Im Inneren nennt `p` immer die Person; wer fuer
 * weitere Schluessel liest, sagt es `openPrivateDm` (`auchFuer`).
 *
 * Schreibt ein Geraet, ist der Absender sein Geraeteschluessel. Die Apps der
 * Kontakte ordnen ihn ueber die Vollmacht der Person zu (`absenderPerson`);
 * nach einem Entzug gilt, was vorher kam, danach nichts mehr.
 *
 * GRENZEN: Vollmachten sind oeffentlich – wer sie liest, sieht, welche
 * Schluessel Geraete einer Person sind. Ein Entzug erreicht nur, wer ihn sieht;
 * bis dahin versiegeln Absender weiter an das entzogene Geraet.
 */
import type { NostrEvent } from "./event.js";
import { KIND_DEVICE_GRANT, checkDeviceEvent, listDevices, parseDeviceGrant, type DeviceGrant } from "./devices.js";

const HEX64 = /^[0-9a-f]{64}$/;

/** Aktive Geraete einer Person mit dem Recht „nachrichten“ – sie bekommen eine eigene Kopie. */
export function nachrichtenGeraete(person: string, geraeteEvents: readonly NostrEvent[], nowSecs?: number): string[] {
  return listDevices(person, [...geraeteEvents], { nowSecs })
    .filter((d) => d.status === "aktiv" && d.permissions.has("nachrichten") && HEX64.test(d.devicePubkey))
    .map((d) => d.devicePubkey);
}

/**
 * Alle Geraete, die eine Person je bevollmaechtigt hat – auch entzogene und
 * abgelaufene: Was sie vorher schrieben, bleibt lesbar (`auchFuer`).
 */
export function alleGeraete(person: string, geraeteEvents: readonly NostrEvent[]): string[] {
  return listDevices(person, [...geraeteEvents]).map((d) => d.devicePubkey).filter((pk) => HEX64.test(pk));
}

export interface AbsenderZuordnung {
  /** Die Person, fuer die gesprochen wird – ohne gueltige Vollmacht der Absender selbst. */
  person: string;
  /**
   * Gesetzt, wenn eine Vollmacht den Absender als Geraet nennt. `entzogen`:
   * Das Geraet ist inzwischen entzogen – „vorher geschrieben“ stuetzt sich dann
   * nur auf den Zeitstempel des Absenders, und den kann ein Dieb zurueckdatieren.
   */
  geraet?: { pk: string; label: string; eigentuemer: string; entzogen: boolean };
  gueltig: boolean;
  grund: string;
}

/**
 * Wer steckt hinter diesem Absender? Er selbst – oder, wenn eine Vollmacht
 * ihn als Geraet mit „nachrichten“ nennt, dessen Hauptidentitaet. Nach einem
 * Entzug zaehlt nur, was vorher entstand.
 *
 * Vollmachten kann jeder fuer jeden fremden Schluessel ausstellen. Nennen
 * mehrere Personen dasselbe Geraet, gilt die eine, die `bevorzugt` (etwa
 * Kontakte) – sonst keine: Ein Fremder soll ein Geraet weder uebernehmen noch
 * unzuordenbar machen koennen, wenn der Empfaenger den echten Eigentuemer kennt.
 */
export function absenderPerson(
  absender: string, zeit: number, geraeteEvents: readonly NostrEvent[],
  opts: { nowSecs?: number; bevorzugt?: (pk: string) => boolean } = {},
): AbsenderZuordnung {
  const vollmachten = new Map<string, DeviceGrant>();
  for (const ev of geraeteEvents) {
    if (ev.kind !== KIND_DEVICE_GRANT) continue;
    try {
      const g = parseDeviceGrant(ev);
      const alt = vollmachten.get(g.ownerPubkey);
      if (g.devicePubkey === absender && (!alt || g.createdAt > alt.createdAt)) vollmachten.set(g.ownerPubkey, g);
    } catch { /* unvollstaendige Vollmacht */ }
  }
  if (vollmachten.size === 0) return { person: absender, gueltig: true, grund: "eigener Schlüssel" };
  let eigentuemer = [...vollmachten.keys()];
  if (eigentuemer.length > 1 && opts.bevorzugt) eigentuemer = eigentuemer.filter(opts.bevorzugt);
  if (eigentuemer.length !== 1) return { person: absender, gueltig: false, grund: "Gerät nicht eindeutig einer Person zugeordnet" };
  const person = eigentuemer[0]!;
  const g = vollmachten.get(person)!;
  const geraete = listDevices(person, [...geraeteEvents], { nowSecs: opts.nowSecs });
  const entzogen = geraete.some((d) => d.devicePubkey === absender && d.status === "entzogen");
  const geraet = { pk: absender, label: g.label, eigentuemer: person, entzogen };
  const pruefung = checkDeviceEvent({ pubkey: absender, created_at: zeit } as NostrEvent, "nachrichten", geraete, new Map([[absender, g]]));
  return pruefung.valid
    ? { person, geraet, gueltig: true, grund: pruefung.reason }
    : { person: absender, geraet, gueltig: false, grund: pruefung.reason };
}
