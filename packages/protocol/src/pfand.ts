/**
 * Cashu-Pfand (RM2a, `docs/RM2-ENTWURF.md` V1–V3, entschieden 14.10.2026): der Zahlkanal für
 * Lightning. Die App sperrt kleine Cashu-Token auf den Pfand-Schlüssel des Providers (NUT-11,
 * mit Frist und Rückweg) und übergibt je Anfrage die nächsten – nur im versiegelten Kern
 * (`pfandTags()`). Der Provider prüft sie ohne Mint (`pruefePfand()`):
 * - die Signatur der Mint über den Beweis aus NUT-12 (DLEQ) gegen die gemerkten Schlüssel der Mint;
 * - die Sperre genau auf seinen Schlüssel, ohne weitere Schlüssel;
 * - eine Frist, die weit genug weg ist, und einen Rückweg für die App;
 * - die Mint steht in seiner Liste, und kein Token ist doppelt.
 * Vor der Frist kann nur er die Token ausgeben – der Kunde also nicht doppelt.
 *
 * Im Angebot (`cashuAngebotTags()`): die Mints, die er annimmt, und sein Pfand-Schlüssel mit
 * Fassung. Eingelöst wird im Knoten (RM2b), gesperrt in der App (RM2c).
 * Rechnungen nach NUT-00 (hash_to_curve) und NUT-12 (hash_e), geprüft gegen deren Testvektoren.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ProtokollFehler } from "./fehler.js";

type Punkt = InstanceType<typeof secp256k1.Point>;
const P = secp256k1.Point;
const N = P.CURVE().n;

/** Fassung des Pfands im Angebot – eine andere Form (etwa der Spilman-Kanal, V8) bekommt eine neue. */
export const PFAND_FASSUNG = 1;

export const PFAND_GRENZEN = {
  /** Token je Anfrage. */
  token: 64,
  /** Länge eines Geheimnisses (NUT-10 als JSON). */
  geheimnis: 1024,
  /** Mints im Angebot. */
  mints: 5,
  /** So lange muss die Frist mindestens noch weg sein: Einlösen bis zehn Minuten davor, dazu Spielraum. */
  restSek: 15 * 60,
} as const;

/** Ein Token nach NUT-00, mit Beweis nach NUT-12 (`r` für den Empfänger). */
export interface PfandToken {
  id: string;
  amount: number;
  secret: string;
  C: string;
  dleq: { e: string; s: string; r: string };
}

export interface Pfand {
  mint: string;
  token: PfandToken[];
}

export type PfandFall =
  | "pfand-form" | "pfand-mint" | "pfand-mint-schluessel" | "pfand-dleq" | "pfand-sperre" | "pfand-frist"
  | "pfand-rueckweg" | "pfand-doppelt";

const HEX64 = /^[0-9a-f]{64}$/;
const PUNKT = /^0[23][0-9a-f]{64}$/;
const KEYSET = /^[0-9a-f]{16}$|^[0-9a-f]{66}$/;
const DOMAIN = new TextEncoder().encode("Secp256k1_HashToCurve_Cashu_");

/** NUT-00: eine Nachricht auf einen Punkt der Kurve abbilden. */
export function hashZuKurve(nachricht: Uint8Array): Punkt {
  const h = sha256(new Uint8Array([...DOMAIN, ...nachricht]));
  for (let zaehler = 0; zaehler < 2 ** 16; zaehler++) {
    const z = new Uint8Array(4);
    new DataView(z.buffer).setUint32(0, zaehler, true);
    try {
      return P.fromHex("02" + bytesToHex(sha256(new Uint8Array([...h, ...z]))));
    } catch { /* kein Punkt – weiter */ }
  }
  throw new ProtokollFehler("pfand-form", "Pfand hat nicht die Form");
}

/** NUT-12: e = SHA-256 über die Punkte, unkomprimiert als Hex hintereinander. */
export function hashE(punkte: readonly Punkt[]): Uint8Array {
  return sha256(new TextEncoder().encode(punkte.map((p) => p.toHex(false)).join("")));
}

const skalar = (h: string): bigint => {
  const n = BigInt("0x" + h);
  if (n <= 0n || n >= N) throw new ProtokollFehler("pfand-form", "Pfand hat nicht die Form");
  return n;
};

/**
 * NUT-12, Prüfung des Empfängers: die Mint mit dem Schlüssel `A` hat das Token signiert.
 * B' = Y + r·G, C' = C + r·A, R1 = s·G − e·A, R2 = s·B' − e·C', e = hash_e(R1, R2, A, C').
 */
