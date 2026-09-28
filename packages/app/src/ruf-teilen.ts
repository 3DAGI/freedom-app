/**
 * Ruf mit Kontakten teilen (Schritt 5.5c).
 *
 * Nur mit Zustimmung (`freedom.ruf.teilen`, Settings → Datenschutz) geht die
 * Zusammenfassung der eigenen Quittungen (38075, `fasseZusammen()`) versiegelt
 * an jeden Kontakt einzeln – je Schlag des Abruftakts höchstens ein Umschlag,
 * so kommen nie zwei im selben Augenblick an (Regel „kopien-entkoppelt“).
 * Ein neuer Stand geht höchstens einmal am Tag an alle, neue Kontakte bekommen
 * den bisherigen. Empfangene Zusammenfassungen (nur von Kontakten,
 * `oeffneRufUmschlag()`) liegen im Tresor (`freedom.ruf.kontakte`), je Kontakt
 * die neueste – nie auf einem Relay, nie in der Sicherung.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { RUF_MAX_PROVIDER, baueRufUmschlaege, type NostrEvent, type RufVonKontakt, type RufZeile, type Signer } from "@freedomstack/protocol";

export const LS_RUF_TEILEN = "freedom.ruf.teilen";
export const LS_RUF_KONTAKTE = "freedom.ruf.kontakte";
export const LS_RUF_GESENDET = "freedom.ruf.gesendet";
/** Ein neuer Stand geht höchstens so oft an alle. */
export const RUF_ABSTAND_SECS = 86_400;
/** Ohne Warteschlange nur jeden so vielten Schlag nachsehen (etwa alle 30 min). */
export const RUF_PRUEFEN_JEDEN = 60;
/** Zusammenfassungen von höchstens so vielen Kontakten (die neuesten). */
export const RUF_KONTAKTE_MAX = 200;

export interface RufSpeicher {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void | Promise<void>;
}

const HEX64 = /^[0-9a-f]{64}$/;
const ganz = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;

function zeileOk(z: unknown): z is RufZeile {
  const r = z as Partial<RufZeile> | null;
  return !!r && HEX64.test(r.provider ?? "") && ganz(r.auftraege) && r.auftraege > 0 && ganz(r.belegt) && r.belegt <= r.auftraege
    && ganz(r.umfangMsat) && ganz(r.umfangLamports) && ganz(r.reklamationen);
}

