/**
 * Quittungen und Ruf (Schritt 5.5).
 *
 * Leistung zählt nur, wo bezahlt wurde – belegt nach 4.8. Eine Quittung legt
 * die App selbst an, wenn sie einen Provider bezahlt hat; sie liegt nur im
 * Tresor und geht nie offen auf ein Relay:
 * - **Lightning:** die bezahlte Rechnung und das Preimage. „Belegt“ nur, wenn
 *   die Rechnung vom angekündigten Knoten des Providers signiert ist; bei einer
 *   Lightning-Adresse (LNURL, womöglich ein Verwahrer) „angekündigt“.
 * - **Zahlkanal:** der Preis aus der Antwort und die Gutschrift, die ihn
 *   deckte. „Belegt“ erst, wenn die Kette zeigt, dass der Kanal mindestens bis
 *   zu dieser Gutschrift ausgezahlt hat.
 * Ohne Nachweis gibt es keine Quittung.
 *
 * Vertrauen ist subjektiv (Karte 5.5): Die Wurzel ist der Nutzer. Rang und
 * Stufe kommen nur aus eigenen Quittungen und aus Zusammenfassungen, die
 * Kontakte versiegelt schicken (Kind 38075, je Provider Zahl, Umfang und
 * Reklamationen). Selbstauskünfte der Provider (38010) zählen nicht mehr.
 * Eine öffentliche Rangliste gibt es nicht.
 */
import { type NostrEvent, type UnsignedEvent } from "./event.js";
import { leseBolt11, preimageMatches } from "./bolt11.js";
import { giftUnwrapMitSigner, giftWrapMitSigner } from "./gift-wrap.js";
import type { Signer } from "./signer.js";

/** Versiegelte Zusammenfassung an einen Kontakt (Kern, Autor = die eigene Identität). */
export const KIND_RUF_ZUSAMMENFASSUNG = 38075;
/** Höchstens so viele Provider stehen in einer Zusammenfassung. */
export const RUF_MAX_PROVIDER = 50;
/** So viele Aufträge zählt ein Kontakt je Provider höchstens – eine Stimme, kein Stimmenkauf. */
export const RUF_KONTAKT_DECKEL = 100;

const HEX64 = /^[0-9a-f]{64}$/;
const HEX66 = /^0[23][0-9a-f]{64}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ZAHL = /^\d{1,15}$/;

export type QuittungsStand = "belegt" | "angekuendigt";

interface QuittungBasis {
  /** Nostr-Schlüssel des Providers (aus seinem Angebot). */
  provider: string;
  /** So viele Antworten deckt die Zahlung. */
  auftraege: number;
  /** Unix-Sekunden. */
  zeit: number;
  stand: QuittungsStand;
}

export interface LightningQuittung extends QuittungBasis {
  art: "lightning";
  betragMsat: number;
  rechnung: string;
  preimage: string;
}

export interface KanalQuittung extends QuittungBasis {
  art: "kanal";
  preisLamports: number;
  kanal: string;
  /** Gutschrift (kumuliert, Lamports), die den Preis deckte. */
  gutschrift: string;
  anfrage: string;
}

export type Quittung = LightningQuittung | KanalQuittung;

/**
 * Quittung für eine Lightning-Zahlung – null ohne gültigen Nachweis (Rechnung
 * unlesbar, Preimage passt nicht, kein Betrag). `providerKnoten`: der Knoten,
 * den der Provider angekündigt hat; ohne ihn bleibt es „angekündigt“.
 */
export function lightningQuittung(p: {
  provider: string; rechnung: string; preimage: string; auftraege: number; zeit: number; providerKnoten?: string;
}): LightningQuittung | null {
  if (!HEX64.test(p.provider) || !/^[0-9a-f]{64}$/i.test(p.preimage) || !(p.auftraege >= 1) || !Number.isSafeInteger(p.auftraege)) return null;
  let b: ReturnType<typeof leseBolt11>;
  try {
    b = leseBolt11(p.rechnung);
  } catch {
    return null;
  }
  if (!b.betragMsat || b.betragMsat <= 0 || !preimageMatches(p.preimage, b.zahlungsHash)) return null;
  const knoten = p.providerKnoten && HEX66.test(p.providerKnoten) ? p.providerKnoten : undefined;
  return {
    art: "lightning", provider: p.provider, auftraege: p.auftraege, zeit: p.zeit, betragMsat: b.betragMsat,
    rechnung: p.rechnung.trim(), preimage: p.preimage.toLowerCase(),
    stand: knoten && b.empfaengerKnoten === knoten ? "belegt" : "angekuendigt",
  };
}

