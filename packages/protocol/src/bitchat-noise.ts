/**
 * Noise für Bitchat (B-36a3, BC-W1 A, `docs/BITCHAT-ENTWURF.md`): `Noise_XX_25519_ChaChaPoly_SHA256` nach der Spezifikation
 * (Revision 34), geprüft gegen die Vektoren von cacophony und snow (`test/fixtures/noise-xx-vektoren.json`, aus dem
 * gemeinfreien Bitchat-Repository). Bitchat sendet Handshakes ohne Prolog und ohne Nutzlast.
 *
 * Im Transport weicht Bitchat ab (`NoiseCipherState` mit `useExtractedNonce`): Jede Nachricht trägt vorn ihre Nonce als
 * 4 Byte Großendian, weil Bluetooth Pakete vertauscht oder verliert; der Empfänger nimmt jede Nonce nur einmal und keine,
 * die mehr als 1024 hinter der höchsten liegt. Mehr als 2^32 − 1 Nachrichten je Sitzung gibt es nicht.
 *
 * Was in einer Sitzung reist, sind bei Freedom nur Umschläge (BC-W2 A); der Schlüssel der Gegenseite (`entfernt`) ist
 * erst nach dem Handshake bekannt und bindet die Sitzung an ihre Peer-ID (`bitchatPeerId()`).
 */