function lies<T>(speicher: RufSpeicher, key: string, fallback: T): T {
  try {
    return (JSON.parse(speicher.getItem(key) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Empfangene Zusammenfassungen – je Kontakt die neueste. */
export class RufVonKontakten {
  constructor(private speicher: RufSpeicher) {}

  private roh(): RufVonKontakt[] {
    const l = lies<unknown>(this.speicher, LS_RUF_KONTAKTE, []);
    if (!Array.isArray(l)) return [];
    return l.filter((r): r is RufVonKontakt => !!r && HEX64.test(r.von) && ganz(r.zeit) && Array.isArray(r.zeilen)
      && r.zeilen.length <= RUF_MAX_PROVIDER && r.zeilen.every(zeileOk));
  }

  /** Nur von denen, die noch Kontakte sind. */
  alle(kontakte: ReadonlySet<string>): RufVonKontakt[] {
    return this.roh().filter((r) => kontakte.has(r.von));
  }

  /** Merken, wenn sie neuer ist als die bekannte dieses Kontakts. */
  async nimm(r: RufVonKontakt): Promise<boolean> {
    const alt = this.roh();
    if ((alt.find((x) => x.von === r.von)?.zeit ?? -1) >= r.zeit) return false;
    const neu = [...alt.filter((x) => x.von !== r.von), r].sort((a, b) => b.zeit - a.zeit).slice(0, RUF_KONTAKTE_MAX);
    await this.speicher.setItem(LS_RUF_KONTAKTE, JSON.stringify(neu));
    return true;
  }
}

/** Was zuletzt hinausging: Fingerabdruck des Stands, wann, an wen. */
export interface RufVersandStand {
  fp: string;
  zeit: number;
  an: string[];
}

export const fingerabdruck = (zeilen: readonly RufZeile[]): string =>
  bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(zeilen)))).slice(0, 32);

/**
 * Wer jetzt eine Zusammenfassung bekommt: bei neuem Stand alle – höchstens
 * einmal am Tag –, sonst nur Kontakte, die den bisherigen noch nicht haben.
 */
export function faelligeEmpfaenger(p: {
  kontakte: readonly string[]; fp: string; stand: RufVersandStand | null; jetzt: number;
}): { an: string[]; neuerStand: boolean } {
  const kontakte = [...new Set(p.kontakte)].filter((k) => HEX64.test(k));
  if (!p.stand) return { an: kontakte, neuerStand: true };
  if (p.stand.fp !== p.fp) {
    return p.jetzt - p.stand.zeit >= RUF_ABSTAND_SECS ? { an: kontakte, neuerStand: true } : { an: [], neuerStand: false };
  }
  const haben = new Set(p.stand.an);
  return { an: kontakte.filter((k) => !haben.has(k)), neuerStand: false };
}

export interface RufVersandDeps {
  zustimmung(): boolean;
  /** Null, wenn die App nicht als die Person sprechen kann (Gerät, gesperrt). */
  signer(): Signer | null;
  kontakte(): string[];
  zeilen(): RufZeile[];
  /** An den Posteingang des Kontakts; true, wenn ein Relay ihn angenommen hat. */
  sende(wrap: NostrEvent, an: string): Promise<boolean>;
  speicher: RufSpeicher;
  jetzt(): number;
}

/** Versand im Abruftakt: je Schlag höchstens ein Umschlag. */
export class RufVersand {
  private schlange: string[] = [];
  private zeilen: RufZeile[] = [];
  private schlag = 0;
  /** Nicht zustellbar (kein Posteingang, kein Relay): einen Tag Pause. */
  private fehl = new Map<string, number>();

  constructor(private d: RufVersandDeps) {}

  stand(): RufVersandStand | null {
    const s = lies<RufVersandStand | null>(this.d.speicher, LS_RUF_GESENDET, null);
    return s && typeof s.fp === "string" && ganz(s.zeit) && Array.isArray(s.an) ? s : null;
  }

  /** Ein Schlag. Ergebnis: an wen gerade gesendet wurde, sonst null. */
  async takt(): Promise<string | null> {
    if (!this.d.zustimmung()) {
      this.schlange = [];
      return null;
    }
    const signer = this.d.signer();
    if (!signer) return null;
    if (this.schlange.length === 0) {
      if (this.schlag++ % RUF_PRUEFEN_JEDEN !== 0) return null;
      const zeilen = this.d.zeilen();
      if (zeilen.length === 0) return null;
      const fp = fingerabdruck(zeilen);
      const jetzt = this.d.jetzt();
      const f = faelligeEmpfaenger({ kontakte: this.d.kontakte(), fp, stand: this.stand(), jetzt });
      const an = f.an.filter((k) => jetzt - (this.fehl.get(k) ?? -Infinity) >= RUF_ABSTAND_SECS);
      if (an.length === 0) return null;
      if (f.neuerStand) await this.d.speicher.setItem(LS_RUF_GESENDET, JSON.stringify({ fp, zeit: jetzt, an: [] }));
      this.schlange = an;
      this.zeilen = zeilen;
    }
    const an = this.schlange.shift()!;
    const [wrap] = await baueRufUmschlaege({ von: signer, an: [an], zeilen: this.zeilen, nowSecs: this.d.jetzt() });
    if (!wrap || !(await this.d.sende(wrap, an).catch(() => false))) {
      this.fehl.set(an, this.d.jetzt());
      return null;
    }
    const s = this.stand();
    if (s) await this.d.speicher.setItem(LS_RUF_GESENDET, JSON.stringify({ ...s, an: [...new Set([...s.an, an])] }));
    return an;
  }
}
