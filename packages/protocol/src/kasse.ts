/**
 * Gemeinsame Kasse für Räume über Squads v4 (A-12, `docs/KASSE-ENTWURF.md`) – Baustein.
 *
 * Kein eigenes Programm und kein SDK (W1 B): Die Anweisungen entstehen nach der IDL von
 * Squads v4 (`@sqds/multisig` 2.1.4, IDL 2.1.0), die Konten liest dieses Modul selbst. Getestet
 * wird gegen das echte Programm – das unveränderliche von Mainnet und das von Devnet, beide mit
 * fester Prüfsumme im lokalen Validator (`contracts/squads/pruefen.sh`). Vom Programm steht hier
 * nichts außer den Layouts.
 *
 * Zwei Arten (W2, beim Anlegen gewählt): „Gründer entscheidet“ – nur der Gründer stimmt ab und
 * führt aus, die übrigen schlagen vor, Schwelle 1 – und „Mehrheit“ – alle dürfen alles, Schwelle
 * die Mehrheit, mindestens 2. `config_authority` bleibt immer leer (V2): Mitglieder, Schwelle und
 * Art ändert nur eine Abstimmung. Die Art steht auf der Kette (Rechte und Schwelle); gelesen wird
 * sie nur über `kassenArt()`, nie aus dem Raum.
 *
 * Auszahlen (seit A-12a2): nur SOL aus dem Tresor an genau einen Empfänger. Vorschlagen legt Transaktion
 * und Vorschlag in einem Zug an; abstimmen, ausführen und abschließen (Miete zurück in den Tresor) sind je
 * eine Anweisung. Empfänger und Betrag liest die App vor jeder Stimme nur von der Kette (`leseAuszahlung()`,
 * V6) – eine Transaktion anderer Form ist keine Auszahlung dieser App.
 *
 * Läuft auch im Browser: Zahlen über `DataView`, Hash über `@noble/hashes`; die PDA rechnet
 * web3.js synchron wie beim Zahlkanal (bis A-21f).
 */
import { AccountRole, type Instruction } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { anweisung, SYSTEM_PROGRAMM } from "./kit-bruecke.js";
import { leseKonto, type SolRpc } from "./kit-rpc.js";
import { baueTransaktion, neuerKontoSchluessel, signiereMit, type Lebensdauer, type SolTransaktion } from "./kit-transaktion.js";

/** Squads v4 – dieselbe Kennung auf Devnet und Mainnet (Mainnet unveränderlich, Devnet nicht). */
export const SQUADS_PROGRAMM_ID = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";

/** Rechte eines Mitglieds (`Permissions.mask`): vorschlagen, abstimmen, ausführen. */
export const KASSEN_RECHT = { vorschlagen: 1, abstimmen: 2, ausfuehren: 4 } as const;
const ALLE_RECHTE = 7;

/** Zeitschloss zwischen Annahme und Ausführung (W3): 0 als Vorgabe, 1 h oder 24 h wählbar. */
export const KASSEN_ZEITSCHLOSS_SEK = [0, 3600, 86_400] as const;

export type KassenArt = "gruender" | "mehrheit";

export interface KassenMitglied {
  adresse: string;
  rechte: number;
}

export interface KassenStand {
  createKey: string;
  /** Immer null für Kassen dieser App (V2) – sonst ändert ein Schlüssel die Kasse am Programm vorbei. */
  verwalter: string | null;
  schwelle: number;
  zeitschlossSek: number;
  transaktionsIndex: bigint;
  /** Bis zu diesem Index sind Vorschläge ungültig (nach jeder Änderung der Konfiguration). */
  veraltetBis: bigint;
  /** Wohin die Miete abgeschlossener Vorschläge geht; null: nirgends hin. */
  mieteAn: string | null;
  bump: number;
  mitglieder: KassenMitglied[];
}

export interface ProgrammEinstellungen {
  autoritaet: string;
  /** Gebühr für das Anlegen einer Kasse in Lamports – Squads kann sie ändern. */
  gebuehr: bigint;
  /** Empfänger der Gebühr; `kasseAnlegenAnweisung()` braucht ihn als Konto. */
  schatzamt: string;
}

