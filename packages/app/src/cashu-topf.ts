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
 * - Pfand (RM2c, `docs/RM2-ENTWURF.md` V1/V6): `pfandFuer()` sperrt ein Fenster auf den Pfand-Schlüssel
 *   eines Providers (NUT-11, mit Frist und eigenem Rückweg-Schlüssel) und gibt je Auftrag so viele
 *   Token heraus, dass übergeben mindestens abgerechnet plus Bedarf ist – je Provider und
 *   Sitzungsschlüssel, netto wie der Knoten (`PfandKasse`). Nach der Frist holt `holePfandZurueck()`
 *   zurück, was der Provider nicht eingelöst hat.
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
import { PFAND_GRENZEN, isPrivateAddress, leseBolt11, type Pfand, type PfandToken } from "@freedomstack/protocol";

export const LS_CASHU = "freedom.cashu";
/** Höchstbetrag im Topf (E4b W4, MENSCH 11.10.2026). */
export const CASHU_HOECHST_SAT = 10_000;
/** Pfand (RM2c, V6): ein Fenster in sat und seine Frist – wie bisher die Sitzung (20 sats, eine Stunde). */
export const PFAND_FENSTER_SAT = 20;
export const PFAND_FRIST_SEK = 3600;
/** Spielraum über der Mindestfrist des Providers (`PFAND_GRENZEN.restSek`) für Uhr und Weg. */
export const PFAND_SPIELRAUM_SEK = 5 * 60;

export type CashuFall =
  | "tresor" | "mint-adresse" | "mint-netz" | "mint-ohne-nut11" | "mint-ohne-nut12" | "mint-ohne-sat" | "mint-wechsel"
  | "keine-mint" | "betrag" | "zu-viel" | "zu-wenig" | "rechnung" | "unbezahlt" | "token" | "fremde-mint" | "ohne-dleq"
  | "nicht-gesperrt" | "ausgegeben" | "laufend" | "pfand-schluessel";

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
  /** Ein Tausch läuft: Zähler davor und die eingesetzten Token – für `nachholen()`; beim Rückweg das Fenster. */
  laufend?: { zaehler: Record<string, number>; eingesetzt: string[]; fenster?: Fenster };
  /** Pfand (RM2c): gesperrte Fenster und je Provider und Sitzungsschlüssel das Konto (msat). */
  pfand?: Fenster[];
  konten?: Record<string, { uebergeben: number; abgerechnet: number; bis: number }>;
}

