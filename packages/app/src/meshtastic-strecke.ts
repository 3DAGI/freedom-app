/**
 * Strecken zu einem Meshtastic-Gerät: USB (7.5b) und Bluetooth (7.5c). Über
 * USB spricht die App Meshtastic, wenn das Gerät antwortet – sonst wie bisher
 * Rahmen mit Längenpräfix (7.4c1, eigene Firmware).
 *
 * Ein Meshtastic-Gerät bekommt jeden Rahmen als Paket an alle auf dem Kanal
 * „freedom“ (`docs/MESHTASTIC.md`). Die Firmware leitet selbst weiter – über
 * diese Strecken reicht die App nichts weiter (`leitetSelbstWeiter`), sonst ginge
 * jeder Rahmen mehrfach in die Luft. Die Sendezeit je Rahmen kommt aus dem
 * Preset des Geräts statt aus einer Annahme.
 */
import {
  FREEDOM_KANAL, LORA_MTU, LaengenRahmen, MESHTASTIC_REGION_UNGESETZT, MeshtasticSitzung, MeshtasticStrom,
  leseVomGeraet, meshtasticSendezeit, mitLaenge, mitMeshtasticKopf, type MeshtasticStand,
} from "@freedomstack/protocol";
import { t } from "./i18n.js";
import type { MeshTransport, SerialPortLike } from "./mesh-radio.js";

export type { MeshtasticStand };

/** Eine Strecke zum Gerät; mit Meshtastic dazu Stand und „Kanal anlegen“ (7.5c). */
export type SerielleStrecke = MeshTransport & { meshtastic?: MeshtasticStand; kanalAnlegen?: () => Promise<boolean> };

/** Weckt ein schlafendes Gerät und bringt seinen Leser in Tritt (wie die Python-Bibliothek). */
const WECKEN = new Uint8Array(32).fill(0xc3);


/** Aus einer Sitzung eine Strecke für den Funkknoten (7.5c). */
function alsStrecke(s: MeshtasticSitzung, kind: "seriell" | "bluetooth", name: string, schliesse: () => Promise<void>): SerielleStrecke {
  return {
    kind, name, meshtastic: s.stand, leitetSelbstWeiter: true,
    sendezeit: (n: number) => meshtasticSendezeit(s.stand, n),
    async send(frame: Uint8Array) {
      // Ein zu großer Rahmen ist schlimmer als ein Fehler: Das Gerät verwirft ihn still.
      if (frame.length > LORA_MTU) throw new Error(t("bau.rahmenZuGross", { n: frame.length, max: LORA_MTU }));
      await s.sende(frame);
    },
    kanalAnlegen: () => s.legeKanalAn(),
    close: schliesse,
  };
}

/**
 * Fragt das Gerät nach seinen Einstellungen (`want_config_id`), alle
 * `wiederholMs` erneut – ein ESP32 startet beim Öffnen des Ports oft neu.
 * Antwortet bis `suchMs` nichts, was nur Meshtastic schickt, gilt der Weg mit
 * Längenpräfix; was bis dahin kam, wird dafür gelesen.
 */
export async function erkenneSerielleStrecke(
  port: SerialPortLike,
  onFrame?: (raw: Uint8Array) => void,
  o: { konfigId?: number; suchMs?: number; wiederholMs?: number } = {},
): Promise<SerielleStrecke> {
  const writer = port.writable.getWriter();
  const reader = port.readable.getReader();
  let geweckt = false;
  const sitzung = new MeshtasticSitzung((m) => {
    const mitKopf = mitMeshtasticKopf(m);
    const daten = geweckt ? mitKopf : Uint8Array.from([...WECKEN, ...mitKopf]);
    geweckt = true;
    return writer.write(daten);
  }, onFrame);
  let modus = "suche" as "suche" | "meshtastic" | "laenge";
  const strom = new MeshtasticStrom();
  const laenge = new LaengenRahmen();
  const vorher: Uint8Array[] = [];
  const schliesse = async () => {
    try {
      await reader.cancel();
      reader.releaseLock();
      writer.releaseLock();
      await port.close();
    } catch { /* schon getrennt */ }
  };

  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        if (modus === "laenge") {
          for (const f of laenge.push(value)) onFrame?.(f);
          continue;
        }
        if (modus === "suche") vorher.push(value);
        for (const m of strom.push(value)) {
          const v = leseVomGeraet(m);
          if (v) sitzung.verarbeite(v);
        }
      }
    } catch { /* getrennt */ }
  })();

  let zeit: ReturnType<typeof setTimeout> | undefined;
  const takt = setInterval(() => { if (modus === "suche") void sitzung.wiederhole().catch(() => { /* getrennt */ }); }, o.wiederholMs ?? 2_000);
  await Promise.race([
    sitzung.frage(o.konfigId),
    new Promise<void>((r) => { zeit = setTimeout(r, o.suchMs ?? 10_000); }),
  ]);
  clearInterval(takt);
  clearTimeout(zeit);
  // Meshtastic ohne Ende der Einstellungen (alte Firmware?) bleibt Meshtastic
  if (sitzung.aktiv || sitzung.belegt) {
    modus = "meshtastic";
    if (!sitzung.aktiv) sitzung.uebernimm();
    sitzung.aktiv = true;
    vorher.length = 0;
    return alsStrecke(sitzung, "seriell", t("bau.meshtasticUsb"), schliesse);
  }
  modus = "laenge";
  for (const c of vorher) for (const f of laenge.push(c)) onFrame?.(f);
  vorher.length = 0;
  return {
    kind: "seriell",
    name: t("bau.usbFunk"),
    async send(frame: Uint8Array) {
      if (frame.length > LORA_MTU) throw new Error(t("bau.rahmenZuGross", { n: frame.length, max: LORA_MTU }));
      await writer.write(mitLaenge(frame));
    },
    close: schliesse,
  };
}