const text = new TextEncoder();
const programm = new PublicKey(SQUADS_PROGRAMM_ID);
const schluessel = (adresse: string): Uint8Array => new PublicKey(adresse).toBytes();

function diskriminator(art: "global" | "account", name: string): Uint8Array {
  return sha256(text.encode(`${art}:${name}`)).subarray(0, 8);
}

function verbinde(...teile: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(teile.reduce((n, t) => n + t.length, 0));
  let o = 0;
  for (const t of teile) { out.set(t, o); o += t.length; }
  return out;
}

const zahl = (bytes: number, setze: (dv: DataView) => void): Uint8Array => {
  const b = new Uint8Array(bytes);
  setze(new DataView(b.buffer));
  return b;
};
const u16 = (n: number) => zahl(2, (dv) => dv.setUint16(0, n, true));
const u32 = (n: number) => zahl(4, (dv) => dv.setUint32(0, n, true));
const u64 = (n: bigint) => {
  if (n < 0n || n > 0xffff_ffff_ffff_ffffn) throw new Error("u64 außerhalb des Bereichs");
  return zahl(8, (dv) => dv.setBigUint64(0, n, true));
};
/** Borsh `Option<Pubkey>`: 0 oder 1 und die 32 Byte. */
const vielleicht = (adresse: string | null) => adresse ? verbinde(Uint8Array.of(1), schluessel(adresse)) : Uint8Array.of(0);

const pda = (seeds: Uint8Array[]): string => PublicKey.findProgramAddressSync(seeds, programm)[0].toBase58();

/** Adresse der Kasse (Multisig-Konto): PDA aus ["multisig", "multisig", createKey]. */
export function kassenAdresse(createKey: string): string {
  return pda([text.encode("multisig"), text.encode("multisig"), schluessel(createKey)]);
}

/** Der Tresor der Kasse (Vault, Index 0) – er hält die SOL: ["multisig", Kasse, "vault", u8]. */
export function kassenTresor(kasse: string, index = 0): string {
  if (!Number.isInteger(index) || index < 0 || index > 255) throw new Error("Tresor-Index ungültig");
  return pda([text.encode("multisig"), schluessel(kasse), text.encode("vault"), Uint8Array.of(index)]);
}

/** Die Einstellungen des Programms (Gebühr, Schatzamt): ["multisig", "program_config"]. */
export function programmEinstellungenAdresse(): string {
  return pda([text.encode("multisig"), text.encode("program_config")]);
}

/** Mehrheit der Mitglieder, mindestens 2 (W2). */
export function mehrheitVon(anzahl: number): number {
  return Math.max(2, Math.floor(anzahl / 2) + 1);
}

/**
 * Mitglieder und Schwelle einer neuen Kasse nach ihrer Art (W2). „Gründer entscheidet“: der
 * Gründer mit allen Rechten, die übrigen schlagen nur vor, Schwelle 1. „Mehrheit“: alle mit allen
 * Rechten, Schwelle `mehrheitVon()` – also mindestens zwei Mitglieder. Jede Adresse nur einmal.
 */
export function kassenMitglieder(art: KassenArt, gruender: string, weitere: readonly string[]): { mitglieder: KassenMitglied[]; schwelle: number } {
  const alle = [gruender, ...weitere];
  for (const a of alle) schluessel(a);
  if (new Set(alle).size !== alle.length) throw new Error("Mitglied doppelt");
  if (art === "gruender") {
    return { mitglieder: alle.map((adresse, i) => ({ adresse, rechte: i === 0 ? ALLE_RECHTE : KASSEN_RECHT.vorschlagen })), schwelle: 1 };
  }
  if (alle.length < 2) throw new Error("Eine Kasse mit Mehrheit braucht mindestens zwei Mitglieder");
  return { mitglieder: alle.map((adresse) => ({ adresse, rechte: ALLE_RECHTE })), schwelle: mehrheitVon(alle.length) };
}

/**
 * Anweisung `multisig_create_v2`: legt die Kasse an. `createKey` ist ein frischer Schlüssel, der
 * mit unterschreibt (aus ihm folgt die Adresse); `ersteller` zahlt Miete und Gebühr. Ohne
 * Verwalter (V2), ohne Memo; die Miete abgeschlossener Vorschläge geht zurück in den Tresor.
 * `schatzamt` kommt aus den Einstellungen des Programms (`leseProgrammEinstellungen()`).
 */
