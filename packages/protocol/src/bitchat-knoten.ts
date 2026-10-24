/**
 * Ein Freedom-Gerät im Bitchat-Netz (B-36c2, BC-W2–W4 A, `docs/BITCHAT-ENTWURF.md`, `docs/PROTOCOL.md` §45): ankündigen,
 * Kontakte an ihrer Ankündigung erkennen, Pakete anderer roh weiterreichen (B-36c2a1); Noise-Sitzungen mit Kontakten und
 * Umschläge darin folgen in B-36c2a2. Ohne Ein- und Ausgabe: Die App gibt jeden Wert der Hülle in `nimm()` und schickt
 * hinaus, was herauskommt – so prüfen Tests ein ganzes Netz ohne Bluetooth.
 *
 * Erkannt wird ein Kontakt nur an einer gültig signierten Ankündigung, deren Noise- und Signier-Schlüssel er selbst
 * versiegelt geschickt hat (38083, `bitchat-kontakt.ts`). Ein eigenes Merkmal trägt die Ankündigung nicht (BC-W3 A).
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { BitchatDoppel, bitchatFuerVerbindung, bitchatWeiterreichen, mitBitchatTtl } from "./bitchat-mesh.js";
import { noiseSchluessel, type NoiseSchluessel } from "./bitchat-noise.js";
import {
  BITCHAT_TYP,
  type BitchatPaket,
  BitchatZusammensetzer,
  baueBitchatAnkuendigung,
  bitchatPeerId,
  kodiereBitchat,
  leseBitchat,
  leseBitchatAnkuendigung,
  pruefeBitchatSignatur,
  signiereBitchat,
  zerlegeBitchatRoh,
} from "./bitchat-paket.js";

/** Die eigene Identität im Funk – eine je Gerät (BC-W4 A), nie aus dem Nostr-Schlüssel */
export interface BitchatIdentitaet {
  /** geheimer Noise-Schlüssel (X25519) */
  noise: Uint8Array;
  /** geheimer Signier-Schlüssel (Ed25519) */
  signier: Uint8Array;
  /** Name in der Ankündigung – Bitchat zeigt ihn allen in der Nähe */
  name: string;
}

/** Ein Kontakt mit den Schlüsseln, die er versiegelt geschickt hat (öffentlich) */
export interface BitchatKontakt {
  person: string;
  noise: Uint8Array;
  signier: Uint8Array;
}

export interface BitchatAusgabe {
  /** Verbindung der Hülle */
  id: string;
  wert: Uint8Array;
  versatzMs: number;
}

