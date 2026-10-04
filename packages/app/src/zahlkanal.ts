/**
 * Zahlkanal in der App (Schritt 4.3d, Format: docs/ZAHLKANAL.md).
 *
 * Ein Kanal gehört zu genau einem Provider. Die App merkt ihn im Kanal-Buch,
 * BEVOR die Einlage auf die Kette geht; der Rückhol-Wächter kennt ihn als
 * Sperre (`kind: "kanal"`) und holt nach Ablauf zurück, was übrig ist – einen
 * nie angelegten Kanal schließt er ohne Transaktion ab.
 *
 * Gutschriften (Vorauszahlung bis zum Gebot): Jede Anfrage trägt
 * `max(letzte, Basis + Bedarf)`. Die Basis ist die Summe der Preise aus den
 * Antworten; fehlt zu einer Anfrage die Antwort, rechnet die App vorsichtig ab
 * der letzten Gutschrift – der Provider kann gearbeitet und gebucht haben, und
 * sonst hinge der Kanal. Verlieren kann der Kunde so höchstens das Gebot einer
 * Anfrage ohne Antwort. Den Bedarf rechnet die App mit dem Kurs aus dem Angebot
 * des Providers (der Knoten prüft mit seinem), mit etwas Spielraum.
 *
 * Der Sitzungsschlüssel signiert die Gutschriften – ein Geld-Geheimnis, nur im
 * Tresor (`freedom.kanaele`), nie in der Sicherung.
 */
import type { Connection, TransactionInstruction } from "@solana/web3.js";
import {
  KANAL_PROGRAMM_ID, erstatteKanalIx, fromHex, gutschriftTags, kanalAdresse, leseKanal, msatZuLamports,
  neuerSitzungsSchluessel, oeffneKanalIx, signiereGutschrift, toHex, type KanalEmpfaenger, type KanalStand,
} from "@freedomstack/protocol";
import type { WalletSigner } from "./sol-htlc.js";
import { t } from "./i18n.js";
import { fehlerText } from "./protokoll-texte.js";

export const LS_KANAELE = "freedom.kanaele";
/** So lange muss ein Kanal noch laufen, damit die App ihn nutzt (der Knoten verlangt 1 h). */
export const KANAL_NUTZBAR_SEK = 2 * 3_600;
/** „Fast leer“ (E8): Nach dieser Gutschrift deckt der Rest weniger als so viele weitere Anfragen. */
export const KANAL_KNAPP_ANFRAGEN = 3n;
/** Spielraum auf den Bedarf, falls sich der Kurs des Providers seit dem Angebot bewegt hat. */
export const KURS_SPIELRAUM_PROMILLE = 20;

export interface KanalEintrag {
  kanal: string;
  /** Nostr-Schlüssel des Providers (dem die Anfragen gehen). */
  provider: string;
  /** Seine SOL-Adresse – Provider des Kanals auf der Kette. */
  providerSol: string;
  /** Die zahlende SOL-Adresse (Kunde des Kanals). */
  kunde: string;
  nonce: string;
  ablauf: number;
  eingezahlt: string;
  empfaenger: KanalEmpfaenger[];
  /** Geheimer Sitzungsschlüssel (hex) – signiert die Gutschriften. */
  sitzung: string;
  /** Höchste signierte Gutschrift (Lamports). */
  letzte: string;
  /** Summe der Preise aus Antworten (Lamports). */
  abgerechnet: string;
  /** Anfragen mit Gutschrift, zu denen noch keine Antwort kam. */
  offen: string[];
}

export interface KanalSpeicher {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void | Promise<void>;
}

const HEX64 = /^[0-9a-f]{64}$/;
const max = (a: bigint, b: bigint): bigint => (a > b ? a : b);

/** Bedarf einer Anfrage in Lamports: Gebot plus Werkzeuge, zum Kurs des Providers, mit Spielraum. */
export function bedarfLamports(hoechstMsat: number, satsProSol: number): bigint {
  const l = BigInt(msatZuLamports(hoechstMsat, satsProSol));
  return l + (l * BigInt(KURS_SPIELRAUM_PROMILLE) + 999n) / 1000n;
}

export type GutschriftWahl =
  | { art: "kanal"; eintrag: KanalEintrag; betrag: bigint; tags: string[][]; knapp: boolean }
  | { art: "erschoepft"; eintrag: KanalEintrag }
  | { art: "keiner" };

export class KanalBuch {
  constructor(private readonly speicher: KanalSpeicher) {}

  alle(): KanalEintrag[] {
    try {
      const d = JSON.parse(this.speicher.getItem(LS_KANAELE) ?? "[]") as unknown;
      return Array.isArray(d) ? (d as KanalEintrag[]).filter((e) => typeof e?.kanal === "string" && HEX64.test(e.sitzung ?? "")) : [];
    } catch {
      return [];
    }
  }

