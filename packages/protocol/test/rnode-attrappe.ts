/**
 * Eine RNode zum Prüfen (B-32b1, B-32b2): antwortet wie die Firmware (KISS, Befehle zurückgemeldet). Mit `luft` hören
 * sich mehrere Attrappen: Was eine sendet (Datenrahmen), kommt bei den anderen an – wie über LoRa. Seit B-32d2 hier im
 * Protokoll: Die App hängt sie an WebSerial, der Knoten über eine TCP-Brücke an dieselbe Luft.
 */

/** Was die Attrappe anbietet – die Form eines `SerialPort` aus WebSerial (in der App `RNodePort`). */
export interface AttrappenPort {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

const FEND = 0xc0, FESC = 0xdb, TFEND = 0xdc, TFESC = 0xdd;
export const CMD = { DATEN: 0x00, FREQUENZ: 0x01, BANDBREITE: 0x02, LEISTUNG: 0x03, SF: 0x04, CR: 0x05, ZUSTAND: 0x06, DETECT: 0x08, LEAVE: 0x0a, ST_ALOCK: 0x0b, LT_ALOCK: 0x0c, PLATTFORM: 0x48, MCU: 0x49, FW: 0x50 };

/** Wer mithört: jede Attrappe darin bekommt die Datenrahmen der anderen. */
export type Luft = Set<(daten: number[]) => void>;

export function rnodeAttrappe(o: { firmware?: [number, number]; leistungMeldet?: number; luft?: Luft } = {}) {
  const befehle: Array<{ cmd: number; daten: number[] }> = [];
  const gesendet: number[][] = [];
  const hoere = (daten: number[]) => sende(CMD.DATEN, daten);
  let ausgabe!: ReadableStreamDefaultController<Uint8Array>;
  const sende = (cmd: number, daten: number[]) => {
    const roh: number[] = [];
    for (const b of daten) roh.push(...(b === FEND ? [FESC, TFEND] : b === FESC ? [FESC, TFESC] : [b]));
    ausgabe.enqueue(Uint8Array.from([FEND, cmd, ...roh, FEND]));
  };
  let rahmen: number[] = [];
  let esc = false;
  const antworte = (cmd: number, daten: number[]) => {
    if (cmd === CMD.DATEN) {
      gesendet.push(daten);
      for (const andere of o.luft ?? []) if (andere !== hoere) andere(daten);
      return;
    }
    befehle.push({ cmd, daten });
    if (cmd === CMD.DETECT) return sende(cmd, [0x46]);
    if (cmd === CMD.FW) return sende(cmd, o.firmware ?? [1, 82]);
    if (cmd === CMD.PLATTFORM) return sende(cmd, [0x80]);
    if (cmd === CMD.MCU) return sende(cmd, [0x81]);
    if (cmd === CMD.LEISTUNG && o.leistungMeldet !== undefined) return sende(cmd, [o.leistungMeldet]);
    if ([CMD.FREQUENZ, CMD.BANDBREITE, CMD.LEISTUNG, CMD.SF, CMD.CR, CMD.ZUSTAND, CMD.ST_ALOCK, CMD.LT_ALOCK].includes(cmd)) return sende(cmd, daten);
  };
  let offen = false;
  const port: AttrappenPort & { geschlossen: boolean } = {
    geschlossen: false,
    readable: null,
    writable: null,
    async open() {
      offen = true;
      o.luft?.add(hoere);
      port.readable = new ReadableStream<Uint8Array>({ start: (c) => { ausgabe = c; } });
      port.writable = new WritableStream<Uint8Array>({
        write(stueck) {
          for (const b of stueck) {
            if (b === FEND) {
              if (rahmen.length > 0) antworte(rahmen[0]!, rahmen.slice(1));
              rahmen = [];
              continue;
            }
            if (esc) {
              rahmen.push(b === TFEND ? FEND : b === TFESC ? FESC : b);
              esc = false;
            } else if (b === FESC) esc = true;
            else rahmen.push(b);
          }
        },
      });
    },
    async close() {
      offen = false;
      o.luft?.delete(hoere);
      port.geschlossen = true;
    },
  };
  return { port, befehle, gesendet, offen: () => offen };
}
