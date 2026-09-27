/**
 * Atomic-Swap-Client: sats → SOL, vollständig statt halb.
 *
 * WAS VORHER FEHLTE
 * `pollSwapResponse()` zeigte die Lightning-Rechnung an und war fertig. Es gab
 * kein Nachsehen, ob der LP überhaupt SOL gesperrt hat, kein Einlösen mit dem
 * Preimage und keinen Rückholpfad. Das Preimage lag in `sessionStorage` und war
 * beim Schließen des Tabs weg — mit ihm der Zugriff auf das Geld.
 *
 * DER GEFÄHRLICHE MOMENT
 * Der Kunde erzeugt das Preimage und kennt es als Einziger. Der Ablauf ist:
 *
 *   1. Kunde: Preimage erzeugen, Hashlock H veröffentlichen
 *   2. LP:    SOL auf der Kette sperren, Empfänger = Kunde, Hashlock = H
 *   3. LP:    Hold-Invoice mit payment_hash = H schicken
 *   4. Kunde: PRÜFEN, dass Schritt 2 wirklich passiert ist   ← hier fehlte alles
 *   5. Kunde: Rechnung zahlen (Betrag hängt in der Schwebe)
 *   6. Kunde: SOL einlösen und dabei das Preimage offenlegen
 *   7. LP:    sieht das Preimage und schließt die Lightning-Zahlung ab
 *
 * Schritt 4 ist der Punkt, an dem ein Kunde ohne Prüfung Geld verliert: Er
 * zahlt eine Rechnung für SOL, die niemand gesperrt hat. Deshalb weigert sich
 * dieses Modul, die Rechnung als zahlbar zu melden, bevor die Sperre auf der
 * Kette bestätigt ist.
 *
 * TIMELOCK-ORDNUNG
 * T_sol < T_lightning ist zwingend. Der Kunde muss das SOL einlösen können,
 * solange die Lightning-Zahlung noch offen ist — sonst löst er SOL ein,
 * während die Zahlung bereits zurückgelaufen ist, und der LP verliert. Ist die
 * Reihenfolge falsch, wird der Swap abgelehnt.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { anchorSighash, swapIdBytes, HTLC_PROGRAM_ID, WalletSigner } from "./sol-htlc.js";
import { type AddressUsage, checkAmount, checkReuse, checkTiming, leseBolt11 } from "@freedomstack/protocol";
import { gebietsschema, t } from "./i18n.js";

export type SwapPhase =
  /** Anfrage raus, LP hat noch nicht geantwortet. */
  | "warte_auf_lp"
  /** Rechnung da, aber die Sperre auf der Kette ist noch nicht bestätigt. */
  | "pruefe_sperre"
  /** Alles geprüft — jetzt darf gezahlt werden. */
  | "zahlbar"
  /** Gezahlt, SOL noch nicht eingelöst. */
  | "bezahlt"
  /** SOL eingelöst, Preimage offengelegt. */
  | "abgeschlossen"
  /** Etwas stimmt nicht — Beträge, Empfänger, Fristen. */
  | "abgelehnt"
  /** Frist abgelaufen, Rückholung möglich. */
  | "abgelaufen";

export interface SwapState {
  phase: SwapPhase;
  /** Was der Nutzer als Nächstes tun soll oder warum nicht. */
  message: string;
  bolt11?: string;
  swapId?: string;
  lockedLamports?: number;
  solTimelockUnix?: number;
  /** Nur gesetzt, wenn Zahlen gefahrlos ist. */
  safeToPay: boolean;
}

export interface OnChainLock {
  amountLamports: number;
  timelockUnix: number;
  recipient: string;
  hashlock: Uint8Array;
  claimed: boolean;
  refunded: boolean;
}

export interface VerifySwapParams {
  lock: OnChainLock | undefined;
  /** Hashlock, den der Kunde selbst erzeugt hat. */
  expectedHashlock: Uint8Array;
  /** SOL-Adresse des Kunden. */
  expectedRecipient: string;
  /** Was der LP zugesagt hat. */
  expectedLamports: number;
  /** Ablauf der Lightning-Rechnung (Unix). */
  lightningExpiryUnix: number;
  nowUnix?: number;
  /** Mindestabstand zwischen SOL- und Lightning-Frist. */
  minGapSeconds?: number;
}

export interface SwapVerdict {
  ok: boolean;
  problems: string[];
  summary: string;
}