/** Quittung für eine Antwort über den Zahlkanal – „angekündigt“, bis die Kette die Auszahlung zeigt. */
export function kanalQuittung(p: {
  provider: string; kanal: string; gutschrift: bigint; preisLamports: number; anfrage: string; zeit: number;
}): KanalQuittung | null {
  if (!HEX64.test(p.provider) || !BASE58.test(p.kanal) || !HEX64.test(p.anfrage)) return null;
  if (p.gutschrift <= 0n || !Number.isSafeInteger(p.preisLamports) || p.preisLamports <= 0) return null;
  return {
    art: "kanal", provider: p.provider, auftraege: 1, zeit: p.zeit, stand: "angekuendigt",
    preisLamports: p.preisLamports, kanal: p.kanal, gutschrift: p.gutschrift.toString(), anfrage: p.anfrage,
  };
}

/** Stand auf der Kette (`KanalStand.ausgezahlt`): Hat der Kanal bis zu dieser Gutschrift ausgezahlt? Dann belegt. */
export function kanalBelegt(q: KanalQuittung, ausgezahlt: bigint): KanalQuittung {
  return ausgezahlt >= BigInt(q.gutschrift) ? { ...q, stand: "belegt" } : q;
}

/** Gespeicherte Quittung lesen (aus dem Tresor) – Unbrauchbares gilt als keine. */
export function leseQuittung(x: unknown): Quittung | null {
  const q = x as Partial<Quittung> | null;
  if (!q || typeof q !== "object" || !HEX64.test(q.provider ?? "") || (q.stand !== "belegt" && q.stand !== "angekuendigt")) return null;
  if (!Number.isSafeInteger(q.auftraege) || q.auftraege! < 1 || !Number.isSafeInteger(q.zeit)) return null;
  if (q.art === "lightning") {
    const l = lightningQuittung({ provider: q.provider!, rechnung: String(q.rechnung ?? ""), preimage: String(q.preimage ?? ""), auftraege: q.auftraege!, zeit: q.zeit! });
    // Den Stand „belegt“ hat die App beim Anlegen geprüft; neu lesen kann ihn nur senken, nie heben
    return l ? { ...l, stand: q.stand === "belegt" ? "belegt" : l.stand } : null;
  }
  if (q.art === "kanal" && typeof q.gutschrift === "string" && ZAHL.test(q.gutschrift)) {
    const k = kanalQuittung({ provider: q.provider!, kanal: String(q.kanal ?? ""), gutschrift: BigInt(q.gutschrift), preisLamports: Number(q.preisLamports), anfrage: String(q.anfrage ?? ""), zeit: q.zeit! });
    return k ? { ...k, stand: q.stand } : null;
  }
  return null;
}

// ------------------------------------------------------ Zusammenfassung

/** Eine Zeile je Provider – was man einem Kontakt über ihn sagt. */
export interface RufZeile {
  provider: string;
  /** Bezahlte Antworten (aus Quittungen). */
  auftraege: number;
  /** Davon mit Stand „belegt“. */
  belegt: number;
  umfangMsat: number;
  umfangLamports: number;
  reklamationen: number;
}

/** Eigene Quittungen je Provider zusammenfassen; `reklamationen` je Provider aus den eigenen Reklamationen. */
export function fasseZusammen(quittungen: readonly Quittung[], reklamationen: ReadonlyMap<string, number> = new Map()): RufZeile[] {
  const je = new Map<string, RufZeile>();
  const zeile = (pk: string) => {
    let z = je.get(pk);
    if (!z) je.set(pk, (z = { provider: pk, auftraege: 0, belegt: 0, umfangMsat: 0, umfangLamports: 0, reklamationen: 0 }));
    return z;
  };
  for (const q of quittungen) {
    const z = zeile(q.provider);
    z.auftraege += q.auftraege;
    if (q.stand === "belegt") z.belegt += q.auftraege;
    if (q.art === "lightning") z.umfangMsat += q.betragMsat;
    else z.umfangLamports += q.preisLamports;
  }
  for (const [pk, n] of reklamationen) if (HEX64.test(pk) && n > 0 && je.has(pk)) zeile(pk).reklamationen = n;
  return [...je.values()].sort((a, b) => b.auftraege - a.auftraege).slice(0, RUF_MAX_PROVIDER);
}

/**
 * Zusammenfassung versiegelt an Kontakte: je Kontakt ein Umschlag, der Kern
 * trägt die eigene Identität (Kontakte kennen einen ohnehin) und je Provider
 * eine Zeile `["provider", pk, aufträge, belegt, umfang_msat, umfang_lamports, reklamationen]`.
 * Relays sehen nur, dass Kontakte Post bekommen.
 */