/** Ein Fenster: Token, gesperrt auf den Pfand-Schlüssel eines Providers bis `frist`, danach über `rueck` zurück. */
interface Fenster {
  provider: string;
  sitzung: string;
  an: string;
  frist: number;
  /** Rückweg-Schlüssel, 32 Byte hex – je Fenster frisch. */
  rueck: string;
  token: string[];
  uebergeben: string[];
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
    return summe(deserializeProofs(s.proofs)) + summe(deserializeProofs(s.gesperrt)) + offen.reduce((n, x) => n + x.betrag, 0)
      + summe(deserializeProofs((s.pfand ?? []).flatMap((f) => f.token)));
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
    s: Stand, eingesetzt: Proof[], woher: "proofs" | "gesperrt" | Fenster, lauf: () => Promise<Proof[]>, behalten?: (p: Proof[]) => Proof[],
    dazu?: (t: Stand) => Partial<Stand>,
  ): Promise<Proof[]> {
    if (s.laufend) throw new CashuFehler("laufend");
    const weg = new Set(eingesetzt.map((p) => p.secret));
    const ohne = typeof woher === "string"
      ? { [woher]: serializeProofs(deserializeProofs(s[woher]).filter((p) => !weg.has(p.secret))) }
      : { pfand: (s.pfand ?? []).filter((f) => f !== woher) };
    const laufend = { zaehler: { ...s.zaehler }, eingesetzt: serializeProofs(eingesetzt), ...(typeof woher === "string" ? {} : { fenster: woher }) };
    await this.schreibe({ ...s, ...ohne, laufend });
    let neu: Proof[];
    try {
      neu = await lauf();
    } catch (e) {
      // Ohne Antwort (Netz): ob die Mint getauscht hat, weiß nur sie – `laufend` bleibt, `nachholen()` klärt es (RM2c)
      if (!(e instanceof CashuFehler) && !isMintOperationError(e)) throw new CashuFehler("mint-netz");
      // Die Mint hat abgelehnt: nichts verbraucht – die Token zurück, wo sie waren
      const t = this.lies();
      const zurueck = typeof woher === "string"
        ? { [woher]: serializeProofs([...deserializeProofs(t[woher]), ...eingesetzt]) }
        : { pfand: [...(t.pfand ?? []), woher] };
      await this.schreibe({ ...t, ...zurueck, laufend: undefined });
      throw e instanceof CashuFehler ? e : new CashuFehler("ausgegeben");
    }
    const t = this.lies();
    const bleibt = behalten ? behalten(neu) : neu;
    await this.schreibe({ ...t, proofs: serializeProofs([...deserializeProofs(t.proofs), ...bleibt]), laufend: undefined, ...dazu?.(t) });
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

  /** Läuft ein Tausch, den erst `nachholen()` klärt? */
  laufend(): boolean {
    return this.lies().laufend !== undefined;
  }

  /** Im Pfand gesperrt und noch nicht übergeben (sat) – nach der Frist holt `holePfandZurueck()` es zurück. */
  imPfand(): number {
    return summe(deserializeProofs((this.lies().pfand ?? []).flatMap((f) => f.token)));
  }

  /** Netto-Wert eines Tokens beim Provider (msat): Nennwert minus Gebühr der Mint je Token – wie `PfandKasse`. */
  private netto(s: Stand, p: Proof): number {
    const k = s.schluesselbund?.keysets.find((x) => x.id === p.id);
    return p.amount.toNumber() * 1000 - Math.max(0, k?.input_fee_ppk ?? 0);
  }

  /** Konto beim Provider – nach der letzten Frist vergisst der Knoten es, die App ebenso. */
  private konto(s: Stand, schluessel: string): { uebergeben: number; abgerechnet: number; bis: number } {
    const k = s.konten?.[schluessel];
    return k && k.bis > this.jetzt() ? k : { uebergeben: 0, abgerechnet: 0, bis: 0 };
  }

  /**
   * Pfand für einen Auftrag (RM2c, V1/V6): Token aus den Fenstern dieses Providers und
   * Sitzungsschlüssels, bis übergeben mindestens abgerechnet plus `bedarfMsat` ist – reicht kein
   * Fenster, wird ein neues gesperrt (Tausch bei der Mint). Reicht das Übergebene schon, ist die
   * Liste leer. `merke()` zählt die Token als übergeben – vor dem Senden aufrufen.
   */
  async pfandFuer(a: { provider: string; sitzung: string; an: string; bedarfMsat: number; fensterSat?: number }): Promise<{ pfand: Pfand; merke(): Promise<void> }> {
    if (!/^0[23][0-9a-f]{64}$/.test(a.an)) throw new CashuFehler("pfand-schluessel");
    if (!Number.isSafeInteger(a.bedarfMsat) || a.bedarfMsat < 0) throw new CashuFehler("betrag");
    const id = `${a.provider}:${a.sitzung}`;
    let s = this.lies();
    const mint = s.mint;
    if (!mint) throw new CashuFehler("keine-mint");
    const fehlt = (t: Stand) => this.konto(t, id).abgerechnet + a.bedarfMsat - this.konto(t, id).uebergeben;
    // Nur Token, deren Frist der Provider noch annimmt
    const brauchbar = (t: Stand) => (t.pfand ?? []).filter((f) => f.provider === a.provider && f.sitzung === a.sitzung && f.an === a.an
      && f.frist >= this.jetzt() + PFAND_GRENZEN.restSek + PFAND_SPIELRAUM_SEK);
    const frei = (t: Stand) => brauchbar(t).flatMap((f) => deserializeProofs(f.token));
    if (fehlt(s) > 0 && frei(s).reduce((n, p) => n + this.netto(s, p), 0) < fehlt(s)) {
      await this.sperreFenster(a, fehlt(s) - frei(s).reduce((n, p) => n + this.netto(s, p), 0));
      s = this.lies();
    }
    // Größte zuerst, solange sie nicht überschießen; dann das kleinste, das den Rest deckt
    let rest = fehlt(s);
    const wahl: Proof[] = [];
    const vorrat = frei(s).sort((x, y) => this.netto(s, y) - this.netto(s, x));
    for (const p of vorrat) {
      if (rest <= 0 || wahl.length >= PFAND_GRENZEN.token) break;
      if (this.netto(s, p) <= rest) {
        wahl.push(p);
        rest -= this.netto(s, p);
      }
    }
    if (rest > 0) {
      const p = vorrat.filter((x) => !wahl.includes(x) && this.netto(s, x) >= rest).pop();
      if (!p || wahl.length >= PFAND_GRENZEN.token) throw new CashuFehler("zu-wenig");
      wahl.push(p);
    }
    const token: PfandToken[] = wahl.map((p) => {
      if (!p.dleq?.r) throw new CashuFehler("ohne-dleq");
      return { id: p.id, amount: p.amount.toNumber(), secret: p.secret, C: p.C, dleq: { e: p.dleq.e, s: p.dleq.s, r: p.dleq.r } };
    });
    return {
      pfand: { mint, token },
      merke: async () => {
        const t = this.lies();
        const weg = new Set(wahl.map((p) => p.secret));
        // Nur, was noch im Fenster liegt – zweimal merken zählt nicht doppelt
        const raus: Proof[] = [];
        const fristen: number[] = [];
        const pfand = (t.pfand ?? []).map((f) => {
          const hier = deserializeProofs(f.token).filter((p) => weg.has(p.secret));
          if (hier.length === 0) return f;
          raus.push(...hier);
          fristen.push(f.frist);
          return { ...f, token: serializeProofs(deserializeProofs(f.token).filter((p) => !weg.has(p.secret))), uebergeben: [...f.uebergeben, ...serializeProofs(hier)] };
        });
        if (raus.length === 0) return;
        const k = this.konto(t, id);
        const uebergeben = k.uebergeben + raus.reduce((n, p) => n + this.netto(t, p), 0);
        // Wie der Knoten: das Konto gilt bis zur frühesten Frist der neuen Token, mindestens bis zur bisherigen
        await this.schreibe({ ...t, pfand, konten: { ...this.offeneKonten(t), [id]: { ...k, uebergeben, bis: Math.max(k.bis, Math.min(...fristen)) } } });
      },
    };
  }

  /** Konten, deren letzte Frist noch nicht vorbei ist. */
  private offeneKonten(t: Stand): NonNullable<Stand["konten"]> {
    return Object.fromEntries(Object.entries(t.konten ?? {}).filter(([, k]) => k.bis > this.jetzt()));
  }

  /** Preis eines Auftrags buchen (Anteil des Providers) – höchstens bis zum Übergebenen, wie der Knoten. */
  async pfandVerbucht(provider: string, sitzung: string, msat: number): Promise<number> {
    const t = this.lies();
    const id = `${provider}:${sitzung}`;
    const k = this.konto(t, id);
    const gebucht = Math.max(0, Math.min(Math.floor(msat), k.uebergeben - k.abgerechnet));
    if (gebucht > 0) await this.schreibe({ ...t, konten: { ...this.offeneKonten(t), [id]: { ...k, abgerechnet: k.abgerechnet + gebucht } } });
    return gebucht;
  }

  /** Ein Fenster sperren: mindestens `PFAND_FENSTER_SAT`, netto mindestens `fehltMsat`, klein gestückelt (V6). */
  private async sperreFenster(a: { provider: string; sitzung: string; an: string; fensterSat?: number }, fehltMsat: number): Promise<void> {
    const { w, s } = await this.wallet();
    if (s.laufend) throw new CashuFehler("laufend");
    const gebuehr = Math.max(0, s.schluesselbund?.keysets.find((k) => k.active && k.unit === "sat")?.input_fee_ppk ?? 0);
    let betrag = Math.max(a.fensterSat ?? PFAND_FENSTER_SAT, Math.ceil(fehltMsat / 1000));
    while (betrag * 1000 - gebuehr * stueckelung(betrag).length < fehltMsat) betrag++;
    const proofs = deserializeProofs(s.proofs);
    // Mit der Gebühr der Mint für alle eingesetzten Token – sonst scheiterte cashu-ts erst im Tausch
    const ppk = proofs.reduce((n, p) => n + Math.max(0, s.schluesselbund?.keysets.find((k) => k.id === p.id)?.input_fee_ppk ?? 0), 0);
    if (summe(proofs) < betrag + Math.ceil(ppk / 1000)) throw new CashuFehler("zu-wenig");
    const rueck = zufall(32);
    const frist = this.jetzt() + PFAND_FRIST_SEK;
    const sperre = new P2PKBuilder().addLockPubkey(a.an).lockUntil(frist).addRefundPubkey(hex(getPubKeyFromPrivKey(vonHex(rueck)))).toOptions();
    let gesperrt: Proof[] = [];
    await this.tausche(s, proofs, "proofs", async () => {
      const r = await w.ops.send(betrag, proofs).asP2PK(sperre, stueckelung(betrag)).run();
      gesperrt = r.send;
      return [...r.keep, ...r.send];
    }, (alle) => alle.filter((p) => !gesperrt.includes(p)), (t) => ({
      pfand: [...(t.pfand ?? []), { provider: a.provider, sitzung: a.sitzung, an: a.an, frist, rueck, token: serializeProofs(gesperrt), uebergeben: [] }],
    }));
  }

  /**
   * Nach der Frist (RM2c, V1.6): was der Provider nicht eingelöst hat, über den Rückweg zurück –
   * übergeben oder nicht. Eingelöstes fällt weg. Liefert die zurückgeholten sat.
   */
  async holePfandZurueck(): Promise<number> {
    const abgelaufen = (this.lies().pfand ?? []).filter((f) => f.frist < this.jetzt());
    if (abgelaufen.length === 0) return 0;
    const { w } = await this.wallet();
    let zurueck = 0;
    for (const f of abgelaufen) {
      const alle = deserializeProofs([...f.token, ...f.uebergeben]);
      const staende = await w.checkProofsStates(alle).catch(() => { throw new CashuFehler("mint-netz"); });
      const offen = alle.filter((_, i) => staende[i]?.state === "UNSPENT");
      const s = this.lies();
      if (offen.length === 0) {
        await this.schreibe({ ...s, pfand: (s.pfand ?? []).filter((x) => x.rueck !== f.rueck) });
        continue;
      }
      const jetzt = (s.pfand ?? []).find((x) => x.rueck === f.rueck);
      if (!jetzt) continue;
      try {
        zurueck += summe(await this.tausche(s, offen, jetzt, () => w.ops.receive(offen).privkey(f.rueck).run()));
      } catch (e) {
        // Die Mint lehnt ab (etwa ihre Uhr noch vor der Frist): das Fenster bleibt, der nächste Lauf versucht es wieder
        if (!(e instanceof CashuFehler && e.fall === "ausgegeben")) throw e;
      }
    }
    return zurueck;
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
      // Pfand auf dem Rückweg (RM2c): nicht Getauschtes bleibt im Fenster, bis der nächste Rückweg es holt
      const f = s.laufend.fenster;
      const imFenster = new Set(f ? deserializeProofs(s.laufend.eingesetzt).map((p) => p.secret) : []);
      const fensterRest = zurueck.filter((p) => imFenster.has(p.secret));
      // Auf mich Gesperrtes (ohne Netz empfangen) bleibt gesperrt – einlösen geht nur mit Unterschrift
      const gesperrt = zurueck.filter((p) => !imFenster.has(p.secret) && istP2pk(p));
      const frei = zurueck.filter((p) => !imFenster.has(p.secret) && !istP2pk(p));
      await this.schreibe({
        ...t, laufend: undefined,
        proofs: serializeProofs([...deserializeProofs(t.proofs), ...frei]),
        gesperrt: serializeProofs([...deserializeProofs(t.gesperrt), ...gesperrt]),
        ...(f && fensterRest.length > 0 ? { pfand: [...(t.pfand ?? []), { ...f, token: serializeProofs(fensterRest), uebergeben: [] }] } : {}),
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

/** Kleine Stückelung (V6): 1, 2, 4, … solange es reicht, der Rest in Zweierpotenzen – fein genug zum Übergeben. */
export function stueckelung(betrag: number): number[] {
  const teile: number[] = [];
  let rest = betrag;
  for (let p = 1; rest >= p; p *= 2) {
    teile.push(p);
    rest -= p;
  }
  for (let p = 1 << 30; p >= 1; p = Math.floor(p / 2)) {
    if (rest >= p) {
      teile.push(p);
      rest -= p;
    }
  }
  return teile.sort((x, y) => x - y);
}