/**
 * Prüft die Gegenleistung, BEVOR gezahlt wird.
 *
 * Jede einzelne Prüfung hier entspricht einem Weg, auf dem ein bösartiger LP
 * eine Zahlung kassieren könnte, ohne zu liefern.
 */
export function verifyCounterpartyLock(p: VerifySwapParams): SwapVerdict {
  const now = p.nowUnix ?? Math.floor(Date.now() / 1000);
  const minGap = p.minGapSeconds ?? 1800;
  const problems: string[] = [];

  if (!p.lock) {
    return {
      ok: false,
      problems: [t("zahl.nichtsGesperrt")],
      summary: t("zahl.nochKeineSol"),
    };
  }

  if (p.lock.claimed) problems.push(t("zahl.htlcEingeloest"));
  if (p.lock.refunded) problems.push(t("zahl.htlcZurueck"));

  if (bytesToHex(p.lock.hashlock) !== bytesToHex(p.expectedHashlock)) {
    // Ein fremder Hashlock heißt: nur wer dessen Preimage kennt, kommt an das
    // Geld — und das ist dann nicht der Kunde.
    problems.push(t("zahl.fremderHashlock"));
  }

  if (p.lock.recipient !== p.expectedRecipient) {
    problems.push(t("zahl.falscherEmpfaengerIst", { ist: p.lock.recipient.slice(0, 8), soll: p.expectedRecipient.slice(0, 8) }));
  }

  if (p.lock.amountLamports < p.expectedLamports) {
    problems.push(t("zahl.zuWenigGesperrt", { ist: p.lock.amountLamports, soll: p.expectedLamports }));
  }

  const solRemaining = p.lock.timelockUnix - now;
  if (solRemaining <= 0) {
    problems.push(t("zahl.solFristAbgelaufen"));
  } else if (solRemaining < 600) {
    problems.push(t("zahl.solFristKnapp", { min: Math.floor(solRemaining / 60) }));
  }

  // Die zwingende Ordnung: T_sol < T_lightning, mit Abstand.
  if (p.lock.timelockUnix >= p.lightningExpiryUnix) {
    problems.push(t("zahl.fristReihenfolge"));
  } else if (p.lightningExpiryUnix - p.lock.timelockUnix < minGap) {
    problems.push(t("zahl.fristAbstand", { min: Math.floor((p.lightningExpiryUnix - p.lock.timelockUnix) / 60), noetig: Math.floor(minGap / 60) }));
  }

  const ok = problems.length === 0;
  return {
    ok,
    problems,
    summary: ok
      ? t("zahl.gegenleistungGeprueft", { lamports: p.lock.amountLamports, bis: new Date(p.lock.timelockUnix * 1000).toLocaleTimeString(gebietsschema()) })
      : problems[0],
  };
}

/**
 * Baut die `claim`-Instruktion.
 *
 * KODIERUNG: Das Programm nimmt `[u8; 32]`, nicht `Vec<u8>`. Borsh
 * serialisiert ein festes Array OHNE Längenpräfix — ein Vec hätte vier Byte
 * Länge davor. Wer nur eine der beiden Seiten ändert, bekommt eine abgelehnte
 * Transaktion ohne verwertbare Fehlermeldung.
 *
 * KONTEN: `initiator` ist dazugekommen, weil das Programm den Swap-PDA nach
 * dem Einlösen schließt und die Mietbefreiung an den zurückgibt, der sie
 * gezahlt hat. Ohne dieses Konto lehnt Anchor die Instruktion ab.
 */
export async function buildClaimInstruction(
  swapId: string,
  preimage: Uint8Array,
  recipient: string,
  initiator: string,
): Promise<import("@solana/web3.js").TransactionInstruction> {
  const { PublicKey, TransactionInstruction } = await import("@solana/web3.js");
  if (preimage.length !== 32) {
    throw new Error(t("zahl.preimageLaenge", { n: preimage.length }));
  }

  const programId = new PublicKey(HTLC_PROGRAM_ID);
  const [pda] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("swap"), swapIdBytes(swapId)],
    programId,
  );

  const disc = anchorSighash("claim");
  const data = new Uint8Array(disc.length + preimage.length);
  data.set(disc, 0);
  data.set(preimage, disc.length);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: new PublicKey(recipient), isSigner: true, isWritable: true },
      { pubkey: new PublicKey(initiator), isSigner: false, isWritable: true },
      { pubkey: pda, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(data),
  });
}