export function kasseAnlegenAnweisung(p: {
  ersteller: string; createKey: string; schatzamt: string; art: KassenArt; gruender: string; weitere: readonly string[]; zeitschlossSek?: number;
}): Instruction {
  const zeitschloss = p.zeitschlossSek ?? 0;
  if (!(KASSEN_ZEITSCHLOSS_SEK as readonly number[]).includes(zeitschloss)) throw new Error("Zeitschloss nur 0, 1 h oder 24 h");
  const { mitglieder, schwelle } = kassenMitglieder(p.art, p.gruender, p.weitere);
  const kasse = kassenAdresse(p.createKey);
  const daten = verbinde(
    diskriminator("global", "multisig_create_v2"),
    vielleicht(null), // config_authority: keiner (V2)
    u16(schwelle),
    u32(mitglieder.length),
    ...mitglieder.map((m) => verbinde(schluessel(m.adresse), Uint8Array.of(m.rechte))),
    u32(zeitschloss),
    vielleicht(kassenTresor(kasse)), // rent_collector: der Tresor
    Uint8Array.of(0), // memo: keins
  );
  return anweisung(SQUADS_PROGRAMM_ID, [
    [programmEinstellungenAdresse(), AccountRole.READONLY],
    [p.schatzamt, AccountRole.WRITABLE],
    [kasse, AccountRole.WRITABLE],
    [p.createKey, AccountRole.READONLY_SIGNER],
    [p.ersteller, AccountRole.WRITABLE_SIGNER],
    [SYSTEM_PROGRAMM, AccountRole.READONLY],
  ], daten);
}

/**
 * Größe des Kontos einer Kasse in Byte (`Multisig::size()` von Squads v4): Diskriminator 8, Create-Key 32,
 * Verwalter 32, Schwelle 2, Zeitschloss 4, zwei Indizes je 8, Mietempfänger 1 + 32 (immer reserviert), bump 1,
 * Länge der Liste 4, je Mitglied 33 (Adresse und Rechte) – für die Miete beim Anlegen.
 */
export function kassenKontoGroesse(mitglieder: number): number {
  if (!Number.isSafeInteger(mitglieder) || mitglieder < 1) throw new Error("Anzahl der Mitglieder ungültig");
  return 132 + 33 * mitglieder;
}

/**
 * Die Transaktion zum Anlegen (A-12b2b) mit einem frischen Create-Key: Er unterschreibt hier und wird gleich
 * genullt – danach braucht ihn niemand mehr, nur seine Adresse bestimmt die der Kasse. Unterschreiben muss noch
 * der `ersteller`; er zahlt Miete, Gebühr von Squads und Netzgebühr.
 */
export function baueKasseAnlegen(
  p: Omit<Parameters<typeof kasseAnlegenAnweisung>[0], "createKey"> & { lebensdauer: Lebensdauer },
): { tx: SolTransaktion; kasse: string } {
  const { lebensdauer, ...rest } = p;
  const createKey = neuerKontoSchluessel();
  try {
    const ix = kasseAnlegenAnweisung({ ...rest, createKey: createKey.adresse });
    const tx = signiereMit(baueTransaktion({ zahler: p.ersteller, anweisungen: [ix], lebensdauer }), createKey.geheim);
    if (!tx) throw new Error("Create-Key fehlt in der Nachricht");
    return { tx, kasse: kassenAdresse(createKey.adresse) };
  } finally {
    createKey.geheim.fill(0);
  }
}

/** Transaktion Nummer `index` der Kasse: ["multisig", Kasse, "transaction", u64]. */
export function kassenTransaktionAdresse(kasse: string, index: bigint): string {
  return pda([text.encode("multisig"), schluessel(kasse), text.encode("transaction"), u64(index)]);
}

/** Der Vorschlag zur Transaktion `index`: […, "transaction", u64, "proposal"]. */
export function kassenVorschlagAdresse(kasse: string, index: bigint): string {
  return pda([text.encode("multisig"), schluessel(kasse), text.encode("transaction"), u64(index), text.encode("proposal")]);
}

