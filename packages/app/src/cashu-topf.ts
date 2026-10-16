/**
 * Cashu-Topf (A-17c, `docs/E4B-ENTWURF.md`, V3 mit RM2 W5 A), ohne DOM.
 *
 * Cashu ist verwahrt: Hinter den Token steht das Versprechen der Mint, nicht Freedom. Der Topf
 * kennt genau eine Mint, die der Nutzer gewählt hat (`waehleMint()`), und nur Mints, die NUT-11
 * (Sperre auf einen Schlüssel) und NUT-12 (Beweis der Signatur, offline prüfbar) melden.
 * Höchstens `CASHU_HOECHST_SAT` liegen darin – Guthaben, gesperrt Empfangenes und offene
 * Ladungen zusammen (E4b W4).
 *
 * - Laden (NUT-04): `ladeAnfrage()` liefert eine Rechnung der Mint, geprüft auf den Betrag; zahlen
 *   muss der Aufrufer über die Zahlschienen. Danach `abholen()`.
 * - Senden: `sende()` tauscht bei der Mint und gibt ein Token zurück – auf Wunsch gesperrt auf den
 *   Schlüssel des Empfängers (NUT-11), dann kann es nur er einlösen.
 * - Empfangen: `empfange()` tauscht bei der Mint. Ohne Netz nimmt `nimmOhneNetz()` nur Token, die
 *   die Mint nachweislich signiert hat (NUT-12) und die genau auf den eigenen Schlüssel gesperrt
 *   sind, ohne Frist – die kann niemand sonst ausgeben; eingelöst werden sie mit `einloesen()`.
 *
 * Alles liegt nur im Tresor (`freedom.cashu`, V2): Token sind Bargeld. Ohne offenen Tresor schreibt
 * der Topf nichts. Neue Token entstehen aus einem eigenen Seed (NUT-13): Bricht ein Tausch nach der
 * Antwort der Mint und vor dem Speichern ab, holt `nachholen()` sie aus genau dem Zählerbereich
 * dieses Tauschs zurück (NUT-09) – nie aus früheren, sonst kämen gesendete Token zurück.
 * Nach außen nur `CashuFehler.fall`.
 */
import {
  P2PKBuilder, Wallet, deserializeProofs, getEncodedToken, getP2PKExpectedWitnessPubkeys,
  getPubKeyFromPrivKey, hasValidDleq, isMintOperationError, parseP2PKSecret, serializeProofs, sumProofs,
  type CounterSource, type GetInfoResponse, type KeyChainCache, type Proof, type Token,
} from "@cashu/cashu-ts";
import { isPrivateAddress, leseBolt11 } from "@freedomstack/protocol";

export const LS_CASHU = "freedom.cashu";
/** Höchstbetrag im Topf (E4b W4, MENSCH 11.10.2026). */
export const CASHU_HOECHST_SAT = 10_000;

export type CashuFall =
  | "tresor" | "mint-adresse" | "mint-netz" | "mint-ohne-nut11" | "mint-ohne-nut12" | "mint-ohne-sat" | "mint-wechsel"
  | "keine-mint" | "betrag" | "zu-viel" | "zu-wenig" | "rechnung" | "unbezahlt" | "token" | "fremde-mint" | "ohne-dleq"
  | "nicht-gesperrt" | "ausgegeben" | "laufend";

export class CashuFehler extends Error {
  constructor(readonly fall: CashuFall) {
    super(`Cashu: ${fall}`); // kein UI-Text
    this.name = "CashuFehler";
  }
}

export interface CashuSpeicher {
  getItem(k: string): string | null;
  setItem(k: string, v: string): Promise<void>;
}

interface Stand {
  fassung: 1;
  mint?: string;
  /** Für ohne Netz: Angaben und Schlüssel der Mint, gemerkt beim letzten Laden. */
  info?: GetInfoResponse;
  schluesselbund?: KeyChainCache;
  /** Seed für eigene Token (NUT-13) und Empfangsschlüssel (NUT-11), je 32 Byte hex. */
  seed: string;
  sk: string;
  zaehler: Record<string, number>;
  /** Token, serialisiert (`serializeProofs()`). */
  proofs: string[];
  /** Ohne Netz empfangen, auf den eigenen Schlüssel gesperrt, noch nicht eingelöst. */
  gesperrt: string[];
  /** Ladungen (NUT-04), noch nicht abgeholt; `bis` aus der Mint (Unix-Sekunden), danach zählen sie nicht mehr. */
  offen: Array<{ quote: string; betrag: number; bis: number | null }>;
  /** Ein Tausch läuft: Zähler davor und die eingesetzten Token – für `nachholen()`. */
  laufend?: { zaehler: Record<string, number>; eingesetzt: string[] };
}

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const zufall = (n: number): string => hex(crypto.getRandomValues(new Uint8Array(n)));
const vonHex = (h: string): Uint8Array => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const summe = (p: Proof[]): number => sumProofs(p).toNumber();

