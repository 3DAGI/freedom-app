/**
 * Kasse des Providers für den Cashu-Pfand (RM2b1, `docs/RM2-ENTWURF.md` V1, `docs/PROTOCOL.md` §38) –
 * der Zahlkanal für Lightning, gebaut wie die `KanalKasse` des Solana-Zahlkanals.
 *
 * Mit jeder Anfrage übergibt der Kunde die nächsten Token, gesperrt auf den Pfand-Schlüssel des
 * Knotens (NUT-11). `nimmAn()` prüft sie ohne Mint (`pruefePfand()`: Signatur der Mint, Sperre,
 * Frist, nicht doppelt) und verlangt Deckung wie die KanalKasse: übergeben mindestens abgerechnet
 * plus Bedarf dieser Anfrage – je Sitzungsschlüssel, der die Anfrage signiert hat. Übergeben zählt
 * netto: ohne die Gebühr der Mint je Token, die beim Einlösen anfällt (NUT-02). `verbuche()`
 * bucht den Preis. `loeseFaelligeEin()` tauscht die Token bei der Mint gegen eigene, gesammelt und
 * spätestens zehn Minuten vor der Frist – danach holt der Kunde sie über seinen Rückweg zurück.
 *
 * Alles liegt in einer Datei (0600, über eine Zwischendatei geschrieben): Pfand-Schlüssel, Seed,
 * angenommene Token, gesehene Geheimnisse, Konten und der Erlös – Token sind Geld. Eine kaputte Datei
 * heißt kein Start, nie ersetzen. Eigene Token entstehen aus dem Seed (NUT-13); bricht ein Tausch ab,
 * holt `nachholen()` genau seinen Zählerbereich zurück (NUT-09) und prüft die eingesetzten Token.
 * Vor dem Einlösen fällt der Beweis (DLEQ) weg – sonst könnte die Mint Einzahlung und Einlösung
 * verbinden (V5). Nach außen nur Kennungen und Fehlernamen.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  Wallet, deserializeProofs, getPubKeyFromPrivKey, serializeProofs, sumProofs,
  type CounterSource, type GetInfoResponse, type KeyChainCache, type Proof,
} from "@cashu/cashu-ts";
import { PFAND_GRENZEN, istMintAdresse, pruefePfand, type Pfand, type PfandFall } from "@freedomstack/protocol";

/** Ein angenommenes Token, noch nicht eingelöst (ohne Beweis). */
interface Offen {
  mint: string;
  frist: number;
  proof: string;
}

export interface PfandStand {
  fassung: 1;
  /** Pfand-Schlüssel, 32 Byte hex – nicht der Schlüssel des Knotens. */
  sk: string;
  /** Seed für eigene Token (NUT-13), 32 Byte hex. */
  seed: string;
  zaehler: Record<string, number>;
  /** Angaben und Schlüssel der Mints – zum Prüfen ohne Mint. */
  mints: Record<string, { info: GetInfoResponse; schluesselbund: KeyChainCache }>;
  /** Je Sitzungsschlüssel: übergeben und abgerechnet (msat), gemerkt bis zur letzten Frist. */
  konten: Record<string, { uebergeben: number; abgerechnet: number; bis: number }>;
  offen: Offen[];
  /** SHA-256 der Geheimnisse angenommener Token → Frist: nie zweimal annehmen. */
  gesehen: Record<string, number>;
  /** Eingelöst: eigene Token je Mint (`serializeProofs()`). */
  erloes: Record<string, string[]>;
  /** Ein Tausch läuft: Zähler davor und die eingesetzten Token – für `nachholen()`. */
  laufend?: { mint: string; zaehler: Record<string, number>; eingesetzt: Offen[] };
}

export type PfandAnnahme = { ok: true; guthabenMsat: number } | { ok: false; fall: PfandFall | "pfand-deckung" };
export type MintBefund = { mint: string; fall?: "mint-netz" | "mint-ohne-nut11" | "mint-ohne-nut12" | "mint-ohne-sat" };