  async merke(e: KanalEintrag): Promise<void> {
    await this.speicher.setItem(LS_KANAELE, JSON.stringify([...this.alle().filter((x) => x.kanal !== e.kanal), e]));
  }

  async entferne(kanal: string): Promise<void> {
    await this.speicher.setItem(LS_KANAELE, JSON.stringify(this.alle().filter((e) => e.kanal !== kanal)));
  }

  /** Einträge, deren Kanal seit `tage` abgelaufen ist, fallen weg (zurückgeholt hat der Wächter). */
  async raeumeAuf(jetzt: number, tage = 30): Promise<void> {
    const alle = this.alle();
    const rest = alle.filter((e) => e.ablauf + tage * 86_400 > jetzt);
    if (rest.length !== alle.length) await this.speicher.setItem(LS_KANAELE, JSON.stringify(rest));
  }

  /** Der Kanal zu diesem Provider mit der längsten Laufzeit – nur, wenn er noch lange genug läuft. */
  fuerProvider(provider: string, jetzt: number): KanalEintrag | undefined {
    return this.alle()
      .filter((e) => e.provider === provider && e.ablauf - jetzt >= KANAL_NUTZBAR_SEK)
      .sort((a, b) => b.ablauf - a.ablauf)[0];
  }

  /**
   * Gutschrift für eine Anfrage an diesen Provider: `max(letzte, Basis + Bedarf)`,
   * höchstens die Einlage. Gemerkt wird sie mit `gesendet()`, sobald die Anfrage
   * steht – und bevor sie hinausgeht.
   */
  gutschriftFuer(p: { provider: string; bedarf: bigint; jetzt: number }): GutschriftWahl {
    const e = this.fuerProvider(p.provider, p.jetzt);
    if (!e) return { art: "keiner" };
    const letzte = BigInt(e.letzte);
    const basis = e.offen.length > 0 ? max(letzte, BigInt(e.abgerechnet)) : BigInt(e.abgerechnet);
    const betrag = max(letzte, basis + p.bedarf);
    if (betrag > BigInt(e.eingezahlt)) return { art: "erschoepft", eintrag: e };
    const sitzung = fromHex(e.sitzung);
    const g = signiereGutschrift(sitzung, e.kanal, betrag, BigInt(e.ablauf));
    sitzung.fill(0);
    // Fast leer (E8): Danach reicht der Rest für weniger als KANAL_KNAPP_ANFRAGEN Anfragen dieser Größe
    const knapp = BigInt(e.eingezahlt) - betrag < p.bedarf * KANAL_KNAPP_ANFRAGEN;
    return { art: "kanal", eintrag: e, betrag, tags: gutschriftTags(g), knapp };
  }

  /** Aufgestockt (E8, `top_up` auf der Kette bestätigt): die Einlage wächst, sonst nichts. */
  async aufgestockt(kanal: string, lamports: bigint): Promise<void> {
    const e = this.alle().find((x) => x.kanal === kanal);
    if (!e || lamports <= 0n) return;
    await this.merke({ ...e, eingezahlt: (BigInt(e.eingezahlt) + lamports).toString() });
  }

  /** Die Anfrage mit dieser Gutschrift geht hinaus: letzte Gutschrift und offene Anfrage merken. */
  async gesendet(kanal: string, betrag: bigint, requestId: string): Promise<void> {
    const e = this.alle().find((x) => x.kanal === kanal);
    if (!e) return;
    await this.merke({ ...e, letzte: max(BigInt(e.letzte), betrag).toString(), offen: [...e.offen.filter((id) => id !== requestId), requestId] });
  }

  /**
   * Die Antwort kam: ihr Preis zählt (höchstens bis zur letzten Gutschrift).
   * Ohne gültigen Preis zählt vorsichtig die ganze Gutschrift. Kein Kanal → false.
   */
  async beantwortet(requestId: string, preisLamports: number | undefined): Promise<boolean> {
    const e = this.alle().find((x) => x.offen.includes(requestId));
    if (!e) return false;
    const letzte = BigInt(e.letzte);
    const preis = preisLamports !== undefined && Number.isSafeInteger(preisLamports) && preisLamports >= 0 ? BigInt(preisLamports) : letzte;
    const summe = BigInt(e.abgerechnet) + preis;
    await this.merke({ ...e, abgerechnet: (summe < letzte ? summe : letzte).toString(), offen: e.offen.filter((id) => id !== requestId) });
    return true;
  }

}

/**
 * Einen Kanal planen: Adresse, Sitzungsschlüssel, Anweisung. Noch nichts
 * gesendet – erst merken (Kanal-Buch, Sperre für den Wächter), dann
 * `sendeMitWallet`.
 */