/**
 * Adresse einer Mint: https, ohne Zugangsdaten, kein Rechner im Heimnetz; `.onion` auch über http.
 * `lokal` nur für Tests gegen eine Mint auf diesem Rechner.
 */
export function pruefeMintAdresse(eingabe: string, o: { lokal?: boolean } = {}): string {
  let u: URL;
  try {
    u = new URL(eingabe.trim());
  } catch {
    throw new CashuFehler("mint-adresse");
  }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const onion = host.endsWith(".onion");
  const ip = /^[\d.]+$/.test(host) || host.includes(":");
  const lokal = host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost") || (ip && isPrivateAddress(host))
    || (!host.includes(".") && !ip);
  if (u.username || u.password || u.search || u.hash) throw new CashuFehler("mint-adresse");
  if (o.lokal && lokal) return u.origin + u.pathname.replace(/\/+$/, "");
  if (lokal || !(u.protocol === "https:" || (onion && u.protocol === "http:"))) throw new CashuFehler("mint-adresse");
  return u.origin + u.pathname.replace(/\/+$/, "");
}

export interface TopfOptionen {
  /** Ist der Tresor eingerichtet und offen? Ohne ihn schreibt der Topf nichts (V2). */
  tresorOffen: () => boolean;
  /** Nur Tests: Mint auf diesem Rechner erlaubt. */
  lokal?: boolean;
  jetzt?: () => number;
}

export class CashuTopf {
  constructor(private readonly speicher: CashuSpeicher, private readonly o: TopfOptionen) {}

  private jetzt(): number {
    return Math.floor((this.o.jetzt?.() ?? Date.now()) / 1000);
  }

  private lies(): Stand {
    try {
      const s = JSON.parse(this.speicher.getItem(LS_CASHU) ?? "null") as Stand | null;
      if (s?.fassung === 1 && Array.isArray(s.proofs)) return s;
    } catch { /* unten neu */ }
    return { fassung: 1, seed: zufall(32), sk: zufall(32), zaehler: {}, proofs: [], gesperrt: [], offen: [] };
  }

  private async schreibe(s: Stand): Promise<void> {
    if (!this.o.tresorOffen()) throw new CashuFehler("tresor");
    await this.speicher.setItem(LS_CASHU, JSON.stringify(s));
  }

  mint(): string | undefined {
    return this.lies().mint;
  }

  /** Guthaben in sat (ohne gesperrt Empfangenes). */
  guthaben(): number {
    return summe(deserializeProofs(this.lies().proofs));
  }

  /** Ohne Netz empfangen, noch einzulösen. */
  gesperrt(): number {
    return summe(deserializeProofs(this.lies().gesperrt));
  }

  /** Der Schlüssel, auf den andere Token für diesen Topf sperren (NUT-11, komprimiert, hex). */
  empfangsSchluessel(): string {
    // Erst mit gemerktem Stand – sonst entstünde bei jedem Aufruf ein anderer
    if (this.speicher.getItem(LS_CASHU) === null) throw new CashuFehler("keine-mint");
    return hex(getPubKeyFromPrivKey(vonHex(this.lies().sk)));
  }

  private belegt(s: Stand): number {
    const offen = s.offen.filter((x) => x.bis === null || x.bis > this.jetzt());
    return summe(deserializeProofs(s.proofs)) + summe(deserializeProofs(s.gesperrt)) + offen.reduce((n, x) => n + x.betrag, 0);
  }

  /** Zähler der eigenen Token im Tresor – jede Reservierung ist geschrieben, bevor die Mint sie sieht. */
  private zaehlerQuelle(): CounterSource {
    return {
      reserve: async (id, n) => {
        const s = this.lies();
        const start = s.zaehler[id] ?? 0;
        if (n > 0) await this.schreibe({ ...s, zaehler: { ...s.zaehler, [id]: start + n } });
        return { start, count: n };
      },
      advanceToAtLeast: async (id, min) => {
        const s = this.lies();
        if ((s.zaehler[id] ?? 0) < min) await this.schreibe({ ...s, zaehler: { ...s.zaehler, [id]: min } });
      },
    };
  }