export interface PfandKasseOpts {
  /** Mints, die der Knoten annimmt (`PFAND_MINTS`, wie im Angebot). */
  mints: string[];
  speicher: { lade(): PfandStand | undefined; speichere(s: PfandStand): void };
  /** Unix-Sekunden. */
  jetzt?: () => number;
  /** So lange vor der Frist wird eingelöst. */
  einloesVorlaufSek?: number;
  /** Ab so viel Offenem je Mint wird sofort eingelöst (sat). */
  einloesSchwelleSat?: number;
}

export const PFAND_EINLOES_VORLAUF_SEK = 1_800;
export const PFAND_EINLOES_SCHWELLE_SAT = 1_000;
/** Näher an der Frist wird nicht mehr eingelöst (wie `claimAllowed()` bei Swaps): Danach gehört es dem Rückweg. */
export const PFAND_LETZTER_VERSUCH_SEK = 600;
/** Schlüssel einer Mint höchstens so oft neu holen, wenn ein unbekanntes Keyset kommt. */
const NEU_LADEN_SEK = 60;

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const summe = (p: Proof[]): number => sumProofs(p).toNumber();

export class PfandKasse {
  private s: PfandStand;
  private readonly jetzt: () => number;
  private readonly geladen = new Map<string, number>();
  /** Eine Einlösung zur Zeit – sonst tauschten zwei Läufe dieselben Token. */
  private laeuft = false;

  constructor(private readonly o: PfandKasseOpts) {
    this.jetzt = o.jetzt ?? (() => Math.floor(Date.now() / 1000));
    this.s = o.speicher.lade() ?? {
      fassung: 1, sk: randomBytes(32).toString("hex"), seed: randomBytes(32).toString("hex"), zaehler: {}, mints: {},
      konten: {}, offen: [], gesehen: {}, erloes: {},
    };
    this.speichere();
  }

  /** Pfand-Schlüssel für das Angebot (komprimiert, hex). */
  schluessel(): string {
    return Buffer.from(getPubKeyFromPrivKey(Buffer.from(this.s.sk, "hex"))).toString("hex");
  }

  /** Mints, die der Knoten nennt und deren Schlüssel er kennt – nur sie stehen im Angebot. */
  bereit(): string[] {
    return this.o.mints.filter((m) => this.s.mints[m]);
  }

  /** Selbstprüfung (V3): jede Mint erreichbar, mit NUT-11, NUT-12 und Schlüsseln in sat. Unerreichbar → die gemerkten bleiben. */
  async ladeMints(): Promise<MintBefund[]> {
    const befunde: MintBefund[] = [];
    for (const mint of this.o.mints) befunde.push({ mint, ...(await this.ladeMint(mint)) });
    return befunde;
  }

  private async ladeMint(mint: string): Promise<{ fall?: MintBefund["fall"] }> {
    this.geladen.set(mint, this.jetzt());
    const w = new Wallet(mint, { unit: "sat" });
    try {
      await w.loadMint(true);
    } catch {
      return { fall: "mint-netz" };
    }
    const info = w.getMintInfo();
    const fall = !info.isSupported(11).supported ? "mint-ohne-nut11" : !info.isSupported(12).supported ? "mint-ohne-nut12"
      : !w.keyChain.cache.keysets.some((k) => k.unit === "sat" && k.active && k.keys) ? "mint-ohne-sat" : undefined;
    if (fall) delete this.s.mints[mint];
    else this.s.mints[mint] = { info: info.cache, schluesselbund: w.keyChain.cache };
    this.speichere();
    return fall ? { fall } : {};
  }

  private mintSchluessel(mint: string, keyset: string, betrag: number): string | undefined {
    const k = this.s.mints[mint]?.schluesselbund.keysets.find((x) => x.id === keyset);
    return k && k.unit === "sat" ? k.keys?.[String(betrag)] : undefined;
  }

  /** Was ein Token beim Einlösen wert ist (msat): Nennwert minus Gebühr der Mint je Token (NUT-02, ppk = msat). */
  private netto(mint: string, t: { id: string; amount: number }): number {
    const k = this.s.mints[mint]?.schluesselbund.keysets.find((x) => x.id === t.id);
    return t.amount * 1000 - Math.max(0, k?.input_fee_ppk ?? 0);
  }

