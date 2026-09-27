/**
 * Kasse des Providers für den Solana-Zahlkanal (Schritt 4.3c). Format:
 * `docs/ZAHLKANAL.md`.
 *
 * Mit jeder Anfrage bringt der Kunde eine Gutschrift mit – Vorauszahlung bis
 * zum Gebot: Sie muss decken, was schon abgerechnet ist, plus das Gebot dieser
 * Anfrage. So arbeitet der Provider nie ungedeckt; der Kunde riskiert höchstens
 * den Unterschied zwischen Gebot und Preis des letzten Auftrags.
 *
 * Die Kasse prüft Kanal (auf der Kette) und Gutschrift, bucht die Preise und
 * löst die höchste Gutschrift rechtzeitig vor Ablauf ein – oder früher, wenn
 * viel offen ist. Gutschriften sind Geld: Sie liegen in einer Datei (über eine
 * Zwischendatei geschrieben), damit ein Neustart nichts verliert. Ein zweites
 * Einlösen derselben Gutschrift lehnt das Programm ab – ein Wiederholungsversuch
 * nach einem unklaren Ausgang kann nicht doppelt kassieren.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TransactionInstruction } from "@solana/web3.js";
import {
  KANAL_PROGRAMM_ID, leseKanal, pruefeGutschrift, rechneKanalAbIxs,
  type Gutschrift, type KanalEmpfaenger, type KanalStand,
} from "@freedomstack/protocol";

export interface KanalKonto {
  /** Programm, dem das Konto gehört (base58). */
  owner: string;
  daten: Uint8Array;
}

/** Was die Kasse je Kanal festhält (Beträge als Text – JSON kennt kein BigInt). */
export interface KanalEintrag {
  kanal: string;
  ablauf: string;
  sitzungsSchluessel: string;
  empfaenger: KanalEmpfaenger[];
  eingezahlt: string;
  abgerechnet: string;
  eingeloest: string;
  beste?: { betrag: string; signatur: string };
}

export interface KanalKasseOpts {
  /** Eigene Solana-Adresse – der Provider des Kanals. */
  provider: string;
  lese(adresse: string): Promise<KanalKonto | null>;
  /** Sendet die Einlösung, signiert als Provider, mit Vorabsimulation. */
  sende(ixs: TransactionInstruction[]): Promise<string>;
  speicher?: { lade(): KanalEintrag[]; speichere(e: KanalEintrag[]): void };
  programmId?: string;
  /** Unix-Sekunden. */
  jetzt?: () => number;
  /** So lange muss ein Kanal noch laufen, damit er angenommen wird. */
  mindestRestSek?: number;
  /** So lange vor Ablauf wird eingelöst. */
  einloesVorlaufSek?: number;
  /** Ab so viel Offenem wird sofort eingelöst (Lamports). */
  einloesSchwelle?: bigint;
}

export type Annahme = { ok: true; empfaenger: KanalEmpfaenger[] } | { ok: false; grund: string };

export const MINDEST_REST_SEK = 3_600;
export const EINLOES_VORLAUF_SEK = 1_800;
export const EINLOES_SCHWELLE = 10_000_000n; // 0,01 SOL
/** Näher am Ablauf wird nicht mehr versucht – die Uhr der Kette kann vorgehen. */
const LETZTER_VERSUCH_SEK = 120;

export class KanalKasse {
  private eintraege = new Map<string, KanalEintrag>();
  private readonly programmId: string;
  private readonly jetzt: () => number;

  constructor(private readonly o: KanalKasseOpts) {
    this.programmId = o.programmId ?? KANAL_PROGRAMM_ID;
    this.jetzt = o.jetzt ?? (() => Math.floor(Date.now() / 1000));
    for (const e of o.speicher?.lade() ?? []) this.eintraege.set(e.kanal, e);
  }

  /**
   * Gutschrift einer Anfrage annehmen: Kanal auf der Kette (Programm,
   * Provider, genug Laufzeit), Gutschrift (Signatur, Kanal, Ablauf, steigend,
   * höchstens die Einlage) und Deckung (abgerechnet + `bedarf`).
   */
  async nimmAn(g: Gutschrift, bedarf: bigint): Promise<Annahme> {
    let e = this.eintraege.get(g.kanal);
    // Neu lesen, wenn unbekannt oder die Gutschrift über der bekannten Einlage
    // liegt (der Kunde kann aufgestockt haben)
    let stand: KanalStand | undefined;
    if (!e || g.betrag > BigInt(e.eingezahlt)) {
      const konto = await this.o.lese(g.kanal).catch(() => null);
      if (!konto) return { ok: false, grund: "Kanal nicht gefunden" };
      if (konto.owner !== this.programmId) return { ok: false, grund: "Konto gehört nicht dem Kanal-Programm" };
      try {
        stand = leseKanal(konto.daten);
      } catch {
        return { ok: false, grund: "kein Kanal-Konto" };
      }
      if (stand.provider !== this.o.provider) return { ok: false, grund: "Kanal für einen anderen Provider" };
    }
    const ablauf = stand ? stand.ablauf : BigInt(e!.ablauf);
    if (ablauf - BigInt(this.jetzt()) < BigInt(this.o.mindestRestSek ?? MINDEST_REST_SEK)) {
      return { ok: false, grund: "Kanal läuft zu bald ab" };
    }
    const kanalStand: KanalStand = stand ?? {
      kunde: "", provider: this.o.provider, sitzungsSchluessel: e!.sitzungsSchluessel, nonce: 0n,
      eingezahlt: BigInt(e!.eingezahlt), ausgezahlt: BigInt(e!.eingeloest), ablauf, empfaenger: e!.empfaenger, bump: 0,
    };
    const beste = e?.beste ? BigInt(e.beste.betrag) : undefined;
    const dieselbe = e?.beste && g.betrag === beste && g.signatur === e.beste.signatur && g.ablauf === ablauf;
    if (!dieselbe) {
      const letzte = beste ?? kanalStand.ausgezahlt;
      const p = pruefeGutschrift(g, { adresse: g.kanal, stand: kanalStand }, letzte);
      if (!p.ok) return p;
    }
    // Neuer Kanal: was schon ausgezahlt ist, gilt als abgerechnet
    const abgerechnet = e ? BigInt(e.abgerechnet) : kanalStand.ausgezahlt;
    if (g.betrag - abgerechnet < bedarf) return { ok: false, grund: "Gutschrift deckt das Gebot nicht" };

    e = {
      kanal: g.kanal,
      ablauf: ablauf.toString(),
      sitzungsSchluessel: kanalStand.sitzungsSchluessel,
      empfaenger: kanalStand.empfaenger,
      eingezahlt: kanalStand.eingezahlt.toString(),
      abgerechnet: abgerechnet.toString(),
      eingeloest: e?.eingeloest ?? kanalStand.ausgezahlt.toString(),
      beste: { betrag: g.betrag.toString(), signatur: g.signatur },
    };
    this.eintraege.set(g.kanal, e);
    this.speichere();
    return { ok: true, empfaenger: e.empfaenger };
  }

