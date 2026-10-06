/**
 * Zeitanker in der App (Schritt 5.10b, B-17b3a; K1–K3 A, entschieden 06.10.2026).
 *
 * Was einen Anker bekommt (K1 A): eigene Mandate für den Schlüsselwechsel
 * (die Event-Kennung) und Quittungen (`quittungsDigest()`, ohne den Stand –
 * der ändert sich von „angekündigt“ zu „belegt“). Gestempelt wird gebündelt im
 * Abruftakt (K2 A, `zeitankerTakt()`): Die Kalender sehen IP und Zeitpunkt,
 * nie einen Wert. Wo die Beweise liegen (K3 A): alle im Tresor
 * (`freedom.zeitanker`, `SICHERUNG_NIE`); der zum Mandat geht, sobald Bitcoin
 * ihn trägt, zusätzlich als NIP-03 (Kind 1040) hinaus – Kontakte prüfen ihn
 * selbst. Der zur Quittung bleibt auf dem Gerät.
 *
 * Eine Höhe hier ist nur, was der Kalender nachreichte – „verankert“ heißt
 * erst `pruefeVerankerung()` (B-17b2), bei Bedarf.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  type OtsHolen, type OtsNachreichung, type OtsStempel, type OtsZeitstempel, type Quittung, type UnsignedEvent,
  baueOtsBeweis, leseOtsDatei, schreibeOtsDatei,
} from "@freedomstack/protocol";

export const LS_ZEITANKER = "freedom.zeitanker";

export const ZEITANKER_GRENZEN = {
  /** So viele Anker bleiben (die neuesten). */
  anker: 500,
  /** Werte je Stempel (ein Bündel). */
  jeStempel: 64,
  /** Beweise je Schlag nachfragen. */
  jeNachreichung: 8,
  /** Erst nachfragen, wenn der Stempel so alt ist – vorher steht nichts in Bitcoin. */
  nachreichenAbSek: 3600,
} as const;

export interface Anker {
  art: "mandat" | "quittung";
  /** SHA-256 (Hex): Event-Kennung bzw. `quittungsDigest()`. */
  digest: string;
  /** Art des Events (nur beim Mandat, für NIP-03). */
  kind?: number;
  /** .ots-Datei (Hex), sobald gestempelt. */
  ots?: string;
  /** Niedrigste Bitcoin-Höhe, sobald nachgereicht – ungeprüft. */
  hoehe?: number;
  /** Kind 1040 veröffentlicht (nur Mandat). */
  veroeffentlicht?: boolean;
  /** Unix-Sekunden: vorgemerkt, dann gestempelt. */
  angelegt: number;
  gestempelt?: number;
}

export interface AnkerSpeicher {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void | Promise<void>;
}

const HEX64 = /^[0-9a-f]{64}$/;

function leseAnker(x: unknown): Anker | null {
  if (!x || typeof x !== "object") return null;
  const a = x as Record<string, unknown>;
  if ((a.art !== "mandat" && a.art !== "quittung") || typeof a.digest !== "string" || !HEX64.test(a.digest)) return null;
  if (!Number.isSafeInteger(a.angelegt)) return null;
  const anker: Anker = { art: a.art, digest: a.digest, angelegt: a.angelegt as number };
  if (Number.isInteger(a.kind) && (a.kind as number) >= 0 && (a.kind as number) <= 65535) anker.kind = a.kind as number;
  if (typeof a.ots === "string" && /^(?:[0-9a-f]{2})+$/.test(a.ots)) anker.ots = a.ots;
  if (Number.isSafeInteger(a.hoehe) && (a.hoehe as number) >= 0) anker.hoehe = a.hoehe as number;
  if (a.veroeffentlicht === true) anker.veroeffentlicht = true;
  if (Number.isSafeInteger(a.gestempelt)) anker.gestempelt = a.gestempelt as number;
  return anker;
}

/** Wert einer Quittung für den Anker: SHA-256 über die Felder in fester Reihenfolge, ohne den Stand. */
export function quittungsDigest(q: Quittung): string {
  const felder = Object.keys(q).filter((k) => k !== "stand").sort();
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(q, felder))));
}

export class ZeitankerBuch {
  constructor(private speicher: AnkerSpeicher) {}

  alle(): Anker[] {
    try {
      const roh = JSON.parse(this.speicher.getItem(LS_ZEITANKER) ?? "[]") as unknown;
      return Array.isArray(roh) ? roh.map(leseAnker).filter((a): a is Anker => a !== null) : [];
    } catch {
      return [];
    }
  }

  private async schreibe(alle: Anker[]): Promise<void> {
    await this.speicher.setItem(LS_ZEITANKER, JSON.stringify(alle.sort((a, b) => a.angelegt - b.angelegt).slice(-ZEITANKER_GRENZEN.anker)));
  }