export interface Auszahlung {
  empfaenger: string;
  lamports: bigint;
}

/**
 * Die Nachricht einer Auszahlung im Format von Squads (`TransactionMessage`, Längen als u8/u16): eine
 * Überweisung des System-Programms vom Tresor an den Empfänger. Konten: Tresor (zahlt, unterschreibt
 * per PDA), Empfänger, System-Programm.
 */
export function auszahlungsNachricht(tresor: string, a: Auszahlung): Uint8Array {
  if (a.lamports <= 0n) throw new Error("Betrag muss größer als 0 sein");
  if (a.empfaenger === tresor || a.empfaenger === SYSTEM_PROGRAMM) throw new Error("Empfänger ungültig");
  const ueberweisung = verbinde(u32(2), u64(a.lamports)); // System-Programm: Transfer
  return verbinde(
    Uint8Array.of(1, 1, 1, 3), schluessel(tresor), schluessel(a.empfaenger), schluessel(SYSTEM_PROGRAMM),
    Uint8Array.of(1, 2, 2, 0, 1), u16(ueberweisung.length), ueberweisung,
    Uint8Array.of(0), // keine Adresstabellen
  );
}

/**
 * Auszahlung vorschlagen: die Transaktion `index` (Stand der Kasse + 1) und ihr Vorschlag in einem Zug.
 * `vorschlagender` braucht das Recht „vorschlagen“; die Miete beider Konten zahlt `mietZahler` (sonst er
 * selbst, seit A-12c1 wählbar). Sie kommt beim Abschließen in den Tresor (`rent_collector`), nicht zurück.
 */
export function auszahlungVorschlagenAnweisungen(p: { kasse: string; index: bigint; vorschlagender: string; mietZahler?: string } & Auszahlung): Instruction[] {
  const nachricht = auszahlungsNachricht(kassenTresor(p.kasse), p);
  const transaktion = kassenTransaktionAdresse(p.kasse, p.index);
  const miete = p.mietZahler ?? p.vorschlagender;
  return [
    anweisung(SQUADS_PROGRAMM_ID, [
      [p.kasse, AccountRole.WRITABLE],
      [transaktion, AccountRole.WRITABLE],
      [p.vorschlagender, AccountRole.READONLY_SIGNER],
      [miete, AccountRole.WRITABLE_SIGNER],
      [SYSTEM_PROGRAMM, AccountRole.READONLY],
    ], verbinde(diskriminator("global", "vault_transaction_create"), Uint8Array.of(0, 0), u32(nachricht.length), nachricht, Uint8Array.of(0))),
    anweisung(SQUADS_PROGRAMM_ID, [
      [p.kasse, AccountRole.READONLY],
      [kassenVorschlagAdresse(p.kasse, p.index), AccountRole.WRITABLE],
      [p.vorschlagender, AccountRole.READONLY_SIGNER],
      [miete, AccountRole.WRITABLE_SIGNER],
      [SYSTEM_PROGRAMM, AccountRole.READONLY],
    ], verbinde(diskriminator("global", "proposal_create"), u64(p.index), Uint8Array.of(0))),
  ];
}

/** Abstimmen über den Vorschlag `index` – dafür oder dagegen; braucht das Recht „abstimmen“. */
export function abstimmenAnweisung(p: { kasse: string; index: bigint; mitglied: string; dafuer: boolean }): Instruction {
  return anweisung(SQUADS_PROGRAMM_ID, [
    [p.kasse, AccountRole.READONLY],
    [p.mitglied, AccountRole.WRITABLE_SIGNER],
    [kassenVorschlagAdresse(p.kasse, p.index), AccountRole.WRITABLE],
  ], verbinde(diskriminator("global", p.dafuer ? "proposal_approve" : "proposal_reject"), Uint8Array.of(0)));
}

/**
 * Eine angenommene Auszahlung ausführen; braucht das Recht „ausführen“. `auszahlung` nur aus
 * `leseAuszahlung()` – die Konten folgen der Nachricht auf der Kette (Tresor, Empfänger, System-Programm).
 */
