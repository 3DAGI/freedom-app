/**
 * Funk-Anbindung: die Brücke zwischen Protokoll und Gerät.
 *
 * `mesh-transport.ts` weiß, wie Nachrichten zerlegt und wieder zusammengesetzt
 * werden. Hier geht es darum, die Rahmen tatsächlich über etwas zu schicken.
 *
 * DREI WEGE, BEWUSST IN DIESER REIHENFOLGE
 *
 * 1. **Serielle Verbindung** (Web Serial): Ein per USB angeschlossenes
 *    LoRa-Gerät. Der zuverlässigste Weg und der einzige, der ohne
 *    Kopplungsdialog auskommt.
 * 2. **Bluetooth** (Web Bluetooth): Dasselbe Gerät drahtlos. Bequemer,
 *    aber auf iOS im Browser nicht verfügbar — deshalb nie der einzige Weg.
 * 3. **Datei oder QR**: Kein Funkgerät nötig. Die Rahmen werden als Datei
 *    exportiert und per Stick, Kamera oder anderem Kanal übergeben. Langsam,
 *    umständlich — und der einzige Weg, der auf jedem Gerät funktioniert.
 *
 * Weg 3 ist nicht der Notnagel, sondern die Rückfallebene, die das Versprechen
 * überhaupt einlösbar macht: „funktioniert ohne Internet" darf nicht bedeuten
 * „funktioniert, wenn du die richtige Hardware gekauft hast".
 *
 * WARUM KEIN EIGENES FUNKPROTOKOLL
 * Die Rahmen sind absichtlich rohe Bytes ohne Annahmen über das Medium. Ein
 * Meshtastic-Gerät, ein selbstgebauter LoRa-Knoten oder eine Datei auf einem
 * Stick transportieren dieselben Bytes. Alles andere hätte das Projekt an eine
 * Hardware gebunden — und damit an deren Hersteller.
 */
import {
  fragment, parseFrame, Reassembler, ForwardingCache, MeshQueue,
  MeshKind, MeshPriority, meshFeasibility, LORA_MTU, pruefeMeshInhalt, Sendezeitkonto,
  BESTAND_MARKE, buildDigest, planSync, type SyncDigest, type Link, type NostrEvent,
} from "@freedomstack/protocol";

export type TransportKind = "seriell" | "bluetooth" | "datei";