export function planeKanal(p: {
  provider: string; providerSol: string; kunde: string; lamports: bigint; laufzeitSek: number;
  empfaenger: KanalEmpfaenger[]; jetzt: number;
}): { eintrag: KanalEintrag; ix: TransactionInstruction } {
  if (p.lamports <= 0n) throw new Error(t("waehr.ungueltigerBetrag"));
  if (!(p.laufzeitSek >= KANAL_NUTZBAR_SEK)) throw new Error(t("zahl.kanalLaufzeitZuKurz"));
  const zufall = crypto.getRandomValues(new Uint32Array(2));
  const nonce = (BigInt(zufall[0]!) << 32n) | BigInt(zufall[1]!);
  const sitzung = neuerSitzungsSchluessel();
  const ablauf = p.jetzt + Math.floor(p.laufzeitSek);
  const ix = oeffneKanalIx({
    kunde: p.kunde, provider: p.providerSol, nonce, betrag: p.lamports, ablauf: BigInt(ablauf),
    sitzungsSchluessel: sitzung.oeffentlich, empfaenger: p.empfaenger,
  });
  const eintrag: KanalEintrag = {
    kanal: kanalAdresse(p.kunde, p.providerSol, nonce).adresse, provider: p.provider, providerSol: p.providerSol,
    kunde: p.kunde, nonce: nonce.toString(), ablauf, eingezahlt: p.lamports.toString(), empfaenger: p.empfaenger,
    sitzung: toHex(sitzung.geheim), letzte: "0", abgerechnet: "0", offen: [],
  };
  sitzung.geheim.fill(0);
  return { eintrag, ix };
}

/** Anweisungen mit der Wallet signieren und senden – mit Vorabsimulation, bis bestätigt. */
export async function sendeMitWallet(
  conn: Connection, wallet: WalletSigner, ixs: TransactionInstruction[], fortschritt?: (schritt: string) => void,
): Promise<string> {
  const { PublicKey, Transaction } = await import("@solana/web3.js");
  const tx = new Transaction().add(...ixs);
  fortschritt?.(t("zahl.warteWallet"));
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = new PublicKey(wallet.publicKey.toBase58());
  const signiert = (await wallet.signTransaction(tx)) as import("@solana/web3.js").Transaction;
  fortschritt?.(t("zahl.wirdGesendet"));
  const signatur = await conn.sendRawTransaction(signiert.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
  fortschritt?.(t("zahl.warteKette"));
  const best = await conn.confirmTransaction({ signature: signatur, blockhash, lastValidBlockHeight }, "confirmed");
  if (best.value.err) throw new Error(t("zahl.txAbgelehnt", { fehler: JSON.stringify(best.value.err) }));
  return signatur;
}

/** Der Kanal auf der Kette – oder null (nie angelegt, schon zurückgeholt, fremdes Konto). */
export async function kanalAufKette(conn: Connection, kanal: string): Promise<KanalStand | null> {
  const { PublicKey } = await import("@solana/web3.js");
  const i = await conn.getAccountInfo(new PublicKey(kanal), "confirmed");
  if (!i || i.owner.toBase58() !== KANAL_PROGRAMM_ID) return null;
  try {
    return leseKanal(i.data);
  } catch {
    return null;
  }
}

/** Liegt das Kanal-Programm auf dieser Kette? (Bis zum Deploy nicht – dann kein Kanal.) */
export async function programmBereit(conn: Connection): Promise<boolean> {
  const { PublicKey } = await import("@solana/web3.js");
  return (await conn.getAccountInfo(new PublicKey(KANAL_PROGRAMM_ID), "confirmed"))?.executable === true;
}

/**
 * Abgelaufene Kanäle zurückholen (Rest und Miete an den Kunden). Seit Z1 ohne
 * Unterschrift des Kunden: Diese Wallet zahlt nur die Gebühr, das Geld geht an
 * den Kunden, der auf der Kette steht – auch wenn es eine andere Wallet ist
 * (z. B. eine, die gerade nicht verbunden ist). Alles in einer Transaktion.
 */
export async function erstatteKanaele(
  conn: Connection, wallet: WalletSigner, kanaele: string[],
): Promise<{ signature?: string; refunded: string[]; failed: { swapId: string; reason: string }[] }> {
  const ixs: TransactionInstruction[] = [];
  const dabei: string[] = [];
  const failed: { swapId: string; reason: string }[] = [];
  for (const kanal of kanaele) {
    // Empfänger ist der Kunde auf der Kette – nie diese Wallet einsetzen, sonst lehnte das Programm ab
    const kunde = (await kanalAufKette(conn, kanal))?.kunde ?? wallet.publicKey.toBase58();
    ixs.push(erstatteKanalIx({ kunde, kanal }));
    dabei.push(kanal);
  }
  if (ixs.length === 0) return { refunded: [], failed };
  try {
    return { signature: await sendeMitWallet(conn, wallet, ixs), refunded: dabei, failed };
  } catch (e) {
    return { refunded: [], failed: [...failed, ...dabei.map((swapId) => ({ swapId, reason: fehlerText(e) }))] };
  }
}