export function ausfuehrenAnweisung(p: { kasse: string; index: bigint; mitglied: string; auszahlung: Auszahlung }): Instruction {
  return anweisung(SQUADS_PROGRAMM_ID, [
    [p.kasse, AccountRole.READONLY],
    [kassenVorschlagAdresse(p.kasse, p.index), AccountRole.WRITABLE],
    [kassenTransaktionAdresse(p.kasse, p.index), AccountRole.READONLY],
    [p.mitglied, AccountRole.READONLY_SIGNER],
    [kassenTresor(p.kasse), AccountRole.WRITABLE],
    [p.auszahlung.empfaenger, AccountRole.WRITABLE],
    [SYSTEM_PROGRAMM, AccountRole.READONLY],
  ], diskriminator("global", "vault_transaction_execute"));
}

/**
 * Transaktion und Vorschlag schließen, wenn er ausgeführt, abgelehnt, abgebrochen oder veraltet ist – die
 * Miete geht an `rent_collector` der Kasse (bei Kassen dieser App der Tresor). Unterschreiben muss niemand
 * außer dem, der die Gebühr zahlt.
 */
export function abschliessenAnweisung(p: { kasse: string; index: bigint; mieteAn: string }): Instruction {
  return anweisung(SQUADS_PROGRAMM_ID, [
    [p.kasse, AccountRole.READONLY],
    [kassenVorschlagAdresse(p.kasse, p.index), AccountRole.WRITABLE],
    [kassenTransaktionAdresse(p.kasse, p.index), AccountRole.WRITABLE],
    [p.mieteAn, AccountRole.WRITABLE],
    [SYSTEM_PROGRAMM, AccountRole.READONLY],
  ], diskriminator("global", "vault_transaction_accounts_close"));
}

/**
 * Größe der beiden Konten einer Auszahlung für die Miete (A-12c1): Transaktion (fest, eine Überweisung, ohne weitere
 * Unterschriften) und Vorschlag (drei Listen von Stimmen, je Platz für alle Mitglieder). Der Validator-Test vergleicht
 * sie mit der echten Länge.
 */
export function auszahlungKontoGroessen(mitglieder: number): { transaktion: number; vorschlag: number } {
  if (!Number.isInteger(mitglieder) || mitglieder < 1 || mitglieder > 65_535) throw new Error("Mitglieder ungültig");
  // Kopf 87 (Diskriminator, Kasse, Ersteller, Index, drei Bytes, leere Liste) + Nachricht in Borsh-Form 134
  return { transaktion: 221, vorschlag: 70 + 96 * mitglieder };
}

/** Liest Konten fester Form; wirft, sobald etwas fehlt. */
class Leser {
  private o = 8;
  private dv: DataView;
  constructor(private daten: Uint8Array, art: string) {
    if (daten.length < 8 || !diskriminator("account", art).every((b, i) => daten[i] === b)) throw new Error(`kein ${art}-Konto`);
    this.dv = new DataView(daten.buffer, daten.byteOffset, daten.byteLength);
  }
  private platz(n: number): number {
    if (this.o + n > this.daten.length) throw new Error("Konto zu kurz");
    const o = this.o;
    this.o += n;
    return o;
  }
  u8 = () => this.daten[this.platz(1)]!;
  u16 = () => this.dv.getUint16(this.platz(2), true);
  u32 = () => this.dv.getUint32(this.platz(4), true);
  u64 = () => this.dv.getBigUint64(this.platz(8), true);
  i64 = () => this.dv.getBigInt64(this.platz(8), true);
  adresse = () => { const o = this.platz(32); return new PublicKey(this.daten.subarray(o, o + 32)).toBase58(); };
  /** Borsh `Vec<T>`: u32 Länge, dann die Einträge – höchstens `max`. */
  liste = <T>(lies: () => T, max = 65_535): T[] => {
    const n = this.u32();
    if (n > max) throw new Error("Liste zu lang");
    return Array.from({ length: n }, lies);
  };
  bytes = (max = 65_535): Uint8Array => {
    const n = this.u32();
    if (n > max) throw new Error("Bytes zu lang");
    const o = this.platz(n);
    return this.daten.slice(o, o + n);
  };
  vielleicht = (): string | null => {
    const da = this.u8();
    if (da > 1) throw new Error("Option ungültig");
    return da ? this.adresse() : null;
  };
}