/** Merkmal eines Bluetooth-Dienstes, so weit Meshtastic es braucht. */
export interface BleMerkmal {
  readValue(): Promise<DataView>;
  writeValueWithResponse(d: Uint8Array): Promise<void>;
  startNotifications(): Promise<void>;
  stopNotifications?(): Promise<void>;
  addEventListener(t: string, f: (e: Event) => void): void;
}

/**
 * Meshtastic über Bluetooth (7.5c): `ToRadio` ohne Kopf an „zum Gerät“, jede
 * `FromRadio` einzeln aus „vom Gerät“ lesen, bis es leer ist – nach jedem
 * Schreiben und wenn „Meldung“ eine neue Nummer meldet (wie die Python-Bibliothek).
 */
export async function meshtasticBluetooth(
  m: { zumGeraet: BleMerkmal; vomGeraet: BleMerkmal; meldung: BleMerkmal },
  name: string,
  trenne: () => void,
  onFrame?: (raw: Uint8Array) => void,
  o: { konfigId?: number; fristMs?: number } = {},
): Promise<SerielleStrecke> {
  let liest = false, nochmal = false;
  const leere = async (): Promise<void> => {
    if (liest) { nochmal = true; return; }
    liest = true;
    try {
      do {
        nochmal = false;
        for (let i = 0; i < 1000; i++) {
          const dv = await m.vomGeraet.readValue();
          if (dv.byteLength === 0) break;
          const v = leseVomGeraet(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
          if (v) sitzung.verarbeite(v);
        }
      } while (nochmal);
    } catch { /* getrennt */ } finally {
      liest = false;
    }
  };
  const sitzung = new MeshtasticSitzung(async (nachricht) => {
    await m.zumGeraet.writeValueWithResponse(nachricht);
    void leere();
  }, onFrame);
  await m.meldung.startNotifications();
  m.meldung.addEventListener("characteristicvaluechanged", () => { void leere(); });

  let zeit: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([sitzung.frage(o.konfigId), new Promise<void>((r) => { zeit = setTimeout(r, o.fristMs ?? 15_000); })]);
  clearTimeout(zeit);
  if (!sitzung.aktiv && !sitzung.belegt) {
    trenne();
    throw new Error(t("bau.meshtasticStumm"));
  }
  if (!sitzung.aktiv) sitzung.uebernimm();
  sitzung.aktiv = true;
  return alsStrecke(sitzung, "bluetooth", name, async () => {
    try {
      await m.meldung.stopNotifications?.();
      trenne();
    } catch { /* schon getrennt */ }
  });
}

/** Hinweise zum Gerät: fehlender Kanal, Region, Senden aus – leer, wenn alles passt. */
export function meshtasticHinweise(s: MeshtasticStand): string[] {
  const out: string[] = [];
  if (s.region === MESHTASTIC_REGION_UNGESETZT) out.push(t("set.meshtasticRegion"));
  else if (!s.senden) out.push(t("set.meshtasticSendenAus"));
  if (s.kanal === null) {
    const psk = btoa(String.fromCharCode(...FREEDOM_KANAL.psk));
    out.push(t(s.kanalFremd ? "set.meshtasticKanalFremd" : "set.meshtasticKanalFehlt", { name: FREEDOM_KANAL.name, psk }));
  }
  return out;
}
