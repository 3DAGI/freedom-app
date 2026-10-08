/**
 * USB-Strecke zum Funkgerät (7.5b): spricht Meshtastic, wenn das Gerät
 * antwortet – sonst wie bisher Rahmen mit Längenpräfix (7.4c1, eigene Firmware).
 *
 * Ein Meshtastic-Gerät bekommt jeden Rahmen als Paket an alle auf dem Kanal
 * „freedom“ (`docs/MESHTASTIC.md`). Die Firmware leitet selbst weiter – über
 * diese Strecke reicht die App nichts weiter (`leitetSelbstWeiter`), sonst ginge
 * jeder Rahmen mehrfach in die Luft. Die Sendezeit je Rahmen kommt aus dem
 * Preset des Geräts statt aus einer Annahme.
 */
import {
  FREEDOM_KANAL, LORA_MTU, LaengenRahmen, MESHTASTIC_PORT, MESHTASTIC_REGION_UNGESETZT, MeshtasticStrom, baueFunkPaket,
  baueKonfigAnfrage, leseVomGeraet, meshtasticSendezeit, mitLaenge, mitMeshtasticKopf, type VomGeraet,
} from "@freedomstack/protocol";
import { t } from "./i18n.js";
import type { MeshTransport, SerialPortLike } from "./mesh-radio.js";

/** Was das Gerät über sich sagt – für die Hinweise in der Oberfläche. */
export interface MeshtasticStand {
  /** Index des Kanals „freedom“ mit unserem Schlüssel; null: fehlt. */
  kanal: number | null;
  /** Es gibt einen Kanal „freedom“ mit anderem Schlüssel – den lesen die anderen nicht. */
  kanalFremd: boolean;
  region: number;
  hopLimit: number;
  senden: boolean;
  preset: number;
  vorgabe: boolean;
}

export type SerielleStrecke = MeshTransport & { meshtastic?: MeshtasticStand };

/** Hop-Limit der Firmware, wenn das Gerät keines nennt (`HOP_RELIABLE`). */
const HOP_STANDARD = 3;
/** Weckt ein schlafendes Gerät und bringt seinen Leser in Tritt (wie die Python-Bibliothek). */
const WECKEN = new Uint8Array(32).fill(0xc3);

const gleich = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

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
  const konfigId = o.konfigId ?? (crypto.getRandomValues(new Uint32Array(1))[0]! || 1);
  const stand: MeshtasticStand = { kanal: null, kanalFremd: false, region: 0, hopLimit: 0, senden: false, preset: 0, vorgabe: true };
  let modus = "suche" as "suche" | "meshtastic" | "laenge";
  let belegt = false; // eine Nachricht, wie sie nur ein Meshtastic-Gerät schickt
  const strom = new MeshtasticStrom();
  const laenge = new LaengenRahmen();
  const vorher: Uint8Array[] = [];
  let erkannt: () => void = () => {};
  const entschieden = new Promise<void>((r) => { erkannt = r; });
  const anfrage = () => writer.write(Uint8Array.from([...WECKEN, ...mitMeshtasticKopf(baueKonfigAnfrage(konfigId))]));

  const verarbeite = (v: VomGeraet): void => {
    if (v.art === "ich") belegt = true;
    else if (v.art === "lora") {
      Object.assign(stand, { region: v.region, hopLimit: v.hopLimit, senden: v.senden, preset: v.preset, vorgabe: v.vorgabe });
      belegt = true;
    } else if (v.art === "kanal") {
      belegt = true;
      if (v.name !== FREEDOM_KANAL.name || v.rolle === 0) return;
      if (gleich(v.psk, FREEDOM_KANAL.psk)) stand.kanal = v.index;
      else stand.kanalFremd = true;
    } else if (v.art === "fertig" && v.id === konfigId && modus === "suche") {
      modus = "meshtastic";
      erkannt();
    } else if (v.art === "neustart") void anfrage().catch(() => { /* getrennt */ });
    else if (v.art === "paket" && modus === "meshtastic" && v.port === MESHTASTIC_PORT && stand.kanal !== null && v.kanal === stand.kanal) {
      onFrame?.(v.nutzlast);
    }
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
          if (v) verarbeite(v);
        }
      }
    } catch { /* getrennt */ }
  })();

  await anfrage();
  const takt = setInterval(() => { if (modus === "suche") void anfrage().catch(() => { /* getrennt */ }); }, o.wiederholMs ?? 2_000);
  const frist = setTimeout(() => {
    if (modus !== "suche") return;
    // Meshtastic ohne Ende der Einstellungen (alte Firmware?) bleibt Meshtastic
    if (belegt) modus = "meshtastic";
    else {
      modus = "laenge";
      for (const c of vorher) for (const f of laenge.push(c)) onFrame?.(f);
    }
    erkannt();
  }, o.suchMs ?? 10_000);
  await entschieden;
  clearInterval(takt);
  clearTimeout(frist);
  vorher.length = 0;

  const meshtastic = modus === "meshtastic";
  return {
    kind: "seriell",
    name: meshtastic ? t("bau.meshtasticUsb") : t("bau.usbFunk"),
    ...(meshtastic ? { meshtastic: stand, leitetSelbstWeiter: true, sendezeit: (n: number) => meshtasticSendezeit(stand, n) } : {}),
    async send(frame: Uint8Array) {
      // Ein zu großer Rahmen ist schlimmer als ein Fehler: Das Gerät verwirft ihn still.
      if (frame.length > LORA_MTU) throw new Error(t("bau.rahmenZuGross", { n: frame.length, max: LORA_MTU }));
      if (!meshtastic) return writer.write(mitLaenge(frame));
      if (stand.kanal === null) throw new Error(t("bau.meshtasticOhneKanal"));
      await writer.write(mitMeshtasticKopf(baueFunkPaket({ kanal: stand.kanal, hopLimit: stand.hopLimit || HOP_STANDARD, nutzlast: frame })));
    },
    async close() {
      try {
        await reader.cancel();
        reader.releaseLock();
        writer.releaseLock();
        await port.close();
      } catch { /* schon getrennt */ }
    },
  };
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