export function pruefeDleq(t: Pick<PfandToken, "secret" | "C" | "dleq">, mintSchluessel: string): boolean {
  try {
    const A = P.fromHex(mintSchluessel);
    const C = P.fromHex(t.C);
    const [e, s, r] = [skalar(t.dleq.e), skalar(t.dleq.s), skalar(t.dleq.r)];
    const Y = hashZuKurve(new TextEncoder().encode(t.secret));
    const B = Y.add(P.BASE.multiply(r));
    const C2 = C.add(A.multiply(r));
    const R1 = P.BASE.multiply(s).subtract(A.multiply(e));
    const R2 = B.multiply(s).subtract(C2.multiply(e));
    return bytesToHex(hashE([R1, R2, A, C2])) === t.dleq.e;
  } catch {
    return false;
  }
}

/** Adresse einer Mint im Angebot und im Pfand: https ohne Zugangsdaten, `.onion` auch über http. */
export function istMintAdresse(url: string): boolean {
  try {
    const u = new URL(url);
    const onion = u.hostname.endsWith(".onion");
    return (u.protocol === "https:" || (onion && u.protocol === "http:")) && !u.username && !u.password && !u.search && !u.hash
      && u.hostname.includes(".") && url === u.origin + u.pathname.replace(/\/+$/, "");
  } catch {
    return false;
  }
}

/** Transport im versiegelten Kern der Anfrage: `["pfand", Mint, Token als JSON]`. Nie offen – sie sind Geld. */
export function pfandTags(p: Pfand): string[][] {
  return [["pfand", p.mint, JSON.stringify(p.token.map((t) => ({ id: t.id, amount: t.amount, secret: t.secret, C: t.C, dleq: t.dleq })))]];
}

/** Pfand aus den Tags einer Anfrage; undefined ohne Pfand, wirft (`pfand-form`) bei kaputter Form. */
export function lesePfandTags(tags: readonly (readonly string[])[]): Pfand | undefined {
  const roh = tags.filter((t) => t[0] === "pfand");
  if (roh.length === 0) return undefined;
  const kaputt = () => new ProtokollFehler("pfand-form", "Pfand hat nicht die Form");
  if (roh.length > 1 || !istMintAdresse(roh[0]![1] ?? "")) throw kaputt();
  let liste: unknown;
  try {
    liste = JSON.parse(roh[0]![2] ?? "");
  } catch {
    throw kaputt();
  }
  if (!Array.isArray(liste) || liste.length === 0 || liste.length > PFAND_GRENZEN.token) throw kaputt();
  const token = liste.map((x): PfandToken => {
    const t = (typeof x === "object" && x !== null ? x : {}) as Record<string, unknown>;
    const d = (typeof t["dleq"] === "object" && t["dleq"] !== null ? t["dleq"] : {}) as Record<string, unknown>;
    const ok = typeof t["id"] === "string" && KEYSET.test(t["id"]) && Number.isSafeInteger(t["amount"]) && (t["amount"] as number) > 0
      && typeof t["secret"] === "string" && t["secret"].length <= PFAND_GRENZEN.geheimnis && typeof t["C"] === "string" && PUNKT.test(t["C"])
      && [d["e"], d["s"], d["r"]].every((v) => typeof v === "string" && HEX64.test(v));
    if (!ok) throw kaputt();
    return { id: t["id"] as string, amount: t["amount"] as number, secret: t["secret"] as string, C: t["C"] as string,
      dleq: { e: d["e"] as string, s: d["s"] as string, r: d["r"] as string } };
  });
  return { mint: roh[0]![1]!, token };
}

/** Die Sperre eines Geheimnisses (NUT-10/NUT-11) – nur P2PK, sonst undefined. */
export function lesePfandSperre(secret: string): { schluessel: string; tags: string[][] } | undefined {
  try {
    const s = JSON.parse(secret) as unknown;
    if (!Array.isArray(s) || s.length !== 2 || s[0] !== "P2PK") return undefined;
    const d = s[1] as { nonce?: unknown; data?: unknown; tags?: unknown };
    if (typeof d?.nonce !== "string" || typeof d.data !== "string" || !PUNKT.test(d.data)) return undefined;
    const tags = d.tags ?? [];
    if (!Array.isArray(tags) || !tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === "string"))) return undefined;
    return { schluessel: d.data, tags: tags as string[][] };
  } catch {
    return undefined;
  }
}