/**
 * Sicherheitsabstand vor dem Fristende, ab dem nicht mehr eingeloest wird.
 *
 * Das Programm lehnt eine Einloesung nach Ablauf ab (TimelockExpired). Landet
 * eine solche Transaktion trotzdem in einem Block, steht das Preimage in ihren
 * Daten – oeffentlich. Der Liquiditaetsgeber koennte damit die
 * Lightning-Zahlung einziehen UND die SOL zurueckholen. Deshalb gilt: lieber
 * gar nicht einloesen als knapp. Ohne Einloesung laeuft die Lightning-Zahlung
 * von selbst zurueck.
 */
export const CLAIM_SAFETY_MARGIN_SECS = 600;

/** Darf jetzt noch eingeloest werden? */
export function claimAllowed(
  timelockUnix: number,
  nowUnix = Math.floor(Date.now() / 1000),
): { ok: boolean; reason?: string } {
  if (!Number.isFinite(timelockUnix) || timelockUnix <= 0) {
    return { ok: false, reason: t("zahl.fristUnbekannt") };
  }
  const rest = timelockUnix - nowUnix;
  if (rest <= 0) {
    return { ok: false, reason: t("zahl.fristAbgelaufen") };
  }
  if (rest <= CLAIM_SAFETY_MARGIN_SECS) {
    return { ok: false, reason: t("zahl.fristZuKnapp", { min: Math.floor(rest / 60) }) };
  }
  return { ok: true };
}

/** Fehlercodes des HTLC-Programms (Anchor: 6000 + Position im Enum) → Schlüssel des Texts. */
const HTLC_ERRORS: Record<number, string> = {
  6000: "zahl.htlc6000",
  6001: "zahl.htlc6001",
  6002: "zahl.htlc6002",
  6003: "zahl.htlc6003",
  6004: "zahl.htlc6004",
  6005: "zahl.htlc6005",
  6006: "zahl.htlc6006",
  6007: "zahl.htlc6007",
};

const htlcFehler = (code: number): string | undefined => (code in HTLC_ERRORS ? t(HTLC_ERRORS[code]!) : undefined);

/**
 * Uebersetzt einen Fehler des HTLC-Programms in einen verstaendlichen Satz.
 * Versteht das Objekt aus confirmTransaction ({ InstructionError: [i, { Custom }] })
 * und Fehlertexte aus der Vorabsimulation ("custom program error: 0x1777").
 */
export function describeHtlcError(err: unknown): string | undefined {
  const ie = (err as { InstructionError?: [number, unknown] } | null)?.InstructionError;
  const custom = (ie?.[1] as { Custom?: number } | undefined)?.Custom;
  if (typeof custom === "number") return htlcFehler(custom);
  const text = typeof err === "string" ? err : err instanceof Error ? err.message : "";
  const hex = /custom program error: 0x([0-9a-f]+)/i.exec(text);
  if (hex) return htlcFehler(parseInt(hex[1], 16));
  return undefined;
}

export interface ClaimParams {
  connection: import("@solana/web3.js").Connection;
  wallet: WalletSigner;
  swapId: string;
  preimage: Uint8Array;
  /** Wer den Swap angelegt hat — bekommt die Mietbefreiung zurück. */
  initiator: string;
  /** Frist des SOL-HTLC (Unix-Sekunden). Pflicht: ohne Frist wird nicht eingeloest. */
  timelockUnix: number;
  onProgress?: (step: string) => void;
}

/**
 * Löst das SOL-HTLC ein und legt dabei das Preimage offen.
 *
 * Ab diesem Moment kann der LP die Lightning-Zahlung abschließen — das ist
 * gewollt und der Kern des atomaren Tauschs: eine Seite kann nicht ohne die
 * andere gewinnen.
 */
export async function claimSwap(p: ClaimParams): Promise<{ signature: string }> {
  const vorher = claimAllowed(p.timelockUnix);
  if (!vorher.ok) throw new Error(vorher.reason);
  const { Transaction, PublicKey } = await import("@solana/web3.js");
  const recipient = p.wallet.publicKey.toBase58();

  p.onProgress?.(t("zahl.einloesungVorbereiten"));
  const ix = await buildClaimInstruction(p.swapId, p.preimage, recipient, p.initiator);
  const tx = new Transaction().add(ix);

  const { blockhash, lastValidBlockHeight } = await p.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = new PublicKey(recipient);

  p.onProgress?.(t("zahl.warteWallet"));
  const signed = (await p.wallet.signTransaction(tx)) as import("@solana/web3.js").Transaction;

  p.onProgress?.(t("zahl.wirdGesendet"));
  // Zweite Pruefung: Die Bestaetigung in der Wallet kann Minuten dauern.
  const nachher = claimAllowed(p.timelockUnix);
  if (!nachher.ok) throw new Error(nachher.reason);

  // Vorabsimulation bleibt an: Eine abgelehnte Einloesung soll gar nicht erst
  // in einen Block gelangen, weil sie das Preimage offenlegen wuerde.
  let signature: string;
  try {
    signature = await p.connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
  } catch (e) {
    throw new Error(describeHtlcError(e) ?? t("zahl.einloesungAbgelehnt", { fehler: (e as Error).message }));
  }
  const conf = await p.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (conf.value.err) {
    throw new Error(
      describeHtlcError(conf.value.err) ?? t("zahl.einloesungAbgelehntMeist", { fehler: JSON.stringify(conf.value.err) }),
    );
  }
  return { signature };
}