  /** Preis eines Auftrags buchen – höchstens bis zur angenommenen Gutschrift. */
  verbuche(kanal: string, lamports: bigint): bigint {
    const e = this.eintraege.get(kanal);
    if (!e?.beste || lamports <= 0n) return 0n;
    const frei = BigInt(e.beste.betrag) - BigInt(e.abgerechnet);
    const gebucht = lamports < frei ? lamports : frei;
    e.abgerechnet = (BigInt(e.abgerechnet) + gebucht).toString();
    this.speichere();
    return gebucht;
  }

  /** Einlösen, was fällig ist: kurz vor Ablauf oder ab der Schwelle. Abgelaufene fallen weg. */
  async loeseFaelligeEin(): Promise<Array<{ kanal: string; betrag: bigint; signatur?: string; fehler?: string }>> {
    const jetzt = BigInt(this.jetzt());
    const vorlauf = BigInt(this.o.einloesVorlaufSek ?? EINLOES_VORLAUF_SEK);
    const schwelle = this.o.einloesSchwelle ?? EINLOES_SCHWELLE;
    const ergebnisse: Array<{ kanal: string; betrag: bigint; signatur?: string; fehler?: string }> = [];
    for (const e of [...this.eintraege.values()]) {
      const ablauf = BigInt(e.ablauf);
      if (jetzt >= ablauf - BigInt(LETZTER_VERSUCH_SEK)) {
        // Zu spät: Nach Ablauf gehört der Rest dem Kunden (refund)
        const verpasst = e.beste ? BigInt(e.beste.betrag) - BigInt(e.eingeloest) : 0n;
        if (verpasst > 0n) ergebnisse.push({ kanal: e.kanal, betrag: verpasst, fehler: "abgelaufen – nicht eingelöst" });
        this.eintraege.delete(e.kanal);
        continue;
      }
      if (!e.beste) continue;
      const betrag = BigInt(e.beste.betrag);
      const offen = betrag - BigInt(e.eingeloest);
      if (offen <= 0n || (ablauf - jetzt > vorlauf && offen < schwelle)) continue;
      const g: Gutschrift = { kanal: e.kanal, betrag, ablauf, signatur: e.beste.signatur };
      try {
        const signatur = await this.o.sende(rechneKanalAbIxs({
          provider: this.o.provider, gutschrift: g, sitzungsSchluessel: e.sitzungsSchluessel, empfaenger: e.empfaenger,
        }));
        e.eingeloest = betrag.toString();
        ergebnisse.push({ kanal: e.kanal, betrag, signatur });
      } catch (err) {
        // Nur der Fehlername – Meldungen der Kette oder des RPC nach außen nicht weiterreichen
        ergebnisse.push({ kanal: e.kanal, betrag, fehler: (err as Error).name || "Fehler" });
      }
    }
    this.speichere();
    return ergebnisse;
  }

  /** Stand für Anzeige und Tests. */
  eintrag(kanal: string): KanalEintrag | undefined {
    const e = this.eintraege.get(kanal);
    return e ? { ...e, empfaenger: [...e.empfaenger] } : undefined;
  }

  private speichere(): void {
    this.o.speicher?.speichere([...this.eintraege.values()]);
  }
}

/** Kanäle als Datei – über eine Zwischendatei, damit ein Absturz nichts zerstört. */
export function kanalSpeicher(pfad: string): { lade(): KanalEintrag[]; speichere(e: KanalEintrag[]): void } {
  return {
    lade() {
      if (!existsSync(pfad)) return [];
      const daten = JSON.parse(readFileSync(pfad, "utf8")) as unknown;
      if (!Array.isArray(daten)) throw new Error(`${pfad}: keine Liste`);
      return daten as KanalEintrag[];
    },
    speichere(e) {
      mkdirSync(dirname(pfad), { recursive: true, mode: 0o700 });
      const tmp = `${pfad}.tmp`;
      writeFileSync(tmp, JSON.stringify(e), { mode: 0o600 });
      renameSync(tmp, pfad);
    },
  };
}
