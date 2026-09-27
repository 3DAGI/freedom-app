/**
 * Zugang zur Relay-Rolle kaufen (Schritt 8.4b).
 *
 * Sats: eine Rechnung des eigenen LND (Macaroon nur mit `invoices`-Rechten);
 * bezahlt ist sie, wenn der eigene Knoten sie als beglichen meldet.
 * SOL: an die Adresse des Betreibers, mit einer Referenz nach Solana Pay;
 * bezahlt ist es, wenn die Kette die Ueberweisung samt Referenz zeigt.
 * Ein Beleg des Kunden allein gewaehrt nichts (4.8: „belegt“ = angekommen).
 *
 * Angebote werden abgelegt, BEVOR sie herausgehen: Wer zahlt, waehrend der
 * Knoten neu startet, soll seinen Zugang trotzdem bekommen. Nach aussen nur
 * feste Texte – nie Meldungen von LND oder vom RPC.
 */
import { randomBytes } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { pruefeSolUeberweisung, solReferenz } from "@freedomstack/protocol";
import type { RelayZugang } from "./relay-role.js";

/** Fehler mit festem Text fuer den Kunden – alles andere bleibt im Knoten. */
export class KasseFehler extends Error {}

export interface Rechnungen {
  rechnung(sats: number, notiz: string, gueltigSek: number): Promise<{ bolt11: string; hash: string }>;
  bezahlt(hash: string): Promise<boolean>;
}

export interface KasseConfig {
  tage: number;
  sats?: number;
  lamports?: number;
  solAdresse?: string;
  rechnungen?: Rechnungen;
  ladeTransaktion?: (signatur: string) => Promise<unknown>;
  zugang: RelayZugang;
  datei?: string;
  jetzt: () => number;
}

export type Schiene = "lightning" | "solana";

export type Angebot = { id: string; pubkey: string; tage: number; erstellt: number } & (
  | { schiene: "lightning"; sats: number; bolt11: string; hash: string }
  | { schiene: "solana"; lamports: number; adresse: string; referenz: string }
);

/** So lange gilt ein Angebot (die Rechnung laeuft genauso lange). */
export const ANGEBOT_GUELTIG_SEK = 3600;
/** So lange laesst sich ein bezahltes Angebot noch einloesen. */
const EINLOESBAR_SEK = 24 * 3600;
const JE_SCHLUESSEL = 3;
const HOECHSTENS = 2000;
const HEX64 = /^[0-9a-f]{64}$/;
const SIGNATUR = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

export class RelayKasse {
  private offen = new Map<string, Angebot>();
  /** Eingeloeste Signaturen (mit Zeit): Eine Transaktion mit zwei Referenzen bezahlt nur ein Angebot. */
  private genutzt = new Map<string, number>();
  private inArbeit = new Set<string>();
  private schreiben = Promise.resolve();

  constructor(private cfg: KasseConfig) {}

  /** Welche Schienen gehen – nur, was vollstaendig eingerichtet ist. */
  schienen(): Schiene[] {
    return [
      ...(this.cfg.sats && this.cfg.rechnungen ? ["lightning" as const] : []),
      ...(this.cfg.lamports && this.cfg.solAdresse && this.cfg.ladeTransaktion ? ["solana" as const] : []),
    ];
  }

  /** Preise fuer NIP-11 – nur fuer eingerichtete Schienen. */
  preise(): { tage: number; msat?: number; lamports?: number } {
    const s = this.schienen();
    return {
      tage: this.cfg.tage,
      ...(s.includes("lightning") ? { msat: this.cfg.sats! * 1000 } : {}),
      ...(s.includes("solana") ? { lamports: this.cfg.lamports! } : {}),
    };
  }

  async laden(): Promise<void> {
    if (!this.cfg.datei) return;
    try {
      const d = JSON.parse(await readFile(this.cfg.datei, "utf8")) as { angebote?: Angebot[]; genutzt?: Record<string, number> };
      for (const a of Array.isArray(d.angebote) ? d.angebote : []) if (typeof a?.id === "string" && HEX64.test(a.pubkey)) this.offen.set(a.id, a);
      for (const [sig, zeit] of Object.entries(d.genutzt ?? {})) if (Number.isSafeInteger(zeit)) this.genutzt.set(sig, zeit);
    } catch {
      // noch keine Datei
    }
  }