  /** Die Mint mit Netz laden und ihre Angaben für ohne Netz merken. */
  private async wallet(): Promise<{ w: Wallet; s: Stand }> {
    const s = this.lies();
    if (!s.mint) throw new CashuFehler("keine-mint");
    const w = new Wallet(s.mint, { unit: "sat", bip39seed: vonHex(s.seed), counterSource: this.zaehlerQuelle(), requireSigDleq: true });
    try {
      await w.loadMint(true);
    } catch {
      throw new CashuFehler("mint-netz");
    }
    const neu = { ...this.lies(), info: w.getMintInfo().cache, schluesselbund: w.keyChain.cache };
    await this.schreibe(neu);
    return { w, s: neu };
  }

  /** Mint wählen: nur mit NUT-11, NUT-12 und Laden in sat; wechseln nur mit leerem Topf. */
  async waehleMint(adresse: string): Promise<{ name?: string }> {
    const url = pruefeMintAdresse(adresse, { lokal: this.o.lokal });
    const s = this.lies();
    if (s.mint && s.mint !== url && (this.belegt(s) > 0 || s.laufend)) throw new CashuFehler("mint-wechsel");
    const w = new Wallet(url, { unit: "sat" });
    try {
      await w.loadMint();
    } catch {
      throw new CashuFehler("mint-netz");
    }
    const info = w.getMintInfo();
    if (!info.isSupported(11).supported) throw new CashuFehler("mint-ohne-nut11");
    if (!info.isSupported(12).supported) throw new CashuFehler("mint-ohne-nut12");
    const laden = info.isSupported(4);
    if (laden.disabled || !laden.params.some((m) => m.method === "bolt11" && m.unit === "sat")) throw new CashuFehler("mint-ohne-sat");
    await this.schreibe({ ...s, mint: url, info: info.cache, schluesselbund: w.keyChain.cache });
    return { name: info.name };
  }

  /** Laden (NUT-04): die Rechnung der Mint – geprüft, dass sie genau den Betrag nennt. Zahlen: Aufrufer, über die Schienen. */
  async ladeAnfrage(betrag: number): Promise<{ quote: string; rechnung: string }> {
    if (!Number.isSafeInteger(betrag) || betrag <= 0) throw new CashuFehler("betrag");
    const { w, s } = await this.wallet();
    if (this.belegt(s) + betrag > CASHU_HOECHST_SAT) throw new CashuFehler("zu-viel");
    const q = await w.createMintQuoteBolt11(betrag).catch(() => { throw new CashuFehler("mint-netz"); });
    let msat: number | null = null;
    try {
      msat = leseBolt11(q.request).betragMsat;
    } catch { /* unten */ }
    if (msat !== betrag * 1000) throw new CashuFehler("rechnung");
    const t = this.lies();
    const bis = typeof q.expiry === "number" ? q.expiry : null;
    await this.schreibe({ ...t, offen: [...t.offen.filter((x) => x.bis === null || x.bis > this.jetzt()), { quote: q.quote, betrag, bis }] });
    return { quote: q.quote, rechnung: q.request };
  }

  /** Nach dem Bezahlen: die Token der Ladung abholen. */
  async abholen(quote: string): Promise<number> {
    const { w, s } = await this.wallet();
    const auftrag = s.offen.find((x) => x.quote === quote);
    if (!auftrag) throw new CashuFehler("unbezahlt");
    const stand = await w.checkMintQuoteBolt11(quote).catch(() => { throw new CashuFehler("mint-netz"); });
    const vergiss = async () => {
      const t = this.lies();
      await this.schreibe({ ...t, offen: t.offen.filter((x) => x.quote !== quote) });
    };
    if (stand.state === "UNPAID") throw new CashuFehler("unbezahlt");
    // Schon abgeholt (anderes Gerät, oder vor einem Abbruch – dann holt `nachholen()` die Token)
    if (stand.state === "ISSUED") {
      await vergiss();
      throw new CashuFehler("ausgegeben");
    }
    const neu = await this.tausche(s, [], "proofs", () => w.mintProofsBolt11(auftrag.betrag, quote));
    await vergiss();
    return summe(neu);
  }