  /**
   * Pfand einer Anfrage annehmen: Prüfung ohne Mint, dann Deckung – übergeben (mit diesen Token)
   * mindestens abgerechnet plus `bedarfMsat`. Ohne Deckung bleibt alles, wie es war.
   */
  async nimmAn(p: Pfand, sitzung: string, bedarfMsat: number): Promise<PfandAnnahme> {
    const pruefe = () => pruefePfand(p, {
      schluessel: this.schluessel(), mints: this.bereit(), jetzt: this.jetzt(),
      mintSchluessel: (m, id, b) => this.mintSchluessel(m, id, b),
      gesehen: (geheimnis) => sha(geheimnis) in this.s.gesehen,
    });
    let r = pruefe();
    // Ein neues Keyset der Mint: einmal je Minute neu holen
    if (!r.ok && r.fall === "pfand-mint-schluessel" && this.jetzt() - (this.geladen.get(p.mint) ?? 0) >= NEU_LADEN_SEK) {
      await this.ladeMint(p.mint);
      r = pruefe();
    }
    if (!r.ok) return r;
    const k = this.s.konten[sitzung] ?? { uebergeben: 0, abgerechnet: 0, bis: 0 };
    const uebergeben = k.uebergeben + p.token.reduce((n, t) => n + this.netto(p.mint, t), 0);
    if (uebergeben - k.abgerechnet < bedarfMsat) return { ok: false, fall: "pfand-deckung" };
    // Ohne neue Token ändert sich nichts – auch kein Konto für einen fremden Schlüssel
    if (p.token.length === 0) return { ok: true, guthabenMsat: uebergeben - k.abgerechnet };
    const frist = r.frist ?? k.bis;
    for (const t of p.token) {
      this.s.gesehen[sha(t.secret)] = frist;
      this.s.offen.push({ mint: p.mint, frist, proof: serializeProofs(deserializeProofs([{ id: t.id, amount: t.amount, secret: t.secret, C: t.C }]))[0]! });
    }
    this.s.konten[sitzung] = { ...k, uebergeben, bis: Math.max(k.bis, frist) };
    this.speichere();
    return { ok: true, guthabenMsat: uebergeben - k.abgerechnet };
  }

  /** Preis eines Auftrags buchen – höchstens bis zum Übergebenen. */
  verbuche(sitzung: string, msat: number): number {
    const k = this.s.konten[sitzung];
    if (!k || !(msat > 0)) return 0;
    const gebucht = Math.min(Math.floor(msat), k.uebergeben - k.abgerechnet);
    k.abgerechnet += gebucht;
    this.speichere();
    return gebucht;
  }

  /** Stand eines Kontos (Anzeige, Tests). */
  konto(sitzung: string): { uebergeben: number; abgerechnet: number } | undefined {
    const k = this.s.konten[sitzung];
    return k ? { uebergeben: k.uebergeben, abgerechnet: k.abgerechnet } : undefined;
  }

  /** Noch nicht eingelöst und eingelöst (sat). */
  summen(): { offen: number; erloes: number } {
    return {
      offen: summe(deserializeProofs(this.s.offen.map((x) => x.proof))),
      erloes: summe(deserializeProofs(Object.values(this.s.erloes).flat())),
    };
  }

  /**
   * Einlösen, was fällig ist: je Mint alles zusammen, sobald eine Frist näher als der Vorlauf ist
   * oder die Schwelle erreicht. Was näher als zehn Minuten an der Frist liegt, gehört dem Rückweg
   * des Kunden und fällt weg. Abgelaufene Konten und Geheimnisse vergisst die Kasse.
   */
  async loeseFaelligeEin(): Promise<Array<{ mint: string; betrag: number; fehler?: string }>> {
    if (this.laeuft) return [];
    this.laeuft = true;
    try {
      return await this.einloesen();
    } finally {
      this.laeuft = false;
    }
  }