  /** Neues Angebot fuer einen Schluessel – nie in einer Schiene, die nicht eingerichtet ist. */
  async angebot(pubkey: string, schiene: Schiene): Promise<Angebot> {
    if (!HEX64.test(pubkey)) throw new KasseFehler("Schlüssel ungültig");
    if (!this.schienen().includes(schiene)) throw new KasseFehler(schiene === "lightning" ? "Dieser Relay nimmt keine Sats" : "Dieser Relay nimmt kein SOL");
    const jetzt = this.cfg.jetzt();
    this.verwerfeAlte(jetzt);
    if ([...this.offen.values()].filter((a) => a.pubkey === pubkey).length >= JE_SCHLUESSEL) throw new KasseFehler("Zu viele offene Angebote für diesen Schlüssel");
    if (this.offen.size >= HOECHSTENS) throw new KasseFehler("Zu viele offene Angebote – später erneut versuchen");
    const basis = { id: randomBytes(16).toString("hex"), pubkey, tage: this.cfg.tage, erstellt: jetzt };
    let a: Angebot;
    if (schiene === "lightning") {
      let r: { bolt11: string; hash: string };
      try {
        r = await this.cfg.rechnungen!.rechnung(this.cfg.sats!, `Zugang zum Relay für ${this.cfg.tage} Tage`, ANGEBOT_GUELTIG_SEK);
      } catch {
        throw new KasseFehler("Rechnung konnte nicht erstellt werden");
      }
      a = { ...basis, schiene, sats: this.cfg.sats!, bolt11: r.bolt11, hash: r.hash };
    } else {
      a = { ...basis, schiene, lamports: this.cfg.lamports!, adresse: this.cfg.solAdresse!, referenz: solReferenz(randomBytes(32)) };
    }
    this.offen.set(a.id, a);
    await this.ablegen();
    return a;
  }

  /**
   * Ist das Angebot bezahlt? Dann Zugang gewaehren und das Angebot schliessen –
   * genau einmal, auch wenn zwei Anfragen gleichzeitig kommen.
   */
  async pruefe(id: string, signatur?: string): Promise<{ bezahlt: true; bis: number } | { bezahlt: false; grund: string }> {
    const a = this.offen.get(id);
    if (!a) return { bezahlt: false, grund: "Unbekanntes oder schon eingelöstes Angebot" };
    if (this.inArbeit.has(id)) return { bezahlt: false, grund: "Wird gerade geprüft" };
    this.inArbeit.add(id);
    try {
      const ok = await this.istBezahlt(a, signatur);
      if (ok !== true) return { bezahlt: false, grund: ok };
      if (a.schiene === "solana") {
        // ohne await dazwischen: zwei gleichzeitige Pruefungen mit derselben Signatur loesen nur einmal ein
        if (this.genutzt.has(signatur!)) return { bezahlt: false, grund: "Diese Überweisung wurde schon eingelöst" };
        this.genutzt.set(signatur!, this.cfg.jetzt());
      }
      const bis = await this.cfg.zugang.gewaehre(a.pubkey, a.tage * 86400, this.cfg.jetzt());
      this.offen.delete(id);
      await this.ablegen();
      return { bezahlt: true, bis };
    } finally {
      this.inArbeit.delete(id);
    }
  }

  private async istBezahlt(a: Angebot, signatur?: string): Promise<true | string> {
    if (a.schiene === "lightning") {
      try {
        return (await this.cfg.rechnungen!.bezahlt(a.hash)) ? true : "Noch nicht bezahlt";
      } catch {
        return "Eigener Knoten nicht erreichbar – später erneut prüfen";
      }
    }
    if (!signatur || !SIGNATUR.test(signatur)) return "Signatur der Überweisung fehlt";
    if (this.genutzt.has(signatur)) return "Diese Überweisung wurde schon eingelöst";
    let tx: unknown;
    try {
      tx = await this.cfg.ladeTransaktion!(signatur);
    } catch {
      return "Kette nicht erreichbar – später erneut prüfen";
    }
    const p = pruefeSolUeberweisung(tx, { an: a.adresse, lamports: a.lamports, referenz: a.referenz });
    return p.status === "belegt" ? true : p.status === "unbestaetigt" ? "Überweisung noch nicht bestätigt" : "Überweisung passt nicht zum Angebot";
  }

  private verwerfeAlte(jetzt: number): void {
    for (const [id, a] of this.offen) if (a.erstellt + EINLOESBAR_SEK < jetzt) this.offen.delete(id);
    // Referenzen gibt es nur in offenen Angeboten – aeltere Signaturen koennen nichts mehr einloesen
    for (const [sig, zeit] of this.genutzt) if (zeit + 2 * EINLOESBAR_SEK < jetzt) this.genutzt.delete(sig);
  }

  private async ablegen(): Promise<void> {
    const datei = this.cfg.datei;
    if (!datei) return;
    this.schreiben = this.schreiben.catch(() => {}).then(async () => {
      const d = { angebote: [...this.offen.values()], genutzt: Object.fromEntries(this.genutzt) };
      await writeFile(`${datei}.tmp`, JSON.stringify(d), { mode: 0o600 });
      await rename(`${datei}.tmp`, datei);
    });
    await this.schreiben;
  }
}
