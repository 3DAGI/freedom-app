/**
 * SOL ohne Internet (Schritt 7.2): Durable Nonces.
 *
 * Eine Solana-Transaktion traegt einen Blockhash und ist nur rund 150 Bloecke
 * (etwa eine Minute) gueltig – zu kurz fuer einen Weg ueber Funk oder Stick.
 * Mit einem Nonce-Konto nimmt die Transaktion statt des Blockhashs den dort
 * gespeicherten Wert; sie bleibt gueltig, bis das Konto weitergeschaltet wird.
 * Die erste Anweisung muss genau dieses Weiterschalten sein
 * (`AdvanceNonceAccount`) – so kann derselbe Wert nur einmal zahlen.
 *
 * Ablauf: online ein Nonce-Konto anlegen (Kosten vorher zeigen), den Wert
 * lesen; offline die Ueberweisung damit bauen und signieren; ueber Funk oder
 * Datei zu einem Geraet mit Netz, das sie einreicht. Danach ist der Wert
 * verbraucht – fuer die naechste Offline-Zahlung online neu lesen.
 *
 * Geprueft wird ohne Buffer-BigInt-Methoden (DataView): die App prueft im Browser.
 */
import { address, createNoopSigner, getAddressDecoder } from "@solana/kit";
import {
  getCreateAccountInstruction, getInitializeNonceAccountInstruction, getTransferSolInstruction, getWithdrawNonceAccountInstruction,
} from "@solana-program/system";
import { SYSTEM_PROGRAMM } from "./kit-bruecke.js";
import { ausDraht, baueTransaktion, leseNachricht, type GeleseneNachricht, type SolTransaktion } from "./kit-transaktion.js";
import { pruefeSolanaTx, type SolanaTxFehler } from "./mesh-transport.js";
import { ProtokollFehler } from "./fehler.js";

/** Groesse eines Nonce-Kontos (Version, Zustand, Autoritaet, Wert, Gebuehr). */
export const NONCE_KONTO_BYTES = 80;
/** Grundgebuehr je Signatur. */
export const LAMPORTS_JE_SIGNATUR = 5000;

/** Anweisungsnummern des System-Programms. */
const SYS_TRANSFER = 2;
const SYS_NONCE_ADVANCE = 4;
/** Sysvar, aus dem das Weiterschalten den neuen Wert nimmt. */
const SYSVAR_LETZTE_BLOCKHASHES = "SysvarRecentB1ockHashes11111111111111111111";

/**
 * Was das Anlegen kostet: die Miete (rent-exempt fuer 80 Byte, vom RPC) bleibt
 * im Konto und kommt beim Schliessen zurueck; dazu zwei Signaturen (Zahler und
 * neues Konto).
 */
export function nonceKontoKosten(mieteLamports: number): { miete: number; gebuehr: number; gesamt: number } {
  if (!Number.isSafeInteger(mieteLamports) || mieteLamports <= 0) throw new Error("Miete ungültig");
  const gebuehr = 2 * LAMPORTS_JE_SIGNATUR;
  return { miete: mieteLamports, gebuehr, gesamt: mieteLamports + gebuehr };
}

/**
 * Nonce-Konto anlegen: Konto erzeugen und als Nonce einrichten, Autoritaet ist
 * der Zahler. Signieren muessen Zahler und das neue Konto (frischer Schluessel,
 * danach nicht mehr gebraucht).
 */
export function baueNonceKontoAnlegen(p: {
  zahler: string; nonceKonto: string; mieteLamports: number; blockhash: string; letzteHoehe: bigint;
}): SolTransaktion {
  nonceKontoKosten(p.mieteLamports);
  // Anweisungen aus @solana-program/system (A-21b1); unterschrieben wird später – hier nur die Rolle
  const zahler = createNoopSigner(address(p.zahler));
  const nonceKonto = createNoopSigner(address(p.nonceKonto));
  return baueTransaktion({
    zahler: p.zahler,
    anweisungen: [
      getCreateAccountInstruction({
        payer: zahler, newAccount: nonceKonto, lamports: p.mieteLamports, space: NONCE_KONTO_BYTES, programAddress: address(SYSTEM_PROGRAMM),
      }),
      getInitializeNonceAccountInstruction({ nonceAccount: nonceKonto.address, nonceAuthority: zahler.address }),
    ],
    lebensdauer: { blockhash: p.blockhash, letzteHoehe: p.letzteHoehe },
  });
}