  /** Zum Stempeln vormerken – ein schon bekannter Wert bleibt, wie er ist. */
  async vormerken(a: { art: Anker["art"]; digest: string; kind?: number }, jetzt: number): Promise<boolean> {
    if (!HEX64.test(a.digest)) return false;
    const alle = this.alle();
    if (alle.some((x) => x.digest === a.digest)) return false;
    alle.push({ art: a.art, digest: a.digest, angelegt: jetzt, ...(a.art === "mandat" && a.kind !== undefined ? { kind: a.kind } : {}) });
    await this.schreibe(alle);
    return true;
  }

  async setze(digest: string, teil: Partial<Pick<Anker, "ots" | "hoehe" | "veroeffentlicht" | "gestempelt">>): Promise<void> {
    await this.schreibe(this.alle().map((a) => (a.digest === digest ? { ...a, ...teil } : a)));
  }

  zumStempeln(): Anker[] {
    return this.alle().filter((a) => !a.ots).slice(0, ZEITANKER_GRENZEN.jeStempel);
  }

  zumNachreichen(jetzt: number): Anker[] {
    return this.alle()
      .filter((a) => a.ots && a.hoehe === undefined && jetzt - (a.gestempelt ?? a.angelegt) >= ZEITANKER_GRENZEN.nachreichenAbSek)
      .slice(0, ZEITANKER_GRENZEN.jeNachreichung);
  }

  zumVeroeffentlichen(): Anker[] {
    return this.alle().filter((a) => a.art === "mandat" && a.kind !== undefined && a.ots && a.hoehe !== undefined && !a.veroeffentlicht);
  }
}

/**
 * Eine Abfrage je Adresse und Schlag: Beweise aus einem Bündel teilen sich die
 * Versprechen der Kalender – ohne das fragte jeder Beweis dieselben Adressen.
 */
export function mitGedaechtnis(holen: OtsHolen): OtsHolen {
  const schon = new Map<string, Promise<{ status: number; bytes: Uint8Array }>>();
  return async (url, init) => {
    if ((init.method ?? "GET") !== "GET") return holen(url, init);
    let p = schon.get(url);
    if (!p) {
      p = holen(url, init).then(async (r) => ({ status: r.status, bytes: new Uint8Array(await r.arrayBuffer()) }));
      schon.set(url, p);
    }
    const { status, bytes } = await p;
    return new Response(status === 204 || status === 304 ? null : Uint8Array.from(bytes), { status });
  };
}

export interface ZeitankerDienste {
  stempele(digests: Uint8Array[]): Promise<OtsStempel>;
  reicheNach(z: OtsZeitstempel, holen: OtsHolen): Promise<OtsNachreichung>;
  holen: OtsHolen;
  /** Kind 1040 signieren und veröffentlichen; ohne Identität `undefined`. */
  veroeffentliche?: (ev: UnsignedEvent) => Promise<void>;
  autor?: string;
  jetzt: number;
}

export interface TaktErgebnis { gestempelt: number; nachgereicht: number; veroeffentlicht: number }

/** Ein Schlag: Offenes stempeln, Altes nachreichen, verankerte Mandate veröffentlichen. Fehler warten auf den nächsten Schlag. */
export async function zeitankerTakt(buch: ZeitankerBuch, d: ZeitankerDienste): Promise<TaktErgebnis> {
  const erg: TaktErgebnis = { gestempelt: 0, nachgereicht: 0, veroeffentlicht: 0 };
  const offen = buch.zumStempeln();
  if (offen.length > 0) {
    try {
      const s = await d.stempele(offen.map((a) => hexToBytes(a.digest)));
      for (const [i, a] of offen.entries()) await buch.setze(a.digest, { ots: bytesToHex(schreibeOtsDatei(s.dateien[i]!)), gestempelt: d.jetzt });
      erg.gestempelt = offen.length;
    } catch { /* zu wenige Kalender – beim nächsten Schlag */ }
  }
  const holen = mitGedaechtnis(d.holen);
  for (const a of buch.zumNachreichen(d.jetzt)) {
    try {
      const datei = leseOtsDatei(hexToBytes(a.ots!));
      const r = await d.reicheNach(datei.zeitstempel, holen);
      if (!r.neu && r.bitcoin.length === 0) continue;
      await buch.setze(a.digest, { ots: bytesToHex(schreibeOtsDatei(datei)), ...(r.bitcoin.length ? { hoehe: r.bitcoin[0] } : {}) });
      if (r.bitcoin.length) erg.nachgereicht++;
    } catch { /* unlesbar oder Netz – beim nächsten Schlag */ }
  }
  if (d.veroeffentliche && d.autor) {
    for (const a of buch.zumVeroeffentlichen()) {
      try {
        await d.veroeffentliche(baueOtsBeweis(d.autor, { id: a.digest, kind: a.kind! }, leseOtsDatei(hexToBytes(a.ots!)), d.jetzt));
        await buch.setze(a.digest, { veroeffentlicht: true });
        erg.veroeffentlicht++;
      } catch { /* Relay oder Signer – beim nächsten Schlag */ }
    }
  }
  return erg;
}