const LEER = PublicKey.default.toBase58();

/** Das Konto einer Kasse lesen (Daten von `getAccountInfo`); wirft bei falscher Art oder Länge. */
export function leseKassenStand(daten: Uint8Array): KassenStand {
  const l = new Leser(daten, "Multisig");
  const createKey = l.adresse();
  const verwalter = l.adresse();
  const schwelle = l.u16(), zeitschlossSek = l.u32();
  const transaktionsIndex = l.u64(), veraltetBis = l.u64();
  const mieteAn = l.vielleicht();
  const bump = l.u8();
  const anzahl = l.u32();
  if (anzahl > 65_535) throw new Error("Mitgliederliste ungültig");
  const mitglieder: KassenMitglied[] = [];
  for (let i = 0; i < anzahl; i++) mitglieder.push({ adresse: l.adresse(), rechte: l.u8() });
  return { createKey, verwalter: verwalter === LEER ? null : verwalter, schwelle, zeitschlossSek, transaktionsIndex, veraltetBis, mieteAn, bump, mitglieder };
}

/** Die Einstellungen des Programms lesen (Gebühr und Schatzamt). */
export function leseProgrammEinstellungen(daten: Uint8Array): ProgrammEinstellungen {
  const l = new Leser(daten, "ProgramConfig");
  return { autoritaet: l.adresse(), gebuehr: l.u64(), schatzamt: l.adresse() };
}

/**
 * Die Art einer Kasse – nur aus dem Stand auf der Kette. „gruender“: genau ein Mitglied mit allen
 * Rechten, alle übrigen dürfen nur vorschlagen, Schwelle 1. „mehrheit“: alle mit allen Rechten,
 * Schwelle `mehrheitVon()`. Alles andere (auch mit Verwalter) ist keine Kasse dieser App: null.
 */
export function kassenArt(stand: KassenStand): KassenArt | null {
  const m = stand.mitglieder;
  if (stand.verwalter !== null || m.length === 0) return null;
  const voll = m.filter((x) => x.rechte === ALLE_RECHTE).length;
  if (stand.schwelle === 1 && voll === 1 && m.every((x) => x.rechte === ALLE_RECHTE || x.rechte === KASSEN_RECHT.vorschlagen)) return "gruender";
  if (m.length >= 2 && voll === m.length && stand.schwelle === mehrheitVon(m.length)) return "mehrheit";
  return null;
}

/** Eine Kasse von der Kette; null, solange es sie nicht gibt. Das Konto muss Squads gehören. */
export async function leseKasse(rpc: SolRpc, kasse: string): Promise<KassenStand | null> {
  const k = await leseKonto(rpc, kasse);
  if (!k) return null;
  if (k.eigentuemer !== SQUADS_PROGRAMM_ID) throw new Error("Konto gehört nicht Squads");
  return leseKassenStand(k.daten);
}

/** Die Einstellungen des Programms von der Kette; null, wenn es sie (etwa im Validator) nicht gibt. */
export async function leseProgrammEinstellungenVonKette(rpc: SolRpc): Promise<ProgrammEinstellungen | null> {
  const k = await leseKonto(rpc, programmEinstellungenAdresse());
  if (!k) return null;
  if (k.eigentuemer !== SQUADS_PROGRAMM_ID) throw new Error("Konto gehört nicht Squads");
  return leseProgrammEinstellungen(k.daten);
}

export type VorschlagsStatus = "entwurf" | "aktiv" | "abgelehnt" | "angenommen" | "wird-ausgefuehrt" | "ausgefuehrt" | "abgebrochen";
const STATUS: readonly VorschlagsStatus[] = ["entwurf", "aktiv", "abgelehnt", "angenommen", "wird-ausgefuehrt", "ausgefuehrt", "abgebrochen"];

export interface KassenVorschlag {
  kasse: string;
  index: bigint;
  status: VorschlagsStatus;
  /** Zeitpunkt des Status (Unix-Sekunden); „wird-ausgefuehrt“ hat keinen. */
  seit: bigint | null;
  dafuer: string[];
  dagegen: string[];
  abgebrochen: string[];
}