  /**
   * Ein Tausch mit Absicherung: erst Zähler und eingesetzte Token als `laufend` merken (und die
   * Token aus dem Guthaben nehmen), dann die Mint, dann das Ergebnis – in einem Schreiben.
   */
  private async tausche(
    s: Stand, eingesetzt: Proof[], woher: "proofs" | "gesperrt", lauf: () => Promise<Proof[]>, behalten?: (p: Proof[]) => Proof[],
  ): Promise<Proof[]> {
    if (s.laufend) throw new CashuFehler("laufend");
    const weg = new Set(eingesetzt.map((p) => p.secret));
    const rest = deserializeProofs(s[woher]).filter((p) => !weg.has(p.secret));
    await this.schreibe({ ...s, [woher]: serializeProofs(rest), laufend: { zaehler: { ...s.zaehler }, eingesetzt: serializeProofs(eingesetzt) } });
    let neu: Proof[];
    try {
      neu = await lauf();
    } catch (e) {
      // Die Mint hat abgelehnt: nichts verbraucht – die Token zurück, wo sie waren
      const t = this.lies();
      await this.schreibe({ ...t, [woher]: serializeProofs([...deserializeProofs(t[woher]), ...eingesetzt]), laufend: undefined });
      throw e instanceof CashuFehler ? e : isMintOperationError(e) ? new CashuFehler("ausgegeben") : new CashuFehler("mint-netz");
    }
    const t = this.lies();
    const bleibt = behalten ? behalten(neu) : neu;
    await this.schreibe({ ...t, proofs: serializeProofs([...deserializeProofs(t.proofs), ...bleibt]), laufend: undefined });
    return neu;
  }

  /** Token lesen und gegen die eigene Mint prüfen. */
  private leseToken(w: Wallet, s: Stand, token: string): Token {
    let t: Token;
    try {
      t = w.decodeToken(token.trim());
    } catch {
      throw new CashuFehler("token");
    }
    let mint: string;
    try {
      mint = pruefeMintAdresse(t.mint, { lokal: this.o.lokal });
    } catch {
      throw new CashuFehler("fremde-mint");
    }
    if (mint !== s.mint || (t.unit ?? "sat") !== "sat" || t.proofs.length === 0) throw new CashuFehler(mint !== s.mint ? "fremde-mint" : "token");
    // NUT-12: jede Signatur der Mint nachweisbar – sonst nehmen wir nichts
    for (const p of t.proofs) {
      let ok = false;
      try {
        ok = hasValidDleq(p, w.getKeyset(p.id), { require: true });
      } catch { /* unbekannter Schlüssel der Mint */ }
      if (!ok) throw new CashuFehler("ohne-dleq");
    }
    return t;
  }

  /** Empfangen mit Netz: bei der Mint tauschen (gesperrte auf den eigenen Schlüssel werden dabei unterschrieben). */
  async empfange(token: string): Promise<number> {
    const { w, s } = await this.wallet();
    const t = this.leseToken(w, s, token);
    // Auf einen anderen Schlüssel gesperrt: einlösen könnte nur er
    if (t.proofs.some((p) => !fuerMich(p, this.empfangsSchluessel()))) throw new CashuFehler("nicht-gesperrt");
    if (this.belegt(s) + summe(t.proofs) > CASHU_HOECHST_SAT) throw new CashuFehler("zu-viel");
    const neu = await this.tausche(s, [], "proofs", () => w.ops.receive(t).privkey(s.sk).requireDleq(true).run());
    return summe(neu);
  }

  /**
   * Ohne Netz prüfen (NUT-11, NUT-12): signiert von der eigenen Mint, jeder Teil gesperrt genau auf
   * den eigenen Schlüssel, ohne Frist und ohne Rückgabe-Schlüssel. Liefert den Betrag.
   */
  pruefeOhneNetz(token: string): number {
    const s = this.lies();
    if (!s.mint || !s.info || !s.schluesselbund) throw new CashuFehler("keine-mint");
    const w = new Wallet(s.mint, { unit: "sat" });
    w.loadMintFromCache(s.info, s.schluesselbund);
    const t = this.leseToken(w, s, token);
    const ich = this.empfangsSchluessel();
    for (const p of t.proofs) {
      let erwartet: string[] = [];
      let tags: string[][] = [];
      try {
        erwartet = getP2PKExpectedWitnessPubkeys(p.secret);
        tags = parseP2PKSecret(p.secret)[1].tags ?? [];
      } catch { /* kein P2PK */ }
      const frei = tags.every(([k]) => k !== "locktime" && k !== "refund" && k !== "pubkeys" && k !== "n_sigs");
      if (erwartet.length !== 1 || erwartet[0] !== ich || !frei) throw new CashuFehler("nicht-gesperrt");
    }
    if (this.belegt(s) + summe(t.proofs) > CASHU_HOECHST_SAT) throw new CashuFehler("zu-viel");
    return summe(t.proofs);
  }