export const BITCHAT_KNOTEN = Object.freeze({
  ttl: 7,
  /** So lange gilt ein Kontakt nach seiner letzten Ankündigung als in der Nähe (`bleReachabilityRetentionVerifiedSeconds`) */
  gesehenMs: 60_000,
});

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const gleich = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export class BitchatKnoten {
  readonly peerId: Uint8Array;
  private readonly s: NoiseSchluessel;
  private readonly signierPk: Uint8Array;
  private verbindungen: { id: string; grenze: number }[] = [];
  private kontakte = new Map<string, BitchatKontakt>();
  private gesehen = new Map<string, { kontakt: BitchatKontakt; zeit: number }>();
  private readonly doppel = new BitchatDoppel();
  private readonly zusammen = new BitchatZusammensetzer();

  constructor(
    private readonly ich: BitchatIdentitaet,
    private readonly o: { zufall?: () => number; kennung?: () => Uint8Array } = {},
  ) {
    this.s = noiseSchluessel(ich.noise);
    this.signierPk = ed25519.getPublicKey(ich.signier);
    this.peerId = bitchatPeerId(this.s.oeffentlich);
  }

  /** Öffentliche Schlüssel für die Kontakte (38083) */
  get schluessel(): { noise: Uint8Array; signier: Uint8Array } {
    return { noise: this.s.oeffentlich, signier: this.signierPk };
  }

  setzeVerbindungen(v: readonly { id: string; grenze: number }[]): void {
    this.verbindungen = [...v];
  }

  setzeKontakte(k: readonly BitchatKontakt[]): void {
    this.kontakte = new Map(k.map((x) => [hex(x.noise), x]));
    for (const [peer, g] of this.gesehen) if (!this.kontakte.has(hex(g.kontakt.noise))) this.gesehen.delete(peer);
  }

  /** Personen, deren Gerät gerade in der Nähe ist */
  inDerNaehe(jetzt: number): string[] {
    return [...this.gesehen.values()].filter((g) => jetzt - g.zeit <= BITCHAT_KNOTEN.gesehenMs).map((g) => g.kontakt.person);
  }

  /** Die eigene Ankündigung an alle Verbindungen – signiert, ohne Nachbarn und Fähigkeiten (unter 100 Byte) */
  ankuendigung(jetzt: number): BitchatAusgabe[] {
    const nutzlast = baueBitchatAnkuendigung({ name: this.ich.name, noise: this.s.oeffentlich, signier: this.signierPk });
    return this.anAlle(this.paket(BITCHAT_TYP.ankuendigung, nutzlast, jetzt), true);
  }

  /** Ein Wert von einer Verbindung: was weitergeht, und Umschläge an mich (ab B-36c2a2) */
  nimm(id: string, wert: Uint8Array, jetzt: number): { ausgabe: BitchatAusgabe[]; umschlaege: Uint8Array[] } {
    const aus = { ausgabe: [] as BitchatAusgabe[], umschlaege: [] as Uint8Array[] };
    const p = leseBitchat(wert);
    if (!p || gleich(p.absender, this.peerId) || !this.doppel.neu(p, jetzt)) return aus;
    const w = bitchatWeiterreichen(p, { eigen: this.peerId, grad: this.verbindungen.length, zufall: this.o.zufall });
    if (w.weiter) {
      // Roh weiter; wo es nicht in die Grenze passt, roh zerlegt (wie Bitchat), je Grenze einmal
      const roh = mitBitchatTtl(wert, w.ttl);
      const zerlegt = new Map<number, Uint8Array[]>();
      for (const v of this.verbindungen) {
        if (v.id === id) continue;
        if (roh.length <= v.grenze) {
          aus.ausgabe.push({ id: v.id, wert: roh, versatzMs: w.versatzMs });
          continue;
        }
        if (!zerlegt.has(v.grenze)) {
          try {
            const teile = zerlegeBitchatRoh(roh, this.neueKennung(), v.grenze) ?? [];
            zerlegt.set(v.grenze, teile.map((t) => kodiereBitchat(t)));
          } catch {
            zerlegt.set(v.grenze, []); // passt auch zerlegt nicht – diese Verbindung bekommt es nicht
          }
        }
        for (const t of zerlegt.get(v.grenze)!) aus.ausgabe.push({ id: v.id, wert: t, versatzMs: w.versatzMs });
      }
    }
    this.verarbeite(p, jetzt);
    return aus;
  }

  private verarbeite(p: BitchatPaket, jetzt: number): void {
    if (p.typ === BITCHAT_TYP.fragment) {
      const ganz = this.zusammen.nimm(p, jetzt);
      if (ganz) this.verarbeite(ganz, jetzt);
      return;
    }
    if (p.typ === BITCHAT_TYP.ankuendigung) this.ankuendigungGelesen(p, jetzt);
  }

  private ankuendigungGelesen(p: BitchatPaket, jetzt: number): void {
    const a = leseBitchatAnkuendigung(p.nutzlast);
    if (!a || !gleich(bitchatPeerId(a.noise), p.absender) || !pruefeBitchatSignatur(p, a.signier)) return;
    const kontakt = this.kontakte.get(hex(a.noise));
    if (kontakt && gleich(kontakt.signier, a.signier)) this.gesehen.set(hex(p.absender), { kontakt, zeit: jetzt });
  }

  private neueKennung(): Uint8Array {
    return this.o.kennung?.() ?? crypto.getRandomValues(new Uint8Array(8));
  }

  private paket(typ: number, nutzlast: Uint8Array, jetzt: number): BitchatPaket {
    return { version: 1, typ, ttl: BITCHAT_KNOTEN.ttl, zeit: jetzt, absender: this.peerId, nutzlast };
  }

  /** An alle Verbindungen – nach der kleinsten Grenze, damit alle dieselben Fragmente bekommen */
  private anAlle(p: BitchatPaket, signiert: boolean): BitchatAusgabe[] {
    if (this.verbindungen.length === 0) return [];
    const paket = signiert ? signiereBitchat(p, this.ich.signier) : p;
    const grenze = Math.min(...this.verbindungen.map((v) => v.grenze));
    const werte = bitchatFuerVerbindung(paket, { grenze, kennung: this.neueKennung() });
    return this.verbindungen.flatMap((v) => werte.map((wert) => ({ id: v.id, wert, versatzMs: 0 })));
  }
}