  private async einloesen(): Promise<Array<{ mint: string; betrag: number; fehler?: string }>> {
    const ergebnisse: Array<{ mint: string; betrag: number; fehler?: string }> = [];
    // Erst ein abgebrochener Tausch: Die Zähler und Token dieses Laufs zuerst
    if (this.s.laufend) {
      const mint = this.s.laufend.mint;
      try {
        await this.nachholen();
      } catch (e) {
        return [{ mint, betrag: 0, fehler: (e as Error).name || "Fehler" }];
      }
    }
    const jetzt = this.jetzt();
    const spaet = this.s.offen.filter((x) => x.frist - jetzt <= PFAND_LETZTER_VERSUCH_SEK);
    for (const mint of new Set(spaet.map((x) => x.mint))) {
      ergebnisse.push({ mint, betrag: summe(deserializeProofs(spaet.filter((x) => x.mint === mint).map((x) => x.proof))), fehler: "abgelaufen" });
    }
    this.s.offen = this.s.offen.filter((x) => !spaet.includes(x));
    for (const [h, frist] of Object.entries(this.s.gesehen)) if (frist < jetzt) delete this.s.gesehen[h];
    for (const [k, v] of Object.entries(this.s.konten)) if (v.bis < jetzt) delete this.s.konten[k];
    this.speichere();
    const vorlauf = this.o.einloesVorlaufSek ?? PFAND_EINLOES_VORLAUF_SEK;
    const schwelle = this.o.einloesSchwelleSat ?? PFAND_EINLOES_SCHWELLE_SAT;
    for (const mint of new Set(this.s.offen.map((x) => x.mint))) {
      const teil = this.s.offen.filter((x) => x.mint === mint);
      const betrag = summe(deserializeProofs(teil.map((x) => x.proof)));
      if (!teil.some((x) => x.frist - jetzt <= vorlauf) && betrag < schwelle) continue;
      try {
        ergebnisse.push({ mint, betrag: await this.tausche(mint, teil) });
      } catch (e) {
        // Nur der Fehlername – Meldungen der Mint nicht weiterreichen
        ergebnisse.push({ mint, betrag, fehler: (e as Error).name || "Fehler" });
      }
    }
    return ergebnisse;
  }

  /** Eigene Token entstehen aus dem Seed; jede Reservierung steht in der Datei, bevor die Mint sie sieht. */
  private zaehlerQuelle(): CounterSource {
    return {
      reserve: async (id, n) => {
        const start = this.s.zaehler[id] ?? 0;
        if (n > 0) {
          this.s.zaehler[id] = start + n;
          this.speichere();
        }
        return { start, count: n };
      },
      advanceToAtLeast: async (id, min) => {
        if ((this.s.zaehler[id] ?? 0) < min) {
          this.s.zaehler[id] = min;
          this.speichere();
        }
      },
    };
  }

  private async wallet(mint: string): Promise<Wallet> {
    const w = new Wallet(mint, { unit: "sat", bip39seed: Buffer.from(this.s.seed, "hex"), counterSource: this.zaehlerQuelle(), requireSigDleq: true });
    await w.loadMint(true);
    return w;
  }

  /** Bei der Mint tauschen – vorher gemerkt, damit ein Abbruch nichts verliert. */
  private async tausche(mint: string, teil: Offen[]): Promise<number> {
    const w = await this.wallet(mint);
    this.s.offen = this.s.offen.filter((x) => !teil.includes(x));
    this.s.laufend = { mint, zaehler: { ...this.s.zaehler }, eingesetzt: teil };
    this.speichere();
    let neu: Proof[];
    try {
      neu = await w.ops.receive(deserializeProofs(teil.map((x) => x.proof))).privkey(this.s.sk).run();
    } catch (e) {
      // Ob die Mint getauscht hat, ist unklar: nachsehen statt raten
      await this.nachholen().catch(() => undefined);
      throw e;
    }
    this.s.erloes[mint] = [...(this.s.erloes[mint] ?? []), ...serializeProofs(neu)];
    this.s.laufend = undefined;
    this.speichere();
    return summe(neu);
  }