export interface MeshTransport {
  kind: TransportKind;
  name: string;
  send(frame: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface TransportAvailability {
  serial: boolean;
  bluetooth: boolean;
  /** Datei-Weg geht immer — deshalb kein Feld. */
  recommendation: TransportKind;
  note: string;
}

/**
 * Was auf diesem Gerät verfügbar ist.
 *
 * `override` nur für Tests: `navigator` ist ein Getter und lässt sich nicht
 * überschreiben — ein Test, der das versucht, prüft am Ende die Testumgebung
 * statt der Logik.
 */
export function detectTransports(override?: Record<string, unknown>): TransportAvailability {
  const n = override ?? ((globalThis as unknown as { navigator?: Record<string, unknown> }).navigator ?? {});
  const serial = "serial" in n;
  const bluetooth = "bluetooth" in n;

  if (serial) {
    return {
      serial, bluetooth, recommendation: "seriell",
      note: "USB-Gerät anschließen und verbinden — der zuverlässigste Weg.",
    };
  }
  if (bluetooth) {
    return {
      serial, bluetooth, recommendation: "bluetooth",
      note: "Funkgerät per Bluetooth koppeln.",
    };
  }
  return {
    serial, bluetooth, recommendation: "datei",
    note:
      "Dieser Browser kann keine Geräte ansprechen (auf iOS die Regel). " +
      "Nachrichten lassen sich als Datei exportieren und per Stick, Kamera " +
      "oder anderem Weg übergeben.",
  };
}

/** Serielle Verbindung zu einem LoRa-Gerät. */
export async function connectSerial(baudRate = 115200): Promise<MeshTransport> {
  const nav = navigator as unknown as {
    serial?: { requestPort(): Promise<SerialPortLike> };
  };
  if (!nav.serial) throw new Error("Dieser Browser unterstützt keine serielle Verbindung.");

  const port = await nav.serial.requestPort();
  await port.open({ baudRate });
  const writer = port.writable.getWriter();

  return {
    kind: "seriell",
    name: "USB-Funkgerät",
    async send(frame: Uint8Array) {
      if (frame.length > LORA_MTU) {
        // Sollte nie vorkommen — fragment() hält die Grenze ein. Wenn doch,
        // ist ein zu grosser Rahmen schlimmer als ein Fehler: Das Geraet
        // verwirft ihn still, und die Nachricht fehlt ohne Hinweis.
        throw new Error(`Rahmen zu groß für Funk: ${frame.length} > ${LORA_MTU} Byte`);
      }
      await writer.write(frame);
    },
    async close() {
      try {
        writer.releaseLock();
        await port.close();
      } catch { /* schon getrennt */ }
    },
  };
}

/**
 * Bluetooth-Verbindung zu einem Funkgeraet.
 *
 * Nordic-UART-Dienst, weil praktisch jedes LoRa-Geraet mit BLE ihn spricht.
 * Bluetooth ist hier nur der Weg zum Geraet – gesendet wird danach ueber Funk,
 * mit dessen Durchsatz und Sendezeit-Grenze (7.1).
 *
 * Auf iOS gibt es Web Bluetooth im Browser NICHT. Das ist kein Versehen von
 * uns, sondern eine Entscheidung von Apple — deshalb bleibt der Datei-Weg die
 * Ebene, auf die sich jeder verlassen kann.
 */
const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

/** BLE-Pakete sind klein — auch hier muss zerlegt werden. */
const BLE_CHUNK = 180;

export async function connectBluetooth(
  onFrame?: (raw: Uint8Array) => void,
): Promise<MeshTransport> {
  const nav = navigator as unknown as {
    bluetooth?: { requestDevice(o: unknown): Promise<BluetoothDeviceLike> };
  };
  if (!nav.bluetooth) {
    throw new Error(
      "Dieser Browser kann kein Bluetooth. Auf iOS ist das die Regel — " +
      "nimm den Datei-Weg.",
    );
  }

  const device = await nav.bluetooth.requestDevice({
    filters: [{ services: [NUS_SERVICE] }],
    optionalServices: [NUS_SERVICE],
  });
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(NUS_SERVICE);
  const rx = await service.getCharacteristic(NUS_RX);
  const tx = await service.getCharacteristic(NUS_TX);

  // Empfang: Das Geraet schickt Rahmen, sobald welche ankommen.
  if (onFrame) {
    await tx.startNotifications();
    tx.addEventListener("characteristicvaluechanged", (e: Event) => {
      const v = (e.target as unknown as { value: DataView }).value;
      onFrame(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    });
  }

  return {
    kind: "bluetooth",
    name: device.name ?? "Bluetooth-Geraet",
    async send(frame: Uint8Array) {
      // In BLE-Haeppchen zerlegen. Ein zu grosser Schreibvorgang wird still
      // verworfen — und die Nachricht fehlt ohne Hinweis.
      for (let off = 0; off < frame.length; off += BLE_CHUNK) {
        await rx.writeValueWithoutResponse(frame.subarray(off, off + BLE_CHUNK));
      }
    },
    async close() {
      try {
        await tx.stopNotifications?.();
        device.gatt.disconnect();
      } catch { /* schon getrennt */ }
    },
  };
}

interface BluetoothDeviceLike {
  name?: string;
  gatt: {
    connect(): Promise<{
      getPrimaryService(uuid: string): Promise<{
        getCharacteristic(uuid: string): Promise<{
          writeValueWithoutResponse(d: Uint8Array): Promise<void>;
          startNotifications(): Promise<void>;
          stopNotifications?(): Promise<void>;
          addEventListener(t: string, f: (e: Event) => void): void;
        }>;
      }>;
    }>;
    disconnect(): void;
  };
}

interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: { getWriter(): { write(d: Uint8Array): Promise<void>; releaseLock(): void } };
  readable: unknown;
}

/**
 * Datei-Transport: Rahmen sammeln und als Datei ausgeben.
 *
 * Kein Gerät nötig. Der Empfänger importiert die Datei und bekommt dieselben
 * Rahmen, die über Funk gekommen wären — die Schicht darüber merkt keinen
 * Unterschied.
 */
export function fileTransport(onBundle: (data: Uint8Array, count: number) => void): MeshTransport {
  const gesammelt: Uint8Array[] = [];
  return {
    kind: "datei",
    name: "Datei / QR",
    async send(frame: Uint8Array) {
      gesammelt.push(frame);
    },
    async close() {
      if (gesammelt.length === 0) return;
      onBundle(packBundle(gesammelt), gesammelt.length);
      gesammelt.length = 0;
    },
  };
}

/** Rahmen zu einem Datei-Buendel: Laengenpraefix je Rahmen, damit sie beim Import wieder trennbar sind. */
export function packBundle(frames: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(frames.reduce((s, f) => s + f.length + 2, 0));
  let off = 0;
  for (const f of frames) {
    out[off] = f.length >> 8;
    out[off + 1] = f.length & 0xff;
    out.set(f, off + 2);
    off += f.length + 2;
  }
  return out;
}

/** Zerlegt ein Datei-Bündel wieder in einzelne Rahmen. */
export function unpackBundle(data: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [];
  let off = 0;
  while (off + 2 <= data.length) {
    const len = (data[off] << 8) | data[off + 1];
    if (len === 0 || off + 2 + len > data.length) break;
    frames.push(data.subarray(off + 2, off + 2 + len));
    off += 2 + len;
  }
  return frames;
}

/**
 * Ein Ereignis, das der Knoten anbieten kann.
 *
 * Ohne diesen Zugriff hat der Mesh-Teil keinen Bestand — er kann einzelne
 * Nachrichten weiterreichen, aber zwei Geraete, die sich treffen, tauschen
 * nichts aus. Genau das war der Zustand vorher: eine Funktion, die behauptet
 * wurde, aber nichts tat.
 */
export type EventSource = () => NostrEvent[];

export interface MeshNodeEvents {
  /** Eine vollständige Nachricht ist angekommen. */
  onMessage: (payload: Uint8Array, kind: MeshKind) => void;
  /** Fortschritt beim Senden oder Empfangen; `wartetSekunden`: Sendezeit aufgebraucht (7.1). */
  onProgress?: (info: { sending: number; receiving: number; etaSeconds: number; wartetSekunden?: number }) => void;
  onLog?: (line: string) => void;
  /** Wie viel bei einem Treffen tatsaechlich ausgetauscht wird. */
  onSyncPlan?: (events: number, seconds: number, note: string) => void;
}

/**
 * Mesh-Knoten: sendet, empfängt und reicht weiter.
 *
 * Bündelt Warteschlange, Zusammenbau und Weiterleitung. Das Weiterreichen ist
 * dabei nicht optional: Ein Netz, in dem jeder nur sendet und empfängt, aber
 * nichts durchreicht, hat die Reichweite eines einzelnen Geräts.
 */
export class MeshNode {
  private queue = new MeshQueue();
  private reassembler = new Reassembler();
  private forwarding = new ForwardingCache();
  private transport: MeshTransport | null = null;
  private sending = false;
  private stopped = false;

  private eventSource: EventSource | null = null;
  private link: Link = "lora";
  /** Schluessel des Nutzers: Beim Senden darf keiner davon im Paket stehen (7.1). */
  private eigeneSchluessel: string[] = [];
  private wecker: (() => void) | null = null;

  /**
   * `konto`: Sendezeit ueber Funk (EU 868 MHz: 1 % je Stunde). Nur fuer Tests
   * mit kleinerem Fenster austauschbar.
   */
  constructor(
    private events: MeshNodeEvents,
    private bytesPerSecond = 200,
    private konto = new Sendezeitkonto(),
  ) {}

  setEigeneSchluessel(pks: string[]): void {
    this.eigeneSchluessel = [...pks];
  }

  /** Woher der Knoten seinen Bestand nimmt. */
  setEventSource(src: EventSource): void {
    this.eventSource = src;
  }

  get transportName(): string | null {
    return this.transport?.name ?? null;
  }

  /** Art der Verbindung – ein Funkgeraet (seriell, Bluetooth) oder der Datei-Weg. */
  get transportArt(): TransportKind | null {
    return this.transport?.kind ?? null;
  }

  async attach(t: MeshTransport): Promise<void> {
    await this.detach();
    this.transport = t;
    this.stopped = false;
    // Durchsatz und Sendezeit haengen an der Strecke. Per USB und per Bluetooth
    // spricht die App ein Funkgeraet an – beides geht danach ueber LoRa (7.1).
    this.link = t.kind === "datei" ? "datei" : "lora";
    this.bytesPerSecond = t.kind === "datei" ? 5_000_000 : 200;
    this.events.onLog?.(`verbunden: ${t.name}`);
    void this.pump();
    // Beim Verbinden den eigenen Bestand anbieten — sonst passiert bei einem
    // Treffen nichts, bis jemand von Hand etwas sendet.
    void this.announceDigest();
  }

  /**
   * Eigenen Bestand als kompakte Zusammenfassung senden.
   *
   * Rund 1 KB statt 32 KB fuer tausend Kennungen. Die Gegenseite rechnet
   * daraus aus, was sie schicken muss.
   */
  async announceDigest(): Promise<void> {
    if (!this.transport || !this.eventSource) return;
    const d = buildDigest(this.eventSource());
    const paket = new Uint8Array(1 + 4 + d.bits.length);
    paket[0] = BESTAND_MARKE;
    new DataView(paket.buffer).setUint32(1, d.count, false);
    paket.set(d.bits, 5);
    this.enqueue(paket, MeshKind.NostrEvent, MeshPriority.Nachricht, "Bestand");
  }

  /**
   * Bestand der Gegenseite verarbeiten und die Differenz einreihen.
   *
   * Sortiert nach Dringlichkeit und begrenzt auf das Zeitbudget der Strecke —
   * sonst verdraengt ein Git-Buendel die dringende Nachricht.
   */
  private handleDigest(payload: Uint8Array): void {
    if (!this.eventSource) return;
    const count = new DataView(payload.buffer, payload.byteOffset).getUint32(1, false);
    const fremd: SyncDigest = { bits: payload.subarray(5), count, since: 0 };

    const plan = planSync(this.eventSource(), fremd, {
      link: this.link,
      maxSeconds: this.link === "lora" ? 180 : 600,
      sendezeitSekunden: this.konto.frei(Date.now() / 1000),
    });
    this.events.onLog?.(plan.note);
    this.events.onSyncPlan?.(plan.send.length, plan.estimatedSeconds, plan.note);

    for (const ev of plan.send) {
      try {
        this.enqueue(
          new TextEncoder().encode(JSON.stringify(ev)),
          MeshKind.NostrEvent,
          MeshPriority.Hintergrund,
          `Abgleich ${ev.kind}`,
        );
      } catch (e) {
        // z. B. die eigene Kopie einer DM: traegt den eigenen Schluessel
        this.events.onLog?.(`nicht gesendet: ${(e as Error).message}`);
      }
    }
  }

  async detach(): Promise<void> {
    this.stopped = true;
    this.wecker?.();
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
  }

  /** Nachricht in die Warteschlange. Gibt eine ehrliche Dauer-Schätzung zurück. */
  enqueue(
    payload: Uint8Array,
    kind: MeshKind,
    priority: MeshPriority,
    label: string,
  ): { msgId: string; frames: number; etaSeconds: number; note: string } {
    // Nur Verschluesseltes und nie der eigene Schluessel (7.1).
    const pruefung = pruefeMeshInhalt(payload, kind, { eigeneSchluessel: this.eigeneSchluessel });
    if (!pruefung.ok) throw new Error(pruefung.grund);
    const machbar = meshFeasibility(payload.length, this.bytesPerSecond);
    if (!machbar.feasible) throw new Error(machbar.note);

    const m = this.queue.enqueue(payload, kind, priority, label);
    // Kommt die eigene Nachricht als Echo zurueck, wird sie nicht noch einmal gesendet.
    this.forwarding.shouldForward(m.frames[0]);
    // Zahlen VOR dem Senden festhalten: pump() laeuft synchron bis zum ersten
    // await und haette sonst schon einen Rahmen entnommen — die zurueckgegebene
    // Paketzahl waere dann um eins zu klein. Im Betrieb faellt so etwas als
    // "der Balken stimmt nicht ganz" auf und wird nie gefunden.
    const frames = m.frames.length;
    const etaSeconds = this.dauer();
    this.meldeFortschritt();
    void this.pump();
    return { msgId: m.msgId, frames, etaSeconds, note: machbar.note };
  }

  cancel(msgId: string): boolean {
    const weg = this.queue.remove(msgId);
    this.meldeFortschritt();
    return weg;
  }

  get pending(): { msgId: string; label: string; priority: MeshPriority; framesLeft: number }[] {
    return this.queue.pending;
  }

  /**
   * Empfangenen Rahmen verarbeiten.
   *
   * Wird sowohl vom Funkgerät als auch vom Datei-Import aufgerufen — die
   * Schicht darüber unterscheidet die Herkunft nicht.
   */
  receive(raw: Uint8Array, nowSecs = Math.floor(Date.now() / 1000)): void {
    const st = this.reassembler.add(raw, nowSecs);
    if (!st) return;
    this.meldeFortschritt();

    if (st.complete && st.payload) {
      this.events.onLog?.(`empfangen: ${st.total} Pakete, ${st.payload.length} Byte`);
      // Nur Verschluesseltes weitergeben – Klartext, offene Events, Ecash nie (7.1).
      const pruefung = pruefeMeshInhalt(st.payload, st.kind);
      if (!pruefung.ok) {
        this.events.onLog?.(`verworfen: ${pruefung.grund}`);
        return;
      }
      // Bestandsmeldung der Gegenseite: kein Inhalt, sondern eine Anfrage.
      if (pruefung.art === "bestand") {
        this.handleDigest(st.payload);
        return;
      }
      this.weiterreichen(st.payload, st.kind, st.priority, parseFrame(raw).ttl, nowSecs);
      this.events.onMessage(st.payload, st.kind);
    }
  }

  /**
   * Weiterreichen erst nach der Prüfung (7.1): Über das eigene Funkgerät geht
   * nur, was `pruefeMeshInhalt()` durchlässt – nie Klartext eines anderen,
   * nie der eigene Schlüssel – und über die Warteschlange, also mit
   * Sendezeit-Grenze. Bis 7.1 ging jeder Rahmen sofort und ungeprüft weiter.
   */
  private weiterreichen(payload: Uint8Array, kind: MeshKind, priority: MeshPriority, ttl: number, nowSecs: number): void {
    if (!this.transport) return;
    // Sprungzahl und Dubletten je Nachricht – am ersten Rahmen, gleich in welcher Reihenfolge sie kamen.
    if (!this.forwarding.shouldForward(fragment(payload, kind, priority, ttl)[0], nowSecs)) return;
    if (!pruefeMeshInhalt(payload, kind, { eigeneSchluessel: this.eigeneSchluessel }).ok) return;
    this.queue.enqueue(payload, kind, priority, "Weitergabe", nowSecs, ttl - 1);
    this.meldeFortschritt();
    void this.pump();
  }

  /** Mehrere Rahmen aus einem Datei-Bündel einspielen. */
  receiveBundle(data: Uint8Array): number {
    const frames = unpackBundle(data);
    for (const f of frames) {
      try {
        parseFrame(f);
        this.receive(f);
      } catch { /* kaputter Rahmen */ }
    }
    return frames.length;
  }

  /** Sendet die Warteschlange ab, im Takt der Funkgeschwindigkeit. */
  private async pump(): Promise<void> {
    if (this.sending || !this.transport || this.stopped) return;
    this.sending = true;
    try {
      for (;;) {
        if (this.stopped || !this.transport) break;
        if (!this.queue.pending.some((m) => m.framesLeft > 0)) break;
        // Sendezeit ueber Funk (7.1): hoechstens 1 % je Stunde. Geprueft mit
        // dem groessten Rahmen, bevor einer aus der Warteschlange geht.
        if (this.link === "lora") {
          const warte = this.konto.wartezeit(LORA_MTU / this.bytesPerSecond, Date.now() / 1000);
          if (warte > 0) {
            this.meldeFortschritt(warte);
            await this.schlafe(Math.min(warte, 60) * 1000);
            continue;
          }
        }
        const next = this.queue.next();
        if (!next) break;
        await this.transport.send(next.frame);
        if (this.link === "lora") this.konto.buche(next.frame.length / this.bytesPerSecond, Date.now() / 1000);
        this.meldeFortschritt();
        // Takt einhalten: Ein Funkgeraet, das zugeschuettet wird, verwirft
        // Pakete still — und die Nachricht fehlt ohne Hinweis.
        await this.schlafe((next.frame.length / this.bytesPerSecond) * 1000);
      }
    } catch (e) {
      this.events.onLog?.(`Sendefehler: ${(e as Error).message}`);
    } finally {
      this.sending = false;
    }
  }

  /** Wartet, bis `ms` um sind oder der Knoten getrennt wird. */
  private schlafe(ms: number): Promise<void> {
    return new Promise((r) => {
      const t = setTimeout(() => { this.wecker = null; r(); }, ms);
      this.wecker = () => { clearTimeout(t); this.wecker = null; r(); };
    });
  }

  /** Ehrliche Dauer: ueber Funk mit der Sendezeit-Grenze. */
  private dauer(): number {
    const sek = this.queue.estimateSeconds(this.bytesPerSecond);
    return this.link === "lora" ? this.konto.dauer(sek, Date.now() / 1000) : sek;
  }

  private meldeFortschritt(wartetSekunden?: number): void {
    this.events.onProgress?.({
      sending: this.queue.pending.reduce((s, p) => s + p.framesLeft, 0),
      receiving: this.reassembler.pending,
      etaSeconds: this.dauer(),
      ...(wartetSekunden ? { wartetSekunden: Math.ceil(wartetSekunden) } : {}),
    });
  }
}

/** Ein Nostr-Event für den Funkweg vorbereiten. */
export function eventToMesh(ev: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(ev));
}

/** Empfangene Nutzlast als Nostr-Event lesen. */
export function meshToEvent(payload: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(payload));
}

export { MeshKind, MeshPriority, fragment, parseFrame };