/**
 * Dauerhafte Ablage des Preimage.
 *
 * Lag vorher in `sessionStorage` — beim Schließen des Tabs weg, und damit der
 * Zugriff auf das Geld. `localStorage` überlebt wenigstens einen Neustart.
 * Wirklich sicher ist nur eine Sicherung durch den Nutzer, deshalb gibt es
 * `exportSwapSecrets()`.
 */
const STORE_PREFIX = "freedom.swap.";

export interface StoredSwap {
  hashlockHex: string;
  preimageHex: string;
  swapId?: string;
  solAddress: string;
  amountSats: number;
  createdAt: number;
}

/**
 * Wo die Preimages liegen. Standard: localStorage. Mit Tresor (Schritt 1.2c)
 * setzt die App hier den verschluesselten Speicher ein – vor dem ersten Swap
 * verlangt sie den Tresor ohnehin.
 */
export interface SwapSpeicher {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
  keys(): string[];
}

const lokalerSpeicher: SwapSpeicher = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: (k) => localStorage.removeItem(k),
  keys: () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    .filter((k): k is string => k !== null),
};

let speicher: SwapSpeicher = lokalerSpeicher;

export function setzeSwapSpeicher(s: SwapSpeicher): void {
  speicher = s;
}

/** Speichern ist awaitbar: Erst wenn das Preimage sicher liegt, darf gezahlt werden. */
export async function saveSwapSecret(s: StoredSwap): Promise<void> {
  await speicher.setItem(STORE_PREFIX + s.hashlockHex, JSON.stringify(s));
}

export function loadSwapSecret(hashlockHex: string): StoredSwap | null {
  const raw = speicher.getItem(STORE_PREFIX + hashlockHex);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSwap;
  } catch {
    return null;
  }
}