  /**
   * Nach einem Abbruch mitten im Tausch: die eigenen Token aus dem Zählerbereich dieses Tauschs
   * neu ableiten (NUT-09) und die eingesetzten prüfen – nicht Ausgegebenes kommt zurück in `offen`.
   * Nie ab Zähler 0: frühere Bereiche gehören früheren Tauschen.
   */
  private async nachholen(): Promise<number> {
    const l = this.s.laufend;
    if (!l) return 0;
    const w = await this.wallet(l.mint);
    const wieder: Proof[] = [];
    for (const [id, bis] of Object.entries(this.s.zaehler)) {
      const ab = l.zaehler[id] ?? 0;
      if (bis > ab) wieder.push(...(await w.restore(ab, bis - ab, { keysetId: id })).proofs);
    }
    const eingesetzt = deserializeProofs(l.eingesetzt.map((x) => x.proof));
    const staende = await w.checkProofsStates([...wieder, ...eingesetzt]);
    const frei = (i: number) => staende[i]?.state === "UNSPENT";
    const da = new Set(deserializeProofs(this.s.erloes[l.mint] ?? []).map((p) => p.secret));
    const neu = wieder.filter((p, i) => frei(i) && !da.has(p.secret));
    this.s.erloes[l.mint] = [...(this.s.erloes[l.mint] ?? []), ...serializeProofs(neu)];
    this.s.offen.push(...l.eingesetzt.filter((_, i) => frei(wieder.length + i)));
    this.s.laufend = undefined;
    this.speichere();
    return summe(neu);
  }

  private speichere(): void {
    this.o.speicher.speichere(this.s);
  }
}

/** Die Kasse als Datei (0600) – über eine Zwischendatei; eine kaputte Datei wirft, nie ersetzen. */
export function pfandSpeicher(pfad: string): { lade(): PfandStand | undefined; speichere(s: PfandStand): void } {
  return {
    lade() {
      if (!existsSync(pfad)) return undefined;
      const s = JSON.parse(readFileSync(pfad, "utf8")) as PfandStand;
      if (s?.fassung !== 1 || !/^[0-9a-f]{64}$/.test(s.sk) || !/^[0-9a-f]{64}$/.test(s.seed) || !Array.isArray(s.offen)) {
        throw new Error(`${pfad}: kein Stand der Pfand-Kasse`);
      }
      return s;
    },
    speichere(s) {
      mkdirSync(dirname(pfad), { recursive: true, mode: 0o700 });
      const tmp = `${pfad}.tmp`;
      writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
      renameSync(tmp, pfad);
    },
  };
}

/** Wo der Knoten die Kasse ablegt. */
export function pfandOrt(home = process.env.HOME ?? "."): string {
  return join(home, ".freedom", "pfand.json");
}

/**
 * Die Kasse aus der Umgebung des Knotens (RM2b2): nur mit `PFAND=1` und den Mints aus `PFAND_MINTS`
 * (mit Komma getrennt, wie im Angebot: https oder .onion, höchstens fünf). Ungültig heißt kein Start –
 * sonst nähme der Knoten still keinen Pfand an. Mit `TOR_SOCKS` noch nicht: Die Mint sähe die IP des
 * Knotens am Tor vorbei (RM2b3).
 */
export function pfandKasseAusUmgebung(env: { PFAND?: string; PFAND_MINTS?: string; TOR_SOCKS?: string }, datei: string): PfandKasse | undefined {
  if (env.PFAND !== "1") {
    if (env.PFAND && env.PFAND !== "0") throw new Error("PFAND: nur 1 oder 0");
    return undefined;
  }
  if (env.TOR_SOCKS?.trim()) throw new Error("PFAND=1 geht noch nicht mit TOR_SOCKS – die Mint sähe die IP des Knotens (kommt mit RM2b3)");
  const mints = [...new Set((env.PFAND_MINTS ?? "").split(",").map((m) => m.trim()).filter(Boolean))];
  if (mints.length === 0) throw new Error("PFAND=1 braucht PFAND_MINTS");
  if (mints.length > PFAND_GRENZEN.mints || !mints.every(istMintAdresse)) {
    throw new Error(`PFAND_MINTS: höchstens ${PFAND_GRENZEN.mints} Mints, je https (oder .onion), ohne / am Ende`);
  }
  return new PfandKasse({ mints, speicher: pfandSpeicher(datei) });
}