/** Das Konto eines Vorschlags lesen (`Proposal`); wirft bei falscher Art, Länge oder unbekanntem Status. */
export function leseVorschlag(daten: Uint8Array): KassenVorschlag {
  const l = new Leser(daten, "Proposal");
  const kasse = l.adresse(), index = l.u64();
  const art = l.u8();
  const status = STATUS[art];
  if (!status) throw new Error("Status unbekannt");
  const seit = status === "wird-ausgefuehrt" ? null : l.i64();
  l.u8(); // bump
  return { kasse, index, status, seit, dafuer: l.liste(l.adresse), dagegen: l.liste(l.adresse), abgebrochen: l.liste(l.adresse) };
}

export interface KassenTransaktion {
  kasse: string;
  ersteller: string;
  index: bigint;
  /** Nur wenn die Nachricht genau eine Auszahlung aus Tresor 0 ist (`auszahlungsNachricht()`); sonst null. */
  auszahlung: Auszahlung | null;
}

/**
 * Das Konto einer Transaktion der Kasse lesen (`VaultTransaction`). Die Nachricht steht dort im Format von
 * Borsh (Längen als u32) – anders als beim Anlegen. Eine Auszahlung ist sie nur in genau der Form, die diese
 * App baut: Tresor 0, keine weiteren Unterschriften, eine Überweisung an einen Empfänger, keine Tabellen.
 */
export function leseAuszahlung(daten: Uint8Array): KassenTransaktion {
  const l = new Leser(daten, "VaultTransaction");
  const kasse = l.adresse(), ersteller = l.adresse(), index = l.u64();
  l.u8(); // bump
  const tresorIndex = l.u8();
  l.u8(); // Bump des Tresors
  const weitereUnterschriften = l.bytes(255).length;
  const kopf = [l.u8(), l.u8(), l.u8()];
  const konten = l.liste(l.adresse, 255);
  const anweisungen = l.liste(() => ({ programm: l.u8(), konten: Array.from(l.bytes(255)), daten: l.bytes() }), 255);
  const tabellen = l.liste(() => [l.adresse(), l.bytes(255), l.bytes(255)], 255).length;
  const ix = anweisungen[0];
  const passt = tresorIndex === 0 && weitereUnterschriften === 0 && tabellen === 0 && kopf.join() === "1,1,1"
    && konten.length === 3 && konten[0] === kassenTresor(kasse) && konten[2] === SYSTEM_PROGRAMM && konten[1] !== konten[0]
    && anweisungen.length === 1 && ix !== undefined && ix.programm === 2 && ix.konten.join() === "0,1" && ix.daten.length === 12
    && new DataView(ix.daten.buffer, ix.daten.byteOffset).getUint32(0, true) === 2;
  const lamports = passt ? new DataView(ix!.daten.buffer, ix!.daten.byteOffset).getBigUint64(4, true) : 0n;
  return { kasse, ersteller, index, auszahlung: passt && lamports > 0n ? { empfaenger: konten[1]!, lamports } : null };
}

/** Vorschlag `index` von der Kette; null, solange es ihn nicht (mehr) gibt. Nur Konten von Squads, nur zu dieser Kasse. */
export async function leseVorschlagVonKette(rpc: SolRpc, kasse: string, index: bigint): Promise<KassenVorschlag | null> {
  const k = await leseKonto(rpc, kassenVorschlagAdresse(kasse, index));
  if (!k) return null;
  if (k.eigentuemer !== SQUADS_PROGRAMM_ID) throw new Error("Konto gehört nicht Squads");
  const v = leseVorschlag(k.daten);
  if (v.kasse !== kasse || v.index !== index) throw new Error("Vorschlag gehört nicht zu dieser Kasse");
  return v;
}

