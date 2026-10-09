/**
 * Solana-Zahlkanal – Client (Schritt 4.3). Format: `docs/ZAHLKANAL.md`.
 *
 * Der Kunde zahlt einmal in einen Kanal ein (PDA des Programms
 * `contracts/solana-channel`) und bezahlt danach jede Antwort mit einer
 * Gutschrift: einer Ed25519-Signatur seines Sitzungsschlüssels über den
 * bisher geschuldeten Gesamtbetrag. Der Provider löst die höchste Gutschrift
 * ein; das Programm teilt die Zahlung fest auf die Empfänger aus A+ auf.
 *
 * Läuft auch im Browser: keine Node-Module, Zahlen über `DataView` (das
 * Buffer-Polyfill kennt `readBigInt64LE` & Co. nicht).
 */
import {
  Ed25519Program,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { MAX_ANTEILE_PPM } from "./aufteilung.js";
import { ProtokollFehler } from "./fehler.js";

const text = new TextEncoder();

/**
 * Adresse des Programms auf Devnet (Deploy durch den MENSCHEN am 09.10.2026,
 * `docs/ZAHLKANAL.md`). Gleich `declare_id!` in `contracts/solana-channel` –
 * Anchor lehnt sonst jeden Aufruf ab (4100); ein Test vergleicht beide. Ändern
 * nur zusammen mit einem Deploy oder Upgrade durch den MENSCHEN.
 */
export const KANAL_PROGRAMM_ID = "F9P2PeyySkeQL4d1KAtHjtnVBqzjW3dqbfubY1PChW2m";

/** Domain-Präfix der Gutschrift; eine neue Version heißt: neues Programm. */
export const GUTSCHRIFT_PRAEFIX = "freedomstack-channel-v1";
export const GUTSCHRIFT_LAENGE = GUTSCHRIFT_PRAEFIX.length + 32 + 8 + 8;
export const MAX_KANAL_EMPFAENGER = 8;
/** 8 Diskriminator + 3 Schlüssel + 4 Zahlen + Vec-Länge + 8 Empfänger + bump. */
export const KANAL_KONTO_BYTES = 8 + 3 * 32 + 4 * 8 + 4 + MAX_KANAL_EMPFAENGER * 36 + 1;

export interface KanalEmpfaenger {
  adresse: string;
  ppm: number;
}

export interface KanalStand {
  kunde: string;
  provider: string;
  sitzungsSchluessel: string;
  nonce: bigint;
  eingezahlt: bigint;
  ausgezahlt: bigint;
  ablauf: bigint;
  empfaenger: KanalEmpfaenger[];
  bump: number;
}

export interface Gutschrift {
  kanal: string;
  betrag: bigint;
  ablauf: bigint;
  /** Ed25519-Signatur, hex. */
  signatur: string;
}

function diskriminator(art: "global" | "account", name: string): Uint8Array {
  return sha256(text.encode(`${art}:${name}`)).subarray(0, 8);
}

function u64(n: bigint): Uint8Array {
  if (n < 0n || n > 0xffff_ffff_ffff_ffffn) throw new Error("u64 außerhalb des Bereichs");
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}

function i64(n: bigint): Uint8Array {
  if (n < -(2n ** 63n) || n >= 2n ** 63n) throw new Error("i64 außerhalb des Bereichs");
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, n, true);
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function verbinde(...teile: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(teile.reduce((s, t) => s + t.length, 0));
  let o = 0;
  for (const t of teile) { out.set(t, o); o += t.length; }
  return out;
}

const schluessel = (adresse: string): Uint8Array => new PublicKey(adresse).toBytes();

/** Adresse des Kanals: PDA mit den Seeds ["channel", Kunde, Provider, nonce (u64 LE)]. */
export function kanalAdresse(kunde: string, provider: string, nonce: bigint, programmId = KANAL_PROGRAMM_ID): { adresse: string; bump: number } {
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [text.encode("channel"), schluessel(kunde), schluessel(provider), u64(nonce)],
    new PublicKey(programmId),
  );
  return { adresse: pda.toBase58(), bump };
}

/** Die signierte Bytefolge: Präfix ‖ Kanal ‖ Betrag (u64 LE) ‖ Ablauf (i64 LE). */
export function gutschriftNachricht(kanal: string, betrag: bigint, ablauf: bigint): Uint8Array {
  return verbinde(text.encode(GUTSCHRIFT_PRAEFIX), schluessel(kanal), u64(betrag), i64(ablauf));
}

/** Neuer Sitzungsschlüssel für einen Kanal (Ed25519, nur für Gutschriften). */
export function neuerSitzungsSchluessel(): { geheim: Uint8Array; oeffentlich: string } {
  const geheim = ed25519.utils.randomSecretKey();
  return { geheim, oeffentlich: new PublicKey(ed25519.getPublicKey(geheim)).toBase58() };
}

