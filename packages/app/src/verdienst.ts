/**
 * Verdienen in SOL (Schritt 4.5b): die Zahlkanäle an die Adresse eines
 * Knotens, von der Kette gelesen.
 *
 * Entscheidung 4.5 A: eine Provider-Adresse je Knoten. Die Kanäle kennt die
 * Kette ohnehin öffentlich – die App liest nur, was dort steht, und rechnet
 * mit denselben Funktionen wie das Programm (`teileKanalZahlung()`), welcher
 * Teil des Eingelösten beim Provider blieb. Was der Knoten angenommen, aber
 * noch nicht eingelöst hat, weiß nur der Knoten.
 *
 * Grenze: Nach dem Ablauf holt der Kunde den Rest zurück und schließt den
 * Kanal – dann steht er nicht mehr auf der Kette und zählt hier nicht mehr.
 */
import type { Connection } from "@solana/web3.js";
import { KANAL_KONTO_BYTES, KANAL_PROGRAMM_ID, leseKanal, teileKanalZahlung, type KanalStand } from "@freedomstack/protocol";
import { t } from "./i18n.js";
import { decodeNpub } from "./identity.js";

const HEX64 = /^[0-9a-f]{64}$/;

/** Eingabe des eigenen Knotens: npub oder 64 Hex-Zeichen → Hex; leer → undefined (die eigene Identität). */
export function knotenAusEingabe(eingabe: string): string | undefined {
  const x = eingabe.trim();
  if (!x) return undefined;
  let hex = "";
  try {
    hex = x.startsWith("npub1") ? decodeNpub(x) : x.toLowerCase();
  } catch { /* unten abgewiesen */ }
  if (!HEX64.test(hex)) throw new Error(t("earn.knotenUngueltig"));
  return hex;
}

/** Wo `provider` im Konto steht: Diskriminator (8) + customer (32), `docs/ZAHLKANAL.md`. */
export const PROVIDER_OFFSET = 8 + 32;

export interface KanalAmKnoten { adresse: string; stand: KanalStand }

/** Alle Kanäle an diese Provider-Adresse. Der RPC filtert; geprüft wird trotzdem jedes Konto. */
export async function kanaeleDesKnotens(
  conn: Pick<Connection, "getProgramAccounts">, providerSol: string,
): Promise<KanalAmKnoten[]> {
  const { PublicKey } = await import("@solana/web3.js");
  const konten = await conn.getProgramAccounts(new PublicKey(KANAL_PROGRAMM_ID), {
    commitment: "confirmed",
    filters: [{ dataSize: KANAL_KONTO_BYTES }, { memcmp: { offset: PROVIDER_OFFSET, bytes: new PublicKey(providerSol).toBase58() } }],
  });
  const aus: KanalAmKnoten[] = [];
  for (const k of konten) {
    let stand: KanalStand;
    try {
      stand = leseKanal(k.account.data);
    } catch {
      continue; // kein Kanal-Konto
    }
    if (stand.provider === providerSol) aus.push({ adresse: k.pubkey.toBase58(), stand });
  }
  return aus;
}

export interface KanalZeile {
  adresse: string;
  kunde: string;
  eingezahlt: bigint;
  /** Eingelöst insgesamt (samt Anteilen nach A+). */
  eingeloest: bigint;
  /** Davon beim Provider – mindestens: das Programm rundet je Einlösung zu seinen Gunsten. */
  deins: bigint;
  /** Noch nicht eingelöst. Vor dem Ablauf kann der Knoten davon einlösen, was er an Gutschriften hält. */
  offen: bigint;
  ablauf: number;
  laeuft: boolean;
}

export interface VerdienstUebersicht {
  kanaele: KanalZeile[];
  /** Summe `deins` über alle Kanäle auf der Kette. */
  deins: bigint;
  laufend: number;
  /** Die früheste Frist eines laufenden Kanals – bis dahin muss der Knoten eingelöst haben. */
  naechsteFrist?: number;
}

export function fasseKanaeleZusammen(kanaele: readonly KanalAmKnoten[], jetzt: number): VerdienstUebersicht {
  const zeilen = kanaele.map(({ adresse, stand }): KanalZeile => {
    const ablauf = Number(stand.ablauf);
    return {
      adresse, kunde: stand.kunde, eingezahlt: stand.eingezahlt, eingeloest: stand.ausgezahlt,
      deins: teileKanalZahlung(stand.ausgezahlt, stand.empfaenger).providerLamports,
      offen: stand.eingezahlt > stand.ausgezahlt ? stand.eingezahlt - stand.ausgezahlt : 0n,
      ablauf, laeuft: ablauf > jetzt,
    };
  }).sort((a, b) => Number(b.laeuft) - Number(a.laeuft) || a.ablauf - b.ablauf);
  const laufende = zeilen.filter((z) => z.laeuft);
  return {
    kanaele: zeilen,
    deins: zeilen.reduce((s, z) => s + z.deins, 0n),
    laufend: laufende.length,
    naechsteFrist: laufende[0]?.ablauf,
  };
}
