/**
 * Ein Freedom-Gerät im Bitchat-Netz (B-36c2, BC-W2–W4 A, `docs/BITCHAT-ENTWURF.md`, `docs/PROTOCOL.md` §45): ankündigen,
 * Kontakte an ihrer Ankündigung erkennen, Pakete anderer roh weiterreichen (B-36c2a1); Noise-Sitzungen nur mit Kontakten und
 * Umschläge darin (B-36c2a2). Ohne Ein- und Ausgabe: Die App gibt jeden Wert der Hülle in `nimm()` und schickt hinaus, was
 * herauskommt – so prüfen Tests ein ganzes Netz ohne Bluetooth.
 *
 * Erkannt wird ein Kontakt nur an einer gültig signierten Ankündigung, deren Noise- und Signier-Schlüssel er selbst
 * versiegelt geschickt hat (38083, `bitchat-kontakt.ts`). Ein eigenes Merkmal trägt die Ankündigung nicht (BC-W3 A). Eine
 * Sitzung gilt erst, wenn der Handshake genau diesen Noise-Schlüssel zeigt; Handshakes anderer Geräte bleiben unbeantwortet –
 * Bitchat-Nutzer können Freedom-Geräte sehen, aber keine Sitzung mit ihnen öffnen (BC-W2 A).
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { bitchatUmschlagKlartext, leseBitchatUmschlag } from "./bitchat-kontakt.js";
import { BitchatDoppel, bitchatFuerVerbindung, bitchatWeiterreichen, mitBitchatTtl } from "./bitchat-mesh.js";
import { BitchatTransport, NoiseXX, noiseSchluessel, type NoiseSchluessel } from "./bitchat-noise.js";
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
  /** So lange darf ein Handshake dauern */
  handshakeMs: 10_000,
  /** So lange gilt ein Kontakt nach seiner letzten Ankündigung als in der Nähe (`bleReachabilityRetentionVerifiedSeconds`) */
  gesehenMs: 60_000,
  /** Umschläge, die auf eine Sitzung warten, je Gegenüber */
  warten: 16,
});

/** Länge der drei Nachrichten von XX ohne Nutzlast: e · e, s (verschlüsselt), Tag · s (verschlüsselt), Tag */
const HS = Object.freeze({ eins: 32, zwei: 96, drei: 64 });

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const gleich = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

interface Sitzung {
  hs?: NoiseXX;
  transport?: BitchatTransport;
  seit: number;
  warten: Uint8Array[];
}

export class BitchatKnoten {
  readonly peerId: Uint8Array;
  private readonly s: NoiseSchluessel;
  private readonly signierPk: Uint8Array;
  private verbindungen: { id: string; grenze: number }[] = [];
  private kontakte = new Map<string, BitchatKontakt>();
  private gesehen = new Map<string, { kontakt: BitchatKontakt; zeit: number }>();
  private sitzungen = new Map<string, Sitzung>();
  private readonly doppel = new BitchatDoppel();
  private readonly zusammen = new BitchatZusammensetzer();

  constructor(
    private readonly ich: BitchatIdentitaet,
    private readonly o: { eigeneSchluessel: readonly string[]; zufall?: () => number; kennung?: () => Uint8Array },
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

  /**
   * Einen Umschlag an eine Person – nur, wenn ihr Gerät in der Nähe ist (sonst `null`). Ohne Sitzung beginnt erst der
   * Handshake; der Umschlag wartet, bis sie steht.
   */
  sende(person: string, umschlag: Uint8Array, jetzt: number): BitchatAusgabe[] | null {
    const ziel = [...this.gesehen.entries()].find(([, g]) => g.kontakt.person === person && jetzt - g.zeit <= BITCHAT_KNOTEN.gesehenMs);
    const klar = ziel && bitchatUmschlagKlartext(umschlag, this.o.eigeneSchluessel);
    if (!ziel || !klar) return null;
    const [peer] = ziel;
    let s = this.sitzung(peer, jetzt);
    if (s?.transport) return this.verschluesselt(peer, s.transport, klar, jetzt);
    if (!s) {
      const hs = new NoiseXX(true, this.s);
      s = { hs, seit: jetzt, warten: [klar] };
      this.sitzungen.set(peer, s);
      return this.handshake(peer, hs.schreibe(), jetzt);
    }
    if (s.warten.length < BITCHAT_KNOTEN.warten) s.warten.push(klar);
    return [];
  }

  /** Ein Wert von einer Verbindung: was weitergeht oder geantwortet wird, und Umschläge an mich */
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
    this.verarbeite(p, jetzt, aus);
    return aus;
  }