export function listSwapSecrets(): StoredSwap[] {
  const out: StoredSwap[] = [];
  for (const k of speicher.keys()) {
    if (!k.startsWith(STORE_PREFIX)) continue;
    try {
      out.push(JSON.parse(speicher.getItem(k)!) as StoredSwap);
    } catch { /* beschädigter Eintrag */ }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function forgetSwapSecret(hashlockHex: string): Promise<void> {
  await speicher.removeItem(STORE_PREFIX + hashlockHex);
}

/** Alle Schluessel, unter denen Preimages liegen – fuer die Uebernahme in den Tresor. */
export function swapSecretKeys(keys: string[]): string[] {
  return keys.filter((k) => k.startsWith(STORE_PREFIX));
}

/** Sicherung zum Herunterladen — ohne Preimage ist verlorenes Geld verloren. */
export function exportSwapSecrets(): string {
  return JSON.stringify(
    {
      hinweis: t("zahl.sicherungHinweis"),
      exportiertAm: new Date().toISOString(),
      swaps: listSwapSecrets(),
    },
    null,
    2,
  );
}

/** Prüft, ob ein Preimage zum Hashlock passt — vor dem Einlösen. */
export function preimageFits(preimageHex: string, hashlockHex: string): boolean {
  try {
    return bytesToHex(sha256(hexToBytes(preimageHex))) === hashlockHex.toLowerCase();
  } catch {
    return false;
  }
}

/** Hoechste Vorab-Gebuehr, die die App zahlt (4.6d) – darueber ist es kein Blockadeschutz mehr. */
export const MAX_VORAB_SATS = 1000;

/**
 * Vorab-Gebuehr des LP pruefen (4.6d), bevor irgendetwas gezahlt wird: nur,
 * wenn das Angebot sie angekuendigt hat, genau in dieser Hoehe, und die
 * Rechnung muss gueltig signiert sein und genau diesen Betrag nennen.
 */
export function pruefeVorab(
  antwort: { tags: string[][]; content: string },
  angekuendigt: number | undefined,
): { ok: true; sats: number; bolt11: string } | { ok: false; grund: string } {
  if (!angekuendigt) return { ok: false, grund: t("zahl.vorabNichtAngekuendigt") };
  const sats = Number(antwort.tags.find((t) => t[0] === "vorab_sats")?.[1]);
  if (sats !== angekuendigt) return { ok: false, grund: t("zahl.vorabAnders", { sats, angekuendigt }) };
  if (sats > MAX_VORAB_SATS) return { ok: false, grund: t("zahl.vorabZuHoch", { max: MAX_VORAB_SATS }) };
  const bolt11 = antwort.content.trim();
  let betragMsat: number | null;
  try {
    betragMsat = leseBolt11(bolt11).betragMsat;
  } catch {
    return { ok: false, grund: t("zahl.vorabRechnungUngueltig") };
  }
  if (betragMsat !== sats * 1000) return { ok: false, grund: t("zahl.vorabBetragAnders") };
  return { ok: true, sats, bolt11 };
}

/** Nächster sinnvoller Schritt für die Oberfläche. */
export function nextStep(state: SwapState, nowUnix = Math.floor(Date.now() / 1000)): string {
  switch (state.phase) {
    case "warte_auf_lp":
      return t("zahl.schrittWarteLp");
    case "pruefe_sperre":
      return t("zahl.schrittPruefe");
    case "zahlbar":
      return t("zahl.schrittZahlbar");
    case "bezahlt": {
      if (!state.solTimelockUnix) return t("zahl.schrittBezahlt");
      const erlaubt = claimAllowed(state.solTimelockUnix, nowUnix);
      if (!erlaubt.ok) return erlaubt.reason ?? t("zahl.schrittUnsicher");
      const rest = state.solTimelockUnix - nowUnix - CLAIM_SAFETY_MARGIN_SECS;
      return rest < 900
        ? t("zahl.schrittJetzt", { min: Math.max(1, Math.floor(rest / 60)) })
        : t("zahl.schrittBezahlt");
    }
    case "abgeschlossen":
      return t("zahl.schrittFertig");
    case "abgelaufen":
      return t("zahl.schrittAbgelaufen");
    default:
      return state.message;
  }
}

/**
 * Prüfung vor einem Tausch (8.16e) – dieselben Einzelprüfungen wie
 * `swapPrivacyCheck()` im Protokoll (Wiederverwendung, runder Betrag, Zeit),
 * aber mit Texten in der Sprache der Oberfläche; die des Protokolls sind Deutsch.
 */
export function tauschPruefung(input: {
  usage: AddressUsage[];
  lamports: number;
  lastSwapAt?: number;
  nowSecs?: number;
  randomFn?: () => number;
}): { ok: boolean; befunde: string[]; schritte: string[] } {
  const jetzt = input.nowSecs ?? Math.floor(Date.now() / 1000);
  const reuse = checkReuse(input.usage);
  const betrag = checkAmount(input.lamports, input.randomFn);
  const zeit = checkTiming(input.lastSwapAt, jetzt);
  const befunde: string[] = [];
  const schritte: string[] = [];
  if (reuse.severity !== "frisch") {
    const mehrfach = input.usage.reduce((m, u) => Math.max(m, u.uses), 0);
    befunde.push(reuse.severity === "muster" ? t("zahl.pruefMuster", { n: mehrfach }) : t("zahl.pruefZweimal"));
    schritte.push(t("zahl.pruefFrischeAdresse", { n: reuse.nextIndex }));
  }
  if (betrag.suspicious) {
    const fmt = (l: number, stellen: number) => (l / 1e9).toLocaleString(gebietsschema(), { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
    befunde.push(t("zahl.pruefRund", { sol: fmt(input.lamports, 3) }));
    schritte.push(t("zahl.pruefBetragAendern", { sol: fmt(betrag.suggested ?? 0, 6) }));
  }
  if (zeit.correlated && input.lastSwapAt !== undefined) {
    const abstand = jetzt - input.lastSwapAt;
    const min = Math.round(abstand / 60);
    befunde.push(abstand < 300 ? t("zahl.pruefZeitKnapp", { min }) : t("zahl.pruefZeitMoeglich", { min }));
    schritte.push(t("zahl.pruefWarten"));
  }
  return { ok: befunde.length === 0, befunde, schritte };
}