/**
 * Nonce-Konto schliessen: das ganze Guthaben (die Miete) zurueck an die
 * Autoritaet – danach gibt es das Konto nicht mehr. Mit Netz, signiert von der
 * Autoritaet.
 */
export function baueNonceKontoSchliessen(p: {
  autoritaet: string; nonceKonto: string; lamports: number; blockhash: string; letzteHoehe: bigint;
}): SolTransaktion {
  if (!Number.isSafeInteger(p.lamports) || p.lamports <= 0) throw new Error("Guthaben ungültig");
  const autoritaet = createNoopSigner(address(p.autoritaet));
  return baueTransaktion({
    zahler: p.autoritaet,
    anweisungen: [getWithdrawNonceAccountInstruction({
      nonceAccount: address(p.nonceKonto), recipientAccount: autoritaet.address, nonceAuthority: autoritaet, withdrawAmount: p.lamports,
    })],
    lebensdauer: { blockhash: p.blockhash, letzteHoehe: p.letzteHoehe },
  });
}

export interface NonceStand {
  /** Wer weiterschalten darf – hier immer der Zahler. */
  autoritaet: string;
  /** Der gespeicherte Wert, der den Blockhash ersetzt (base58). */
  nonce: string;
  lamportsJeSignatur: number;
}

/** Daten eines Nonce-Kontos lesen (80 Byte, eingerichtet). */
export function leseNonceKonto(daten: Uint8Array): NonceStand {
  if (daten.length !== NONCE_KONTO_BYTES) throw new Error(`Kein Nonce-Konto: ${daten.length} Byte`);
  const v = new DataView(daten.buffer, daten.byteOffset, daten.byteLength);
  const version = v.getUint32(0, true);
  if (version > 1) throw new Error(`Unbekannte Nonce-Version ${version}`);
  if (v.getUint32(4, true) !== 1) throw new ProtokollFehler("nonce-nicht-eingerichtet", "Nonce-Konto ist nicht eingerichtet");
  const gebuehr = v.getBigUint64(72, true);
  const base58 = getAddressDecoder();
  return {
    autoritaet: base58.decode(daten.subarray(8, 40)),
    nonce: base58.decode(daten.subarray(40, 72)),
    lamportsJeSignatur: gebuehr <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(gebuehr) : Number.MAX_SAFE_INTEGER,
  };
}

/**
 * Ueberweisung fuer offline: erst das Weiterschalten des Nonce-Kontos (setzt kit
 * an den Anfang), dann die Ueberweisung; der Nonce-Wert steht an der Stelle des
 * Blockhashs. Braucht kein Netz – nur den vorher gelesenen Stand.
 */
export function baueOfflineUeberweisung(p: {
  von: string; an: string; lamports: number; nonceKonto: string; stand: NonceStand;
}): SolTransaktion {
  if (!Number.isSafeInteger(p.lamports) || p.lamports <= 0) throw new ProtokollFehler("betrag-positiv", "Betrag muss eine positive ganze Zahl sein");
  if (p.von === p.an) throw new ProtokollFehler("an-sich-selbst", "Überweisung an sich selbst");
  if (p.stand.autoritaet !== p.von) throw new ProtokollFehler("nonce-andere-adresse", "Das Nonce-Konto gehört einer anderen Adresse");
  return baueTransaktion({
    zahler: p.von,
    anweisungen: [getTransferSolInstruction({ source: createNoopSigner(address(p.von)), destination: address(p.an), amount: p.lamports })],
    lebensdauer: { nonce: p.stand.nonce, nonceKonto: p.nonceKonto, autoritaet: p.von },
  });
}