  /** Ohne Netz annehmen: geprüft wie `pruefeOhneNetz()`, gemerkt bis `einloesen()`; Doppeltes zählt einmal. */
  async nimmOhneNetz(token: string): Promise<number> {
    const betrag = this.pruefeOhneNetz(token);
    const s = this.lies();
    const w = new Wallet(s.mint!, { unit: "sat" });
    w.loadMintFromCache(s.info!, s.schluesselbund!);
    const da = new Set(deserializeProofs(s.gesperrt).map((p) => p.secret));
    const neu = w.decodeToken(token.trim()).proofs.filter((p) => !da.has(p.secret));
    await this.schreibe({ ...s, gesperrt: [...s.gesperrt, ...serializeProofs(neu)] });
    return neu.length === 0 ? 0 : betrag;
  }

  /** Ohne Netz Empfangenes mit Netz einlösen. */
  async einloesen(): Promise<number> {
    const { w, s } = await this.wallet();
    const gesperrt = deserializeProofs(s.gesperrt);
    if (gesperrt.length === 0) return 0;
    const neu = await this.tausche(s, gesperrt, "gesperrt", () => w.ops.receive(gesperrt).privkey(s.sk).requireDleq(true).run());
    return summe(neu);
  }

  /**
   * Senden: bei der Mint tauschen, das Wechselgeld bleibt im Topf. Mit `an` (Schlüssel des
   * Empfängers, hex) ist das Token auf ihn gesperrt; die Gebühr für sein Einlösen trägt der Absender.
   */
  async sende(betrag: number, o: { an?: string } = {}): Promise<string> {
    if (!Number.isSafeInteger(betrag) || betrag <= 0) throw new CashuFehler("betrag");
    const { w, s } = await this.wallet();
    if (s.laufend) throw new CashuFehler("laufend");
    const proofs = deserializeProofs(s.proofs);
    if (summe(proofs) < betrag) throw new CashuFehler("zu-wenig");
    let senden: Proof[] = [];
    await this.tausche(s, proofs, "proofs", async () => {
      let op = w.ops.send(betrag, proofs);
      if (o.an !== undefined) op = op.asP2PK(new P2PKBuilder().addLockPubkey(o.an).toOptions()).includeFees(true);
      const r = await op.run();
      senden = r.send;
      return [...r.keep, ...r.send];
    }, (alle) => alle.filter((p) => !senden.includes(p)));
    return getEncodedToken({ mint: s.mint!, unit: "sat", proofs: senden });
  }

  /**
   * Nach einem Abbruch mitten im Tausch: die Token aus dem Zählerbereich dieses Tauschs bei der
   * Mint neu ableiten (NUT-09) und die eingesetzten prüfen – nicht Ausgegebenes kommt zurück.
   */
  async nachholen(): Promise<number> {
    const { w, s } = await this.wallet();
    if (!s.laufend) return 0;
    const wieder: Proof[] = [];
    try {
      // Auch Schlüssel der Mint, die vor dem Tausch noch keinen Zähler hatten
      for (const [id, bis] of Object.entries(s.zaehler)) {
        const ab = s.laufend.zaehler[id] ?? 0;
        if (bis > ab) wieder.push(...(await w.restore(ab, bis - ab, { keysetId: id })).proofs);
      }
      const pruefen = [...wieder, ...deserializeProofs(s.laufend.eingesetzt)];
      const staende = pruefen.length ? await w.checkProofsStates(pruefen) : [];
      const t = this.lies();
      const da = new Set([...deserializeProofs(t.proofs), ...deserializeProofs(t.gesperrt)].map((p) => p.secret));
      const zurueck = pruefen.filter((p, i) => staende[i]?.state === "UNSPENT" && !da.has(p.secret));
      // Auf mich Gesperrtes (ohne Netz empfangen) bleibt gesperrt – einlösen geht nur mit Unterschrift
      const gesperrt = zurueck.filter((p) => istP2pk(p));
      const frei = zurueck.filter((p) => !istP2pk(p));
      await this.schreibe({
        ...t, laufend: undefined,
        proofs: serializeProofs([...deserializeProofs(t.proofs), ...frei]),
        gesperrt: serializeProofs([...deserializeProofs(t.gesperrt), ...gesperrt]),
      });
      return summe(zurueck);
    } catch (e) {
      throw e instanceof CashuFehler ? e : new CashuFehler("mint-netz");
    }
  }
}

function istP2pk(p: Proof): boolean {
  try {
    return parseP2PKSecret(p.secret)[0] === "P2PK";
  } catch {
    return false;
  }
}

/** Ein Token-Teil, den ich einlösen kann: ungesperrt, auf mich gesperrt oder nach Ablauf für alle. */
function fuerMich(p: Proof, ich: string): boolean {
  if (!istP2pk(p)) return true;
  const erwartet = getP2PKExpectedWitnessPubkeys(p.secret);
  return erwartet.length === 0 || erwartet.includes(ich);
}