export async function baueRufUmschlaege(p: {
  von: Signer; an: readonly string[]; zeilen: readonly RufZeile[]; nowSecs?: number;
}): Promise<NostrEvent[]> {
  const ich = p.von.publicKey();
  const an = [...new Set(p.an)].filter((k) => HEX64.test(k) && k !== ich);
  const zeilen = p.zeilen.filter((z) => HEX64.test(z.provider) && z.auftraege > 0).slice(0, RUF_MAX_PROVIDER);
  if (an.length === 0 || zeilen.length === 0) return [];
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const kern: UnsignedEvent = {
    pubkey: ich, kind: KIND_RUF_ZUSAMMENFASSUNG, created_at: now, content: "",
    tags: zeilen.map((z) => ["provider", z.provider, ...[z.auftraege, z.belegt, z.umfangMsat, z.umfangLamports, z.reklamationen].map((n) => String(Math.max(0, Math.floor(n))))]),
  };
  return Promise.all(an.map((k) => giftWrapMitSigner(kern, p.von, k, { nowSecs: now })));
}

/** Eine empfangene Zusammenfassung. */
export interface RufVonKontakt {
  von: string;
  zeit: number;
  zeilen: RufZeile[];
}

/**
 * Umschlag öffnen: eine Zusammenfassung von einem der eigenen Kontakte? Sonst
 * null – Fremde zählen nicht, und der Kern muss vom Siegel-Autor stammen.
 */
export async function oeffneRufUmschlag(wrap: NostrEvent, signer: Signer, kontakte: ReadonlySet<string>): Promise<RufVonKontakt | null> {
  const u = await giftUnwrapMitSigner(wrap, signer).catch(() => null);
  if (!u?.ok || !u.inner || u.inner.kind !== KIND_RUF_ZUSAMMENFASSUNG || u.inner.pubkey !== u.senderPubkey) return null;
  if (!kontakte.has(u.senderPubkey) || !Number.isSafeInteger(u.inner.created_at)) return null;
  const zeilen: RufZeile[] = [];
  const gesehen = new Set<string>();
  for (const t of u.inner.tags) {
    if (t[0] !== "provider" || t.length !== 7 || !HEX64.test(t[1] ?? "") || gesehen.has(t[1]!) || !t.slice(2).every((x) => ZAHL.test(x ?? ""))) continue;
    const [auftraege, belegt, umfangMsat, umfangLamports, reklamationen] = t.slice(2).map(Number) as [number, number, number, number, number];
    if (auftraege < 1 || belegt > auftraege) continue;
    gesehen.add(t[1]!);
    zeilen.push({ provider: t[1]!, auftraege, belegt, umfangMsat, umfangLamports, reklamationen });
    if (zeilen.length >= RUF_MAX_PROVIDER) break;
  }
  return zeilen.length > 0 ? { von: u.senderPubkey, zeit: u.inner.created_at, zeilen } : null;
}

// ---------------------------------------------------------------- Ruf

export interface Ruf {
  provider: string;
  /** Gewichtete Aufträge: eigene belegte 1, eigene angekündigte ½, von Kontakten je die Hälfte davon. */
  auftraege: number;
  reklamationen: number;
  /** Eigene bezahlte Antworten. */
  eigene: number;
  /** So viele Kontakte haben ihn bezahlt. */
  kontakte: number;
  /** 0–100, wie bisher `trustScore` – aber nur aus Quittungen. */
  vertrauen: number;
}

/**
 * Ruf je Provider – nur aus eigenen Quittungen und den Zusammenfassungen der
 * Kontakte (je Kontakt die neueste, je Provider gedeckelt). Nichts sonst geht
 * ein: keine Leistungs-Events, keine Angebote, keine Ranglisten.
 */
export function berechneRuf(p: {
  quittungen: readonly Quittung[]; reklamationen?: ReadonlyMap<string, number>; vonKontakten?: readonly RufVonKontakt[];
}): Map<string, Ruf> {
  const ruf = new Map<string, Ruf>();
  const eintrag = (pk: string) => {
    let r = ruf.get(pk);
    if (!r) ruf.set(pk, (r = { provider: pk, auftraege: 0, reklamationen: 0, eigene: 0, kontakte: 0, vertrauen: 0 }));
    return r;
  };
  const gewicht = (belegt: number, alle: number) => belegt + (alle - belegt) / 2;
  for (const z of fasseZusammen(p.quittungen, p.reklamationen)) {
    const r = eintrag(z.provider);
    r.eigene = z.auftraege;
    r.auftraege += gewicht(z.belegt, z.auftraege);
    r.reklamationen += z.reklamationen;
  }
  const neueste = new Map<string, RufVonKontakt>();
  for (const k of p.vonKontakten ?? []) if ((neueste.get(k.von)?.zeit ?? -1) < k.zeit) neueste.set(k.von, k);
  for (const k of neueste.values()) {
    for (const z of k.zeilen) {
      const r = eintrag(z.provider);
      const alle = Math.min(z.auftraege, RUF_KONTAKT_DECKEL);
      r.auftraege += gewicht(Math.min(z.belegt, alle), alle) / 2;
      r.reklamationen += Math.min(z.reklamationen, alle) / 2;
      r.kontakte += 1;
    }
  }
  for (const r of ruf.values()) r.vertrauen = Math.max(0, Math.min(100, Math.round(r.auftraege * 2 - r.reklamationen * 10)));
  return ruf;
}