export function signiereGutschrift(geheim: Uint8Array, kanal: string, betrag: bigint, ablauf: bigint): Gutschrift {
  const signatur = bytesToHex(ed25519.sign(gutschriftNachricht(kanal, betrag, ablauf), geheim));
  return { kanal, betrag, ablauf, signatur };
}

export type GutschriftPruefung = { ok: true } | { ok: false; grund: string };

/**
 * Prüfung beim Provider, bevor er eine Gutschrift annimmt: für diesen Kanal
 * und seinen Ablauf, gültig signiert vom Sitzungsschlüssel, mehr als die
 * letzte angenommene und höchstens die Einlage.
 */
export function pruefeGutschrift(g: Gutschrift, kanal: { adresse: string; stand: KanalStand }, letzte: bigint): GutschriftPruefung {
  if (g.kanal !== kanal.adresse) return { ok: false, grund: "Gutschrift für einen anderen Kanal" };
  if (g.ablauf !== kanal.stand.ablauf) return { ok: false, grund: "Ablauf passt nicht zum Kanal" };
  if (!/^[0-9a-f]{128}$/.test(g.signatur)) return { ok: false, grund: "Signatur hat nicht die Form" };
  let gueltig = false;
  try {
    gueltig = ed25519.verify(hexToBytes(g.signatur), gutschriftNachricht(g.kanal, g.betrag, g.ablauf), schluessel(kanal.stand.sitzungsSchluessel));
  } catch {
    gueltig = false;
  }
  if (!gueltig) return { ok: false, grund: "Signatur ungültig" };
  if (g.betrag <= letzte) return { ok: false, grund: "nicht mehr als die letzte Gutschrift" };
  if (g.betrag > kanal.stand.eingezahlt) return { ok: false, grund: "mehr als die Einlage" };
  return { ok: true };
}

/**
 * Transport im versiegelten Kern der Anfrage (4.3c): `["kanal", Adresse]` und
 * `["gutschrift", Betrag, Ablauf, Signatur]`. Nie offen – die Gutschrift
 * verrät Kanal und Betrag.
 */
export function gutschriftTags(g: Gutschrift): string[][] {
  return [["kanal", g.kanal], ["gutschrift", g.betrag.toString(), g.ablauf.toString(), g.signatur]];
}

/** Gutschrift aus den Tags einer Anfrage; undefined ohne Kanal, wirft bei kaputter Form. */
export function leseGutschriftTags(tags: readonly string[][]): Gutschrift | undefined {
  const kanal = tags.find((t) => t[0] === "kanal")?.[1];
  if (kanal === undefined) return undefined;
  const g = tags.find((t) => t[0] === "gutschrift");
  if (!g || !/^\d{1,20}$/.test(g[1] ?? "") || !/^-?\d{1,19}$/.test(g[2] ?? "") || !/^[0-9a-f]{128}$/.test(g[3] ?? "")) {
    throw new Error("Gutschrift fehlt oder hat nicht die Form");
  }
  schluessel(kanal);
  return { kanal, betrag: BigInt(g[1]), ablauf: BigInt(g[2]), signatur: g[3] };
}

/** Empfänger prüfen wie das Programm: höchstens 8, je ≥ 1 ppm, zusammen ≤ 10 %. */
export function pruefeKanalEmpfaenger(empfaenger: readonly KanalEmpfaenger[], kanal?: string): void {
  if (empfaenger.length > MAX_KANAL_EMPFAENGER) throw new Error(`höchstens ${MAX_KANAL_EMPFAENGER} Empfänger`);
  let summe = 0;
  for (const e of empfaenger) {
    if (!Number.isInteger(e.ppm) || e.ppm < 1) throw new Error("Anteil muss mindestens 1 ppm sein");
    schluessel(e.adresse);
    if (kanal && e.adresse === kanal) throw new Error("der Kanal kann nicht Empfänger sein");
    summe += e.ppm;
  }
  if (summe > MAX_ANTEILE_PPM) throw new Error("Anteile zusammen über 10 %");
}

/**
 * Aufteilung einer Auszahlung wie im Programm (ohne dessen Mietprüfung, die
 * einen Anteil an den Provider umleiten kann): abgerundet, Rest an den Provider.
 */
export function teileKanalZahlung(auszahlbar: bigint, empfaenger: readonly KanalEmpfaenger[]): { providerLamports: bigint; anteile: bigint[] } {
  const anteile = empfaenger.map((e) => (auszahlbar * BigInt(e.ppm)) / 1_000_000n);
  return { providerLamports: auszahlbar - anteile.reduce((s, a) => s + a, 0n), anteile };
}

