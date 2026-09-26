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
import { PublicKey, SYSVAR_RECENT_BLOCKHASHES_PUBKEY, SystemProgram, Transaction } from "@solana/web3.js";
import { pruefeSolanaTx } from "./mesh-transport.js";

/** Groesse eines Nonce-Kontos (Version, Zustand, Autoritaet, Wert, Gebuehr). */
export const NONCE_KONTO_BYTES = 80;
/** Grundgebuehr je Signatur. */
export const LAMPORTS_JE_SIGNATUR = 5000;

/** Anweisungsnummern des System-Programms. */
const SYS_TRANSFER = 2;
const SYS_NONCE_ADVANCE = 4;

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
export function baueNonceKontoAnlegen(p: { zahler: string; nonceKonto: string; mieteLamports: number; blockhash: string }): Transaction {
  nonceKontoKosten(p.mieteLamports);
  const zahler = new PublicKey(p.zahler);
  const tx = SystemProgram.createNonceAccount({
    fromPubkey: zahler,
    noncePubkey: new PublicKey(p.nonceKonto),
    authorizedPubkey: zahler,
    lamports: p.mieteLamports,
  });
  tx.feePayer = zahler;
  tx.recentBlockhash = p.blockhash;
  return tx;
}

/**
 * Nonce-Konto schliessen: das ganze Guthaben (die Miete) zurueck an die
 * Autoritaet – danach gibt es das Konto nicht mehr. Mit Netz, signiert von der
 * Autoritaet.
 */
export function baueNonceKontoSchliessen(p: { autoritaet: string; nonceKonto: string; lamports: number; blockhash: string }): Transaction {
  if (!Number.isSafeInteger(p.lamports) || p.lamports <= 0) throw new Error("Guthaben ungültig");
  const autoritaet = new PublicKey(p.autoritaet);
  const tx = new Transaction().add(SystemProgram.nonceWithdraw({
    noncePubkey: new PublicKey(p.nonceKonto), authorizedPubkey: autoritaet, toPubkey: autoritaet, lamports: p.lamports,
  }));
  tx.feePayer = autoritaet;
  tx.recentBlockhash = p.blockhash;
  return tx;
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
  if (v.getUint32(4, true) !== 1) throw new Error("Nonce-Konto ist nicht eingerichtet");
  const gebuehr = v.getBigUint64(72, true);
  return {
    autoritaet: new PublicKey(daten.subarray(8, 40)).toBase58(),
    nonce: new PublicKey(daten.subarray(40, 72)).toBase58(),
    lamportsJeSignatur: gebuehr <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(gebuehr) : Number.MAX_SAFE_INTEGER,
  };
}

/**
 * Ueberweisung fuer offline: erst das Weiterschalten des Nonce-Kontos, dann
 * die Ueberweisung; der Nonce-Wert steht an der Stelle des Blockhashs. Braucht
 * kein Netz – nur den vorher gelesenen Stand.
 */
export function baueOfflineUeberweisung(p: {
  von: string; an: string; lamports: number; nonceKonto: string; stand: NonceStand;
}): Transaction {
  if (!Number.isSafeInteger(p.lamports) || p.lamports <= 0) throw new Error("Betrag muss eine positive ganze Zahl sein");
  if (p.von === p.an) throw new Error("Überweisung an sich selbst");
  if (p.stand.autoritaet !== p.von) throw new Error("Das Nonce-Konto gehört einer anderen Adresse");
  const von = new PublicKey(p.von);
  const tx = new Transaction().add(
    SystemProgram.nonceAdvance({ noncePubkey: new PublicKey(p.nonceKonto), authorizedPubkey: von }),
    SystemProgram.transfer({ fromPubkey: von, toPubkey: new PublicKey(p.an), lamports: p.lamports }),
  );
  tx.feePayer = von;
  tx.recentBlockhash = p.stand.nonce;
  return tx;
}

export type OfflinePruefung =
  | { ok: true; von: string; an: string; lamports: number; nonceKonto: string; nonce: string }
  | { ok: false; grund: string };

/**
 * Offline-Ueberweisung pruefen – vor dem Einreichen und nach dem Empfang ueber
 * Funk. Genau zwei Anweisungen: Weiterschalten des Nonce-Kontos, dann eine
 * Ueberweisung vom Zahler; Zahler = Autoritaet = Gebuehrenzahler; alle
 * Signaturen gueltig. Ob der Wert noch der aktuelle ist, weiss erst die Kette.
 */
export function pruefeOfflineUeberweisung(roh: Uint8Array): OfflinePruefung {
  const sig = pruefeSolanaTx(roh);
  if (!sig.ok) return sig;
  let tx: Transaction;
  try {
    tx = Transaction.from(roh);
  } catch {
    return { ok: false, grund: "keine lesbare Transaktion" };
  }
  if (tx.instructions.length !== 2) return { ok: false, grund: "erwartet: Nonce weiterschalten und Überweisung, sonst nichts" };
  const [weiter, zahlung] = tx.instructions;
  const wd = new DataView(weiter.data.buffer, weiter.data.byteOffset, weiter.data.byteLength);
  if (!weiter.programId.equals(SystemProgram.programId) || weiter.data.length !== 4 || wd.getUint32(0, true) !== SYS_NONCE_ADVANCE) {
    return { ok: false, grund: "erste Anweisung schaltet kein Nonce-Konto weiter – kein Durable Nonce" };
  }
  const [nonceKonto, sysvar, autoritaet] = weiter.keys;
  if (!nonceKonto || !sysvar?.pubkey.equals(SYSVAR_RECENT_BLOCKHASHES_PUBKEY) || !autoritaet?.isSigner) {
    return { ok: false, grund: "Nonce-Anweisung unvollständig" };
  }
  const zd = new DataView(zahlung.data.buffer, zahlung.data.byteOffset, zahlung.data.byteLength);
  if (!zahlung.programId.equals(SystemProgram.programId) || zahlung.data.length !== 12 || zd.getUint32(0, true) !== SYS_TRANSFER) {
    return { ok: false, grund: "zweite Anweisung ist keine Überweisung" };
  }
  const [von, an] = zahlung.keys;
  if (!von || !an || !von.isSigner) return { ok: false, grund: "Überweisung ohne signierenden Zahler" };
  if (!von.pubkey.equals(autoritaet.pubkey) || !tx.feePayer?.equals(von.pubkey)) {
    return { ok: false, grund: "Zahler, Nonce-Autorität und Gebührenzahler müssen dieselbe Adresse sein" };
  }
  const lamports = zd.getBigUint64(4, true);
  if (lamports === 0n || lamports > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, grund: "Betrag ungültig" };
  if (!tx.recentBlockhash) return { ok: false, grund: "kein Nonce-Wert" };
  return {
    ok: true,
    von: von.pubkey.toBase58(),
    an: an.pubkey.toBase58(),
    lamports: Number(lamports),
    nonceKonto: nonceKonto.pubkey.toBase58(),
    nonce: tx.recentBlockhash,
  };
}