  private verarbeite(p: BitchatPaket, jetzt: number, aus: { ausgabe: BitchatAusgabe[]; umschlaege: Uint8Array[] }): void {
    if (p.typ === BITCHAT_TYP.fragment) {
      const ganz = this.zusammen.nimm(p, jetzt);
      if (ganz) this.verarbeite(ganz, jetzt, aus);
      return;
    }
    if (p.typ === BITCHAT_TYP.ankuendigung) return this.ankuendigungGelesen(p, jetzt);
    if (!p.empfaenger || !gleich(p.empfaenger, this.peerId)) return;
    const peer = hex(p.absender);
    if (p.typ === BITCHAT_TYP.noiseHandshake) aus.ausgabe.push(...this.handshakeGelesen(peer, p.nutzlast, jetzt));
    if (p.typ === BITCHAT_TYP.noiseVerschluesselt) {
      const t = this.sitzung(peer, jetzt)?.transport;
      try {
        const umschlag = t && leseBitchatUmschlag(t.entschluessele(p.nutzlast));
        if (umschlag) aus.umschlaege.push(umschlag);
      } catch {
        // falsche Sitzung, wiederholt oder verändert – nichts
      }
    }
  }

  private ankuendigungGelesen(p: BitchatPaket, jetzt: number): void {
    const a = leseBitchatAnkuendigung(p.nutzlast);
    if (!a || !gleich(bitchatPeerId(a.noise), p.absender) || !pruefeBitchatSignatur(p, a.signier)) return;
    const kontakt = this.kontakte.get(hex(a.noise));
    if (kontakt && gleich(kontakt.signier, a.signier)) this.gesehen.set(hex(p.absender), { kontakt, zeit: jetzt });
  }

  /** Handshake: nur mit Kontakten, die sich angekündigt haben; die Nachricht erkennt man an ihrer Länge */
  private handshakeGelesen(peer: string, msg: Uint8Array, jetzt: number): BitchatAusgabe[] {
    const kontakt = this.gesehen.get(peer)?.kontakt;
    if (!kontakt) return [];
    let s = this.sitzung(peer, jetzt);
    try {
      if (msg.length === HS.eins) {
        // Beide begannen zugleich: Die kleinere Peer-ID bleibt Initiator
        if (s?.hs?.initiator && !s.hs.fertig && hex(this.peerId) < peer) return [];
        const hs = new NoiseXX(false, this.s);
        hs.lies(msg);
        s = { hs, seit: jetzt, warten: s?.warten ?? [] };
        this.sitzungen.set(peer, s);
        return this.handshake(peer, hs.schreibe(), jetzt);
      }
      const hs = s?.hs;
      if (!s || !hs || hs.schreibtJetzt || hs.fertig) return [];
      if ((hs.initiator && msg.length !== HS.zwei) || (!hs.initiator && msg.length !== HS.drei)) return [];
      hs.lies(msg);
      const aus = hs.initiator ? this.handshake(peer, hs.schreibe(), jetzt) : [];
      const split = hs.teile();
      if (!split.entfernt || !gleich(split.entfernt, kontakt.noise)) {
        this.sitzungen.delete(peer);
        return [];
      }
      const transport = new BitchatTransport(split);
      this.sitzungen.set(peer, { transport, seit: jetzt, warten: [] });
      for (const klar of s.warten) aus.push(...this.verschluesselt(peer, transport, klar, jetzt));
      return aus;
    } catch {
      this.sitzungen.delete(peer);
      return [];
    }
  }

  /** Die Sitzung mit einem Gegenüber – ein Handshake, der zu lange dauert, zählt nicht mehr */
  private sitzung(peer: string, jetzt: number): Sitzung | undefined {
    const s = this.sitzungen.get(peer);
    if (s && !s.transport && jetzt - s.seit > BITCHAT_KNOTEN.handshakeMs) {
      this.sitzungen.delete(peer);
      return undefined;
    }
    return s;
  }

  private handshake(peer: string, msg: Uint8Array, jetzt: number): BitchatAusgabe[] {
    return this.anAlle(this.paket(BITCHAT_TYP.noiseHandshake, msg, jetzt, peer), false);
  }

  private verschluesselt(peer: string, t: BitchatTransport, klar: Uint8Array, jetzt: number): BitchatAusgabe[] {
    return this.anAlle(this.paket(BITCHAT_TYP.noiseVerschluesselt, t.verschluessele(klar), jetzt, peer), false);
  }

  private neueKennung(): Uint8Array {
    return this.o.kennung?.() ?? crypto.getRandomValues(new Uint8Array(8));
  }

  private paket(typ: number, nutzlast: Uint8Array, jetzt: number, an?: string): BitchatPaket {
    const empfaenger = an ? Uint8Array.from(an.match(/../g)!.map((x) => parseInt(x, 16))) : undefined;
    return { version: 1, typ, ttl: BITCHAT_KNOTEN.ttl, zeit: jetzt, absender: this.peerId, ...(empfaenger ? { empfaenger } : {}), nutzlast };
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