export function oeffneKanalIx(p: {
  kunde: string; provider: string; nonce: bigint; betrag: bigint; ablauf: bigint;
  sitzungsSchluessel: string; empfaenger: readonly KanalEmpfaenger[];
}, programmId = KANAL_PROGRAMM_ID): TransactionInstruction {
  if (p.betrag <= 0n) throw new ProtokollFehler("kanal-betrag", "Betrag muss größer als 0 sein");
  const { adresse } = kanalAdresse(p.kunde, p.provider, p.nonce, programmId);
  pruefeKanalEmpfaenger(p.empfaenger, adresse);
  const daten = verbinde(
    diskriminator("global", "open"), u64(p.nonce), u64(p.betrag), i64(p.ablauf), schluessel(p.sitzungsSchluessel),
    u32(p.empfaenger.length), ...p.empfaenger.flatMap((e) => [schluessel(e.adresse), u32(e.ppm)]),
  );
  return new TransactionInstruction({
    programId: new PublicKey(programmId),
    keys: [
      { pubkey: new PublicKey(p.kunde), isSigner: true, isWritable: true },
      { pubkey: new PublicKey(p.provider), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(adresse), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(daten),
  });
}

/**
 * Einlösen: die Ed25519-Anweisung mit der Gutschrift direkt vor `settle`,
 * danach die Empfänger in der Reihenfolge des Kanals.
 */
export function rechneKanalAbIxs(p: {
  provider: string; gutschrift: Gutschrift; sitzungsSchluessel: string; empfaenger: readonly KanalEmpfaenger[];
}, programmId = KANAL_PROGRAMM_ID): TransactionInstruction[] {
  const g = p.gutschrift;
  const pruefung = Ed25519Program.createInstructionWithPublicKey({
    publicKey: schluessel(p.sitzungsSchluessel),
    message: gutschriftNachricht(g.kanal, g.betrag, g.ablauf),
    signature: hexToBytes(g.signatur),
  });
  const settle = new TransactionInstruction({
    programId: new PublicKey(programmId),
    keys: [
      { pubkey: new PublicKey(p.provider), isSigner: true, isWritable: true },
      { pubkey: new PublicKey(g.kanal), isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      ...p.empfaenger.map((e) => ({ pubkey: new PublicKey(e.adresse), isSigner: false, isWritable: true })),
    ],
    data: Buffer.from(verbinde(diskriminator("global", "settle"), u64(g.betrag))),
  });
  return [pruefung, settle];
}

/**
 * Rest nach Ablauf zurück an den Kunden; schließt den Kanal. Seit Z1 ohne
 * Unterschrift des Kunden: Wer die Transaktion bezahlt, ist gleich – das Geld
 * geht nur an den Kunden des Kanals.
 */
export function erstatteKanalIx(p: { kunde: string; kanal: string }, programmId = KANAL_PROGRAMM_ID): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(programmId),
    keys: [
      { pubkey: new PublicKey(p.kunde), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(p.kanal), isSigner: false, isWritable: true },
    ],
    data: Buffer.from(diskriminator("global", "refund")),
  });
}

export function stockeKanalAufIx(p: { kunde: string; kanal: string; betrag: bigint }, programmId = KANAL_PROGRAMM_ID): TransactionInstruction {
  if (p.betrag <= 0n) throw new ProtokollFehler("kanal-betrag", "Betrag muss größer als 0 sein");
  return new TransactionInstruction({
    programId: new PublicKey(programmId),
    keys: [
      { pubkey: new PublicKey(p.kunde), isSigner: true, isWritable: true },
      { pubkey: new PublicKey(p.kanal), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(verbinde(diskriminator("global", "top_up"), u64(p.betrag))),
  });
}

/** Das Konto eines Kanals lesen (Daten von `getAccountInfo`); wirft bei falscher Art oder Länge. */
export function leseKanal(daten: Uint8Array): KanalStand {
  if (daten.length < 8 + 3 * 32 + 4 * 8 + 4 + 1) throw new Error("Kanal-Konto zu kurz");
  const d = diskriminator("account", "Channel");
  if (!d.every((b, i) => daten[i] === b)) throw new Error("kein Kanal-Konto");
  const dv = new DataView(daten.buffer, daten.byteOffset, daten.byteLength);
  let o = 8;
  const pk = () => { const k = new PublicKey(daten.subarray(o, o + 32)).toBase58(); o += 32; return k; };
  const kunde = pk(), provider = pk(), sitzungsSchluessel = pk();
  const nonce = dv.getBigUint64(o, true); o += 8;
  const eingezahlt = dv.getBigUint64(o, true); o += 8;
  const ausgezahlt = dv.getBigUint64(o, true); o += 8;
  const ablauf = dv.getBigInt64(o, true); o += 8;
  const anzahl = dv.getUint32(o, true); o += 4;
  if (anzahl > MAX_KANAL_EMPFAENGER || daten.length < o + anzahl * 36 + 1) throw new Error("Empfängerliste ungültig");
  const empfaenger: KanalEmpfaenger[] = [];
  for (let i = 0; i < anzahl; i++) {
    const adresse = pk();
    empfaenger.push({ adresse, ppm: dv.getUint32(o, true) });
    o += 4;
  }
  return { kunde, provider, sitzungsSchluessel, nonce, eingezahlt, ausgezahlt, ablauf, empfaenger, bump: daten[o] };
}
