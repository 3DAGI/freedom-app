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
 * Läuft auch im Browser: Zahlen über `DataView`, Hash über `@noble/hashes`; die PDA rechnet
 * web3.js synchron wie beim Zahlkanal (bis A-21f).
 */
import { AccountRole, type Instruction } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { anweisung, SYSTEM_PROGRAMM } from "./kit-bruecke.js";
import { leseKonto, type SolRpc } from "./kit-rpc.js";

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
  adresse = () => { const o = this.platz(32); return new PublicKey(this.daten.subarray(o, o + 32)).toBase58(); };
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