/** Warum eine Offline-Überweisung nicht taugt (8.16g2b3) – die App bildet daraus den Text in ihrer Sprache. */
export type OfflineFehler =
  | SolanaTxFehler | "unlesbar" | "anweisungen" | "kein-nonce" | "nonce-unvollstaendig" | "keine-ueberweisung"
  | "ohne-zahler" | "zahler-verschieden" | "betrag" | "kein-nonce-wert";

export type OfflinePruefung =
  | { ok: true; von: string; an: string; lamports: number; nonceKonto: string; nonce: string }
  | { ok: false; grund: string; fall: OfflineFehler; bytes?: number; signatur?: number; signaturen?: number };

/**
 * Offline-Ueberweisung pruefen – vor dem Einreichen und nach dem Empfang ueber
 * Funk. Genau zwei Anweisungen: Weiterschalten des Nonce-Kontos, dann eine
 * Ueberweisung vom Zahler; Zahler = Autoritaet = Gebuehrenzahler; alle
 * Signaturen gueltig. Ob der Wert noch der aktuelle ist, weiss erst die Kette.
 */
export function pruefeOfflineUeberweisung(roh: Uint8Array): OfflinePruefung {
  const sig = pruefeSolanaTx(roh);
  if (!sig.ok) return sig;
  let tx: GeleseneNachricht;
  try {
    tx = leseNachricht(ausDraht(roh));
  } catch {
    return { ok: false, grund: "keine lesbare Transaktion", fall: "unlesbar" };
  }
  if (tx.anweisungen.length !== 2) return { ok: false, grund: "erwartet: Nonce weiterschalten und Überweisung, sonst nichts", fall: "anweisungen" };
  const [weiter, zahlung] = tx.anweisungen;
  const wd = new DataView(weiter.daten.buffer, weiter.daten.byteOffset, weiter.daten.byteLength);
  if (weiter.programm !== SYSTEM_PROGRAMM || weiter.daten.length !== 4 || wd.getUint32(0, true) !== SYS_NONCE_ADVANCE) {
    return { ok: false, grund: "erste Anweisung schaltet kein Nonce-Konto weiter – kein Durable Nonce", fall: "kein-nonce" };
  }
  const [nonceKonto, sysvar, autoritaet] = weiter.konten;
  if (!nonceKonto || sysvar?.adresse !== SYSVAR_LETZTE_BLOCKHASHES || !autoritaet?.signiert) {
    return { ok: false, grund: "Nonce-Anweisung unvollständig", fall: "nonce-unvollstaendig" };
  }
  const zd = new DataView(zahlung.daten.buffer, zahlung.daten.byteOffset, zahlung.daten.byteLength);
  if (zahlung.programm !== SYSTEM_PROGRAMM || zahlung.daten.length !== 12 || zd.getUint32(0, true) !== SYS_TRANSFER) {
    return { ok: false, grund: "zweite Anweisung ist keine Überweisung", fall: "keine-ueberweisung" };
  }
  const [von, an] = zahlung.konten;
  if (!von || !an || !von.signiert) return { ok: false, grund: "Überweisung ohne signierenden Zahler", fall: "ohne-zahler" };
  if (von.adresse !== autoritaet.adresse || tx.zahler !== von.adresse) {
    return { ok: false, grund: "Zahler, Nonce-Autorität und Gebührenzahler müssen dieselbe Adresse sein", fall: "zahler-verschieden" };
  }
  const lamports = zd.getBigUint64(4, true);
  if (lamports === 0n || lamports > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, grund: "Betrag ungültig", fall: "betrag" };
  if (!tx.lebensdauer) return { ok: false, grund: "kein Nonce-Wert", fall: "kein-nonce-wert" };
  return {
    ok: true,
    von: von.adresse,
    an: an.adresse,
    lamports: Number(lamports),
    nonceKonto: nonceKonto.adresse,
    nonce: tx.lebensdauer,
  };
}