export interface PfandPruefung {
  /** Pfand-Schlüssel des Providers (komprimiert, hex). */
  schluessel: string;
  /** Mints, die er annimmt (wie im Angebot). */
  mints: readonly string[];
  /** Gemerkter Schlüssel der Mint für Keyset und Betrag – nur Keysets in sat; undefined, wenn unbekannt. */
  mintSchluessel: (mint: string, keyset: string, betrag: number) => string | undefined;
  /** Hat er dieses Token schon einmal angenommen? (Datei, nie nur Speicher – RM2b.) */
  gesehen: (secret: string) => boolean;
  /** Unix-Sekunden. */
  jetzt: number;
}

/**
 * Pfand prüfen, ohne die Mint zu fragen. Jeder Teil muss gelten, sonst gilt keiner. Zurück der
 * Betrag (sat) und die früheste Frist – bis zehn Minuten davor löst der Provider ein.
 */
export function pruefePfand(p: Pfand, o: PfandPruefung): { ok: true; betrag: number; frist: number } | { ok: false; fall: PfandFall } {
  if (!o.mints.includes(p.mint)) return { ok: false, fall: "pfand-mint" };
  const geheimnisse = new Set<string>();
  let betrag = 0;
  let frist = Infinity;
  for (const t of p.token) {
    if (geheimnisse.has(t.secret) || o.gesehen(t.secret)) return { ok: false, fall: "pfand-doppelt" };
    geheimnisse.add(t.secret);
    const A = o.mintSchluessel(p.mint, t.id, t.amount);
    if (!A || !PUNKT.test(A)) return { ok: false, fall: "pfand-mint-schluessel" };
    if (!pruefeDleq(t, A)) return { ok: false, fall: "pfand-dleq" };
    const sperre = lesePfandSperre(t.secret);
    // Nur genau sein Schlüssel: weitere (`pubkeys`) oder mehrere Unterschriften hielten ihn nicht allein
    const fremd = sperre?.tags.some(([k, v]) => k === "pubkeys" || (k === "n_sigs" && v !== "1") || (k === "sigflag" && v !== "SIG_INPUTS"));
    if (!sperre || sperre.schluessel !== o.schluessel || fremd) return { ok: false, fall: "pfand-sperre" };
    const lt = sperre.tags.find(([k]) => k === "locktime")?.[1];
    if (!lt || !/^\d{1,12}$/.test(lt) || Number(lt) < o.jetzt + PFAND_GRENZEN.restSek) return { ok: false, fall: "pfand-frist" };
    const rueck = sperre.tags.find(([k]) => k === "refund");
    if (!rueck || rueck.length < 2 || !rueck.slice(1).every((k) => PUNKT.test(k))) return { ok: false, fall: "pfand-rueckweg" };
    betrag += t.amount;
    frist = Math.min(frist, Number(lt));
  }
  return { ok: true, betrag, frist };
}

export interface CashuAngebot {
  mints: string[];
  /** Pfand-Schlüssel (komprimiert, hex) – nicht der Schlüssel des Knotens: Er steht offen im Angebot und bei der Mint. */
  schluessel: string;
  fassung: number;
}

/** Im Angebot: `["cashu_mint", url]` je Mint und `["cashu_pfand", Schlüssel, Fassung]`. */
export function cashuAngebotTags(a: CashuAngebot): string[][] {
  const mints = [...new Set(a.mints)].filter(istMintAdresse).slice(0, PFAND_GRENZEN.mints);
  if (mints.length === 0 || !PUNKT.test(a.schluessel)) return [];
  return [...mints.map((m) => ["cashu_mint", m]), ["cashu_pfand", a.schluessel, String(a.fassung)]];
}

/** Fremde Angabe: nur gültige Mints, ein Schlüssel und eine kleine Fassung – sonst kein Pfand. */
export function leseCashuAngebot(tags: readonly (readonly string[])[]): CashuAngebot | undefined {
  const p = tags.find((t) => t[0] === "cashu_pfand");
  const mints = [...new Set(tags.filter((t) => t[0] === "cashu_mint").map((t) => t[1] ?? ""))].filter(istMintAdresse).slice(0, PFAND_GRENZEN.mints);
  if (!p || !PUNKT.test(p[1] ?? "") || !/^[1-9]\d{0,2}$/.test(p[2] ?? "") || mints.length === 0) return undefined;
  return { mints, schluessel: p[1]!, fassung: Number(p[2]) };
}