/** Transaktion `index` von der Kette; null, solange es sie nicht (mehr) gibt. Nur Konten von Squads, nur zu dieser Kasse. */
export async function leseAuszahlungVonKette(rpc: SolRpc, kasse: string, index: bigint): Promise<KassenTransaktion | null> {
  const k = await leseKonto(rpc, kassenTransaktionAdresse(kasse, index));
  if (!k) return null;
  if (k.eigentuemer !== SQUADS_PROGRAMM_ID) throw new Error("Konto gehört nicht Squads");
  const t = leseAuszahlung(k.daten);
  if (t.kasse !== kasse || t.index !== index) throw new Error("Transaktion gehört nicht zu dieser Kasse");
  return t;
}

/** Was man mit einem Vorschlag tun kann (A-12c1). */
export type KassenSchritt = "dafuer" | "dagegen" | "ausfuehren" | "abschliessen";

/** Ab wann eine angenommene Auszahlung ausgeführt werden darf (Annahme + Zeitschloss); null, solange sie nicht angenommen ist. */
export function ausfuehrbarAb(stand: KassenStand, v: KassenVorschlag): bigint | null {
  return v.status === "angenommen" && v.seit !== null ? v.seit + BigInt(stand.zeitschlossSek) : null;
}

/**
 * Welche Schritte das Programm für Vorschlag `v` jetzt annimmt – nach den Regeln von Squads v4, im Validator gegen beide
 * Programme geprüft. Abstimmen nur aktiv, nicht veraltet, mit dem Recht und nicht zum zweiten Mal gleich; ausführen nur
 * angenommen, nach dem Zeitschloss, mit dem Recht; abschließen nur ausgeführt, abgelehnt, abgebrochen oder (als Entwurf
 * oder aktiv) veraltet, und nur mit `rent_collector`. Abstimmen und ausführen nur bei einer Auszahlung dieser App
 * (`auszahlung` aus `leseAuszahlung()`, V6) – sonst wüsste niemand, wofür er stimmt.
 */
export function vorschlagsSchritte(p: {
  stand: KassenStand; vorschlag: KassenVorschlag; auszahlung: Auszahlung | null; mitglied?: string; jetztSek: number;
}): KassenSchritt[] {
  const { stand, vorschlag: v } = p;
  const rechte = stand.mitglieder.find((m) => m.adresse === p.mitglied)?.rechte ?? 0;
  const veraltet = v.index <= stand.veraltetBis;
  const schritte: KassenSchritt[] = [];
  if (p.auszahlung && p.mitglied && v.status === "aktiv" && !veraltet && rechte & KASSEN_RECHT.abstimmen) {
    if (!v.dafuer.includes(p.mitglied)) schritte.push("dafuer");
    if (!v.dagegen.includes(p.mitglied)) schritte.push("dagegen");
  }
  const ab = ausfuehrbarAb(stand, v);
  if (p.auszahlung && ab !== null && ab <= BigInt(Math.floor(p.jetztSek)) && rechte & KASSEN_RECHT.ausfuehren) schritte.push("ausfuehren");
  const fertig = v.status === "ausgefuehrt" || v.status === "abgelehnt" || v.status === "abgebrochen";
  if (stand.mieteAn && (fertig || (veraltet && (v.status === "entwurf" || v.status === "aktiv")))) schritte.push("abschliessen");
  return schritte;
}

export interface KassenVorgang {
  index: bigint;
  vorschlag: KassenVorschlag;
  /** null: keine Auszahlung dieser App (oder die Transaktion fehlt) – nur zeigen, nie darüber abstimmen. */
  auszahlung: Auszahlung | null;
}

/** Die jüngsten Vorschläge einer Kasse (höchstens `max`, neueste zuerst); abgeschlossene stehen nicht mehr auf der Kette. */
export async function leseVorschlaege(rpc: SolRpc, kasse: string, stand: KassenStand, max = 10): Promise<KassenVorgang[]> {
  const indizes: bigint[] = [];
  for (let i = stand.transaktionsIndex; i >= 1n && indizes.length < max; i--) indizes.push(i);
  const gelesen = await Promise.all(indizes.map(async (index) => {
    const [vorschlag, t] = await Promise.all([leseVorschlagVonKette(rpc, kasse, index), leseAuszahlungVonKette(rpc, kasse, index)]);
    return vorschlag ? { index, vorschlag, auszahlung: t?.auszahlung ?? null } : null;
  }));
  return gelesen.filter((g): g is KassenVorgang => g !== null);
}