import { x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const NOISE_NAME = "Noise_XX_25519_ChaChaPoly_SHA256";
export const NOISE_GRENZEN = Object.freeze({ fenster: 1024, nonce: 0xffff_fffe, nachricht: 65_535 });

export const NOISE_FAELLE = ["reihenfolge", "form", "entschluesseln", "wiederholt", "nonce-ende", "abgebrochen"] as const; // kein UI-Text
export type NoiseFall = (typeof NOISE_FAELLE)[number];

export class NoiseFehler extends Error {
  constructor(readonly fall: NoiseFall) {
    super(`Noise: ${fall}`); // kein UI-Text
    this.name = "NoiseFehler";
  }
}

const verbinde = (...teile: Uint8Array[]): Uint8Array => {
  const aus = new Uint8Array(teile.reduce((n, t) => n + t.length, 0));
  let i = 0;
  for (const t of teile) {
    aus.set(t, i);
    i += t.length;
  }
  return aus;
};

/** Nonce der AEAD: 4 Byte null, dann der Zähler als 8 Byte Kleinendian (Noise, ChaChaPoly). */
function aeadNonce(n: number): Uint8Array {
  const aus = new Uint8Array(12);
  new DataView(aus.buffer).setBigUint64(4, BigInt(n), true);
  return aus;
}

/** CipherState nach Noise §5.1 */
class Chiffre {
  n = 0;
  constructor(private k: Uint8Array | null = null) {}
  get bereit(): boolean {
    return this.k !== null;
  }
  verschluessele(ad: Uint8Array, klar: Uint8Array): Uint8Array {
    if (!this.k) return klar;
    return chacha20poly1305(this.k, aeadNonce(this.n++), ad).encrypt(klar);
  }
  entschluessele(ad: Uint8Array, geheim: Uint8Array, n = this.n): Uint8Array {
    if (!this.k) return geheim;
    try {
      const klar = chacha20poly1305(this.k, aeadNonce(n), ad).decrypt(geheim);
      if (n === this.n) this.n++;
      return klar;
    } catch {
      throw new NoiseFehler("entschluesseln");
    }
  }
}

/** HKDF nach Noise §4.3 (HMAC-SHA256, zwei Ausgaben) */
function hkdf(ck: Uint8Array, ikm: Uint8Array): [Uint8Array, Uint8Array] {
  const temp = hmac(sha256, ck, ikm);
  const eins = hmac(sha256, temp, Uint8Array.of(1));
  return [eins, hmac(sha256, temp, verbinde(eins, Uint8Array.of(2)))];
}

export interface NoiseSchluessel {
  geheim: Uint8Array;
  oeffentlich: Uint8Array;
}

export function noiseSchluessel(geheim: Uint8Array = x25519.utils.randomSecretKey()): NoiseSchluessel {
  if (geheim.length !== 32) throw new NoiseFehler("form");
  return { geheim, oeffentlich: x25519.getPublicKey(geheim) };
}

/** Die beiden Richtungen nach dem Handshake, als Chiffre nach Noise (implizite Nonce) */
export interface NoiseSplit {
  senden: { verschluessele(ad: Uint8Array, klar: Uint8Array): Uint8Array };
  empfangen: { entschluessele(ad: Uint8Array, geheim: Uint8Array): Uint8Array };
  /** Hash des Handshakes (Kanalbindung) */
  hash: Uint8Array;
  /** statischer Schlüssel der Gegenseite */
  entfernt: Uint8Array;
}

/**
 * Handshake XX: → e · ← e, ee, s, es · → s, se. Wer beginnt, ist `initiator`. `ephemeral` nur für Tests (Vektoren) –
 * sonst ein frischer Schlüssel je Handshake. Scheitert ein Schritt, ist der Handshake vorbei (`abgebrochen`) – sein
 * Zustand ist dann halb fortgeschrieben; weiter geht es nur mit einem neuen.
 */
export class NoiseXX {
  private ck: Uint8Array;
  private h: Uint8Array;
  private c = new Chiffre();
  private e: NoiseSchluessel | null = null;
  private re: Uint8Array | null = null;
  private rs: Uint8Array | null = null;
  private schritt = 0;
  private kaputt = false;

  constructor(
    readonly initiator: boolean,
    private readonly s: NoiseSchluessel,
    o: { prolog?: Uint8Array; ephemeral?: NoiseSchluessel } = {},
  ) {
    this.h = new TextEncoder().encode(NOISE_NAME); // genau 32 Byte – ohne Hash
    this.ck = this.h;
    this.mischeHash(o.prolog ?? new Uint8Array(0));
    if (o.ephemeral) this.e = o.ephemeral;
  }

  private mischeHash(d: Uint8Array): void {
    this.h = sha256(verbinde(this.h, d));
  }
  private mischeSchluessel(ikm: Uint8Array): void {
    const [ck, k] = hkdf(this.ck, ikm);
    this.ck = ck;
    this.c = new Chiffre(k);
  }
  private verschluesseleUndHash(klar: Uint8Array): Uint8Array {
    const geheim = this.c.verschluessele(this.h, klar);
    this.mischeHash(geheim);
    return geheim;
  }
  private entschluesseleUndHash(geheim: Uint8Array): Uint8Array {
    const klar = this.c.entschluessele(this.h, geheim);
    this.mischeHash(geheim);
    return klar;
  }
  private dh(eigen: NoiseSchluessel, fremd: Uint8Array): Uint8Array {
    return x25519.getSharedSecret(eigen.geheim, fremd);
  }

  /** Ob als Nächstes geschrieben wird (sonst gelesen) */
  get schreibtJetzt(): boolean {
    return this.schritt < 3 && (this.schritt % 2 === 0) === this.initiator;
  }
  get fertig(): boolean {
    return this.schritt === 3;
  }

  schreibe(nutzlast: Uint8Array = new Uint8Array(0)): Uint8Array {
    return this.einmal(() => this.schreibeSchritt(nutzlast));
  }

  lies(nachricht: Uint8Array): Uint8Array {
    return this.einmal(() => this.liesSchritt(nachricht));
  }

  private einmal<T>(f: () => T): T {
    if (this.kaputt) throw new NoiseFehler("abgebrochen");
    try {
      return f();
    } catch (e) {
      if (!(e instanceof NoiseFehler && e.fall === "reihenfolge")) this.kaputt = true;
      throw e;
    }
  }

  private schreibeSchritt(nutzlast: Uint8Array): Uint8Array {
    if (!this.schreibtJetzt) throw new NoiseFehler("reihenfolge");
    const teile: Uint8Array[] = [];
    if (this.schritt === 0 || this.schritt === 1) {
      this.e ??= noiseSchluessel();
      teile.push(this.e.oeffentlich);
      this.mischeHash(this.e.oeffentlich);
    }
    if (this.schritt === 1) {
      this.mischeSchluessel(this.dh(this.e!, this.re!)); // ee
      teile.push(this.verschluesseleUndHash(this.s.oeffentlich)); // s
      this.mischeSchluessel(this.dh(this.s, this.re!)); // es
    } else if (this.schritt === 2) {
      teile.push(this.verschluesseleUndHash(this.s.oeffentlich)); // s
      this.mischeSchluessel(this.dh(this.s, this.re!)); // se
    }
    teile.push(this.verschluesseleUndHash(nutzlast));
    this.schritt++;
    return verbinde(...teile);
  }

  private liesSchritt(nachricht: Uint8Array): Uint8Array {
    if (this.schreibtJetzt || this.fertig) throw new NoiseFehler("reihenfolge");
    let i = 0;
    const nimm = (n: number): Uint8Array => {
      if (i + n > nachricht.length) throw new NoiseFehler("form");
      return nachricht.subarray(i, (i += n));
    };
    if (this.schritt === 0 || this.schritt === 1) {
      this.re = nimm(32).slice();
      this.mischeHash(this.re);
    }
    if (this.schritt === 1) {
      this.mischeSchluessel(this.dh(this.e!, this.re!)); // ee
      this.rs = this.entschluesseleUndHash(nimm(48)).slice(); // s
      this.mischeSchluessel(this.dh(this.e!, this.rs)); // es
    } else if (this.schritt === 2) {
      this.rs = this.entschluesseleUndHash(nimm(48)).slice(); // s
      this.mischeSchluessel(this.dh(this.e!, this.rs)); // se
    }
    const nutzlast = this.entschluesseleUndHash(nachricht.subarray(i));
    this.schritt++;
    return nutzlast;
  }

  /** Nach dem dritten Schritt: die Chiffren beider Richtungen (§5.2 Split) */
  teile(): NoiseSplit {
    if (this.kaputt) throw new NoiseFehler("abgebrochen");
    if (!this.fertig || !this.rs) throw new NoiseFehler("reihenfolge");
    const [k1, k2] = hkdf(this.ck, new Uint8Array(0));
    const [senden, empfangen] = this.initiator ? [new Chiffre(k1), new Chiffre(k2)] : [new Chiffre(k2), new Chiffre(k1)];
    return { senden, empfangen, hash: this.h, entfernt: this.rs };
  }
}

/**
 * Transport wie Bitchat: 4 Byte Nonce (Großendian) vor dem Chiffrat, ohne zusätzliche Daten; empfangen wird jede Nonce
 * höchstens einmal und nur innerhalb von 1024 hinter der höchsten.
 */
export class BitchatTransport {
  private naechste = 0;
  private hoechste = 0;
  private gesehen = new Uint8Array(NOISE_GRENZEN.fenster / 8);
  private readonly senden: Chiffre;
  private readonly empfangen: Chiffre;

  constructor(split: NoiseSplit) {
    this.senden = split.senden as Chiffre;
    this.empfangen = split.empfangen as Chiffre;
  }

  verschluessele(klar: Uint8Array): Uint8Array {
    if (klar.length > NOISE_GRENZEN.nachricht) throw new NoiseFehler("form");
    if (this.naechste > NOISE_GRENZEN.nonce) throw new NoiseFehler("nonce-ende");
    const n = this.naechste++;
    this.senden.n = n;
    const kopf = new Uint8Array(4);
    new DataView(kopf.buffer).setUint32(0, n);
    return verbinde(kopf, this.senden.verschluessele(new Uint8Array(0), klar));
  }

  entschluessele(daten: Uint8Array): Uint8Array {
    if (daten.length < 4 + 16) throw new NoiseFehler("form");
    const n = new DataView(daten.buffer, daten.byteOffset, 4).getUint32(0);
    if (!this.frisch(n)) throw new NoiseFehler("wiederholt");
    const klar = this.empfangen.entschluessele(new Uint8Array(0), daten.subarray(4), n);
    this.merke(n);
    return klar;
  }

  private frisch(n: number): boolean {
    if (this.hoechste >= NOISE_GRENZEN.fenster && n <= this.hoechste - NOISE_GRENZEN.fenster) return false;
    if (n > this.hoechste) return true;
    const ab = this.hoechste - n;
    return (this.gesehen[ab >> 3] & (1 << (ab & 7))) === 0;
  }

  private merke(n: number): void {
    if (n > this.hoechste) {
      const schub = n - this.hoechste;
      const neu = new Uint8Array(this.gesehen.length);
      if (schub < NOISE_GRENZEN.fenster) {
        for (let ab = 0; ab + schub < NOISE_GRENZEN.fenster; ab++) {
          if (this.gesehen[ab >> 3] & (1 << (ab & 7))) neu[(ab + schub) >> 3] |= 1 << ((ab + schub) & 7);
        }
      }
      this.gesehen = neu;
      this.hoechste = n;
    }
    const ab = this.hoechste - n;
    this.gesehen[ab >> 3] |= 1 << (ab & 7);
  }
}
