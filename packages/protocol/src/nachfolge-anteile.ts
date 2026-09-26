/**
 * Nachfolge: Anteile versiegelt (Schritt 8.11a).
 *
 * Bis 8.11 lud die App beim Einrichten alle Anteile als eine Textdatei
 * herunter – wer die Datei hatte, hatte alles, und die Weitergabe blieb dem
 * Nutzer ueberlassen. Jetzt geht jeder Anteil im Umschlag (NIP-59) an genau
 * seinen Vertrauten; kein Relay sieht einen Anteil. Zusammengesetzt wird erst,
 * wenn der oeffentliche Plan es erlaubt (`evaluateSuccession()` sagt
 * „freigegeben“): Ein Vertrauter sammelt, die anderen uebergeben ihm ihren
 * Anteil – ebenso versiegelt.
 *
 *   Anteil     innen Kind 38077, vom Besitzer an einen Vertrauten:
 *              ["p", vertrauter], ["index", "1"…"255"], ["schwelle", k],
 *              ["anzahl", n], ["secret_hash", …], ["teilung", id];
 *              Inhalt: der Anteil (Hex)
 *   Anfrage    innen Kind 38078, vom Sammler an einen anderen Vertrauten:
 *              ["p", an], ["besitzer", pk], ["teilung", id]
 *   Uebergabe  innen Kind 38079, vom Vertrauten an den Sammler:
 *              ["e", anfrage], ["p", sammler], ["besitzer", pk], dazu
 *              index, schwelle, anzahl, secret_hash, teilung wie beim
 *              Anteil; Inhalt: der Anteil (Hex)
 *
 * „teilung“ kennzeichnet eine Zerlegung: Richtet der Besitzer die Nachfolge
 * neu ein, entstehen neue Anteile; alte passen nicht dazu und werden beim
 * Zusammensetzen nicht gemischt.
 *
 * DIE GRENZEN (so stehen sie auch in der App)
 * - Der Plan ist oeffentlich: Wer deine Vertrauten sind, sieht jeder. Das ist
 *   Absicht – Meldungen und Lebenszeichen muessen fuer alle pruefbar sein,
 *   sonst liefe eine Uebernahme unbemerkt.
 * - Sprechen sich genug Vertraute ab, koennen sie uebernehmen; die App
 *   uebergibt zwar nur nach Freigabe, aber eine veraenderte App muss das nicht.
 *   Schutz sind die Auswahl der Personen, Schwelle, Wartezeit und die
 *   oeffentlichen Meldungen.
 * - Relays sehen, dass Vertraute Post bekommen – nicht was.
 */
import { computeEventId, type NostrEvent, type UnsignedEvent } from "./event.js";
import { giftUnwrapMitSigner, giftWrapMitSigner } from "./gift-wrap.js";
import type { Signer } from "./signer.js";
import {
  type Share, type SuccessionPlan, combineShares, evaluateSuccession, verifyRecovered,
} from "./succession.js";

export const KIND_NACHFOLGE_ANTEIL = 38077;
export const KIND_NACHFOLGE_ANFRAGE = 38078;
export const KIND_NACHFOLGE_UEBERGABE = 38079;

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const ANTEIL_HEX = /^([0-9a-f]{2}){1,64}$/;

/** Ein Anteil, wie ihn ein Vertrauter haelt. */
export interface GehaltenerAnteil {
  besitzer: string;
  index: number;
  /** Hex – nur im Tresor ablegen. */
  daten: string;
  schwelle: number;
  anzahl: number;
  secretHash: string;
  teilung: string;
  zeit: number;
}

const tag = (ev: UnsignedEvent, n: string) => ev.tags.find((t) => t[0] === n)?.[1];

function kernOk(inner: UnsignedEvent | undefined, kind: number, absender: string | undefined): inner is UnsignedEvent {
  return !!inner && inner.kind === kind && inner.pubkey === absender
    && Array.isArray(inner.tags) && inner.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === "string"))
    && Number.isSafeInteger(inner.created_at) && typeof inner.content === "string";
}

const ganz = (s: string | undefined, min: number, max: number): number | null => {
  if (!s || !/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
};

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const ausHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

/** Neue Kennung einer Zerlegung (16 Byte Hex). */
export function neueTeilung(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

/** Anteil des Besitzers an einen Vertrauten – versiegelt, ohne Zeitversatz. */
export async function baueAnteilUmschlag(p: {
  von: Signer; an: string; anteil: Share; schwelle: number; anzahl: number;
  secretHash: string; teilung: string; nowSecs?: number;
}): Promise<NostrEvent> {
  if (!HEX64.test(p.an) || p.an === p.von.publicKey()) throw new Error("Vertrauter ungültig");
  if (!HEX64.test(p.secretHash) || !HEX32.test(p.teilung)) throw new Error("Prüfsumme oder Teilung ungültig");
  if (!(p.schwelle >= 2 && p.schwelle <= p.anzahl && p.anzahl <= 255)) throw new Error("Schwelle ungültig");
  if (!(p.anteil.index >= 1 && p.anteil.index <= p.anzahl) || p.anteil.data.length === 0 || p.anteil.data.length > 64) {
    throw new Error("Anteil ungültig");
  }
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const kern: UnsignedEvent = {
    pubkey: p.von.publicKey(), kind: KIND_NACHFOLGE_ANTEIL, created_at: now,
    tags: [["p", p.an], ["index", String(p.anteil.index)], ["schwelle", String(p.schwelle)], ["anzahl", String(p.anzahl)],
      ["secret_hash", p.secretHash], ["teilung", p.teilung]],
    content: hex(p.anteil.data),
  };
  return giftWrapMitSigner(kern, p.von, p.an, { fixedJitter: 0, nowSecs: now });
}

function leseAnteil(inner: UnsignedEvent, besitzer: string): GehaltenerAnteil | null {
  const anzahl = ganz(tag(inner, "anzahl"), 2, 255);
  const schwelle = ganz(tag(inner, "schwelle"), 2, 255);
  const index = ganz(tag(inner, "index"), 1, 255);
  const secretHash = tag(inner, "secret_hash") ?? "";
  const teilung = tag(inner, "teilung") ?? "";
  if (anzahl === null || schwelle === null || index === null || schwelle > anzahl || index > anzahl) return null;
  if (!HEX64.test(secretHash) || !HEX32.test(teilung) || !ANTEIL_HEX.test(inner.content)) return null;
  return { besitzer, index, daten: inner.content, schwelle, anzahl, secretHash, teilung, zeit: inner.created_at };
}

/** Anteil als Vertrauter oeffnen; null, wenn der Umschlag keiner ist. */
export async function oeffneAnteil(wrap: NostrEvent, signer: Signer): Promise<GehaltenerAnteil | null> {
  const r = await giftUnwrapMitSigner(wrap, signer);
  if (!r.ok || !kernOk(r.inner, KIND_NACHFOLGE_ANTEIL, r.senderPubkey)) return null;
  if (tag(r.inner, "p") !== signer.publicKey()) return null;
  return leseAnteil(r.inner, r.inner.pubkey);
}

/** Anfrage des Sammlers an einen anderen Vertrauten. */
export async function baueAnteilAnfrage(p: {
  von: Signer; an: string; besitzer: string; teilung: string; nowSecs?: number;
}): Promise<{ wrap: NostrEvent; anfrageId: string }> {
  if (!HEX64.test(p.an) || !HEX64.test(p.besitzer) || !HEX32.test(p.teilung)) throw new Error("Anfrage ungültig");
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const kern: UnsignedEvent = {
    pubkey: p.von.publicKey(), kind: KIND_NACHFOLGE_ANFRAGE, created_at: now,
    tags: [["p", p.an], ["besitzer", p.besitzer], ["teilung", p.teilung]], content: "",
  };
  const wrap = await giftWrapMitSigner(kern, p.von, p.an, { fixedJitter: 0, nowSecs: now });
  return { wrap, anfrageId: computeEventId(kern) };
}

export interface AnteilAnfrage {
  von: string;
  besitzer: string;
  teilung: string;
  anfrageId: string;
  zeit: number;
}

/** Anfrage oeffnen (als gefragter Vertrauter). */
export async function oeffneAnteilAnfrage(wrap: NostrEvent, signer: Signer): Promise<AnteilAnfrage | null> {
  const r = await giftUnwrapMitSigner(wrap, signer);
  if (!r.ok || !kernOk(r.inner, KIND_NACHFOLGE_ANFRAGE, r.senderPubkey)) return null;
  const besitzer = tag(r.inner, "besitzer") ?? "";
  const teilung = tag(r.inner, "teilung") ?? "";
  if (tag(r.inner, "p") !== signer.publicKey() || !HEX64.test(besitzer) || !HEX32.test(teilung)) return null;
  return { von: r.inner.pubkey, besitzer, teilung, anfrageId: computeEventId(r.inner), zeit: r.inner.created_at };
}

/**
 * Darf ich meinen Anteil an `sammler` uebergeben? Nur, wenn der neueste Plan
 * des Besitzers beide als Vertraute nennt, der Anteil zu ihm passt und der
 * Plan freigegeben ist – ein Lebenszeichen des Besitzers sperrt wieder.
 */
export function darfUebergeben(p: {
  plan: SuccessionPlan; events: NostrEvent[]; anteil: GehaltenerAnteil; ich: string; sammler: string; nowSecs?: number;
}): { ok: true } | { ok: false; grund: string } {
  const { plan, anteil } = p;
  if (anteil.besitzer !== plan.ownerPubkey) return { ok: false, grund: "Anteil gehört zu einem anderen Besitzer" };
  if (anteil.secretHash !== plan.secretHash) return { ok: false, grund: "Anteil passt nicht zum Plan" };
  if (!plan.guardians.includes(p.ich)) return { ok: false, grund: "Du bist in diesem Plan nicht (mehr) Vertrauter" };
  if (p.sammler === p.ich || !plan.guardians.includes(p.sammler)) return { ok: false, grund: "Der Anfragende ist kein Vertrauter dieses Plans" };
  const st = evaluateSuccession(plan, p.events, p.nowSecs);
  if (st.status !== "freigegeben") return { ok: false, grund: `Noch nicht freigegeben: ${st.message}` };
  return { ok: true };
}

/** Eigenen Anteil an den Sammler uebergeben (nach `darfUebergeben`). */
export async function baueAnteilUebergabe(p: {
  von: Signer; anfrage: AnteilAnfrage; anteil: GehaltenerAnteil; nowSecs?: number;
}): Promise<NostrEvent> {
  const { anfrage, anteil } = p;
  if (anfrage.besitzer !== anteil.besitzer || anfrage.teilung !== anteil.teilung) throw new Error("Anfrage passt nicht zum Anteil");
  if (!HEX64.test(anfrage.anfrageId) || !HEX64.test(anfrage.von)) throw new Error("Anfrage ungültig");
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const kern: UnsignedEvent = {
    pubkey: p.von.publicKey(), kind: KIND_NACHFOLGE_UEBERGABE, created_at: now,
    tags: [["e", anfrage.anfrageId], ["p", anfrage.von], ["besitzer", anteil.besitzer], ["index", String(anteil.index)],
      ["schwelle", String(anteil.schwelle)], ["anzahl", String(anteil.anzahl)], ["secret_hash", anteil.secretHash],
      ["teilung", anteil.teilung]],
    content: anteil.daten,
  };
  return giftWrapMitSigner(kern, p.von, anfrage.von, { fixedJitter: 0, nowSecs: now });
}

/** Uebergabe als Sammler oeffnen – nur von einem Vertrauten des Plans. */
export async function oeffneAnteilUebergabe(
  wrap: NostrEvent, signer: Signer, plan: SuccessionPlan,
): Promise<(GehaltenerAnteil & { von: string; anfrageId: string }) | null> {
  const r = await giftUnwrapMitSigner(wrap, signer);
  if (!r.ok || !kernOk(r.inner, KIND_NACHFOLGE_UEBERGABE, r.senderPubkey)) return null;
  if (tag(r.inner, "p") !== signer.publicKey() || !plan.guardians.includes(r.inner.pubkey)) return null;
  if (tag(r.inner, "besitzer") !== plan.ownerPubkey) return null;
  const anfrageId = tag(r.inner, "e") ?? "";
  const a = leseAnteil(r.inner, plan.ownerPubkey);
  if (!a || !HEX64.test(anfrageId)) return null;
  return { ...a, von: r.inner.pubkey, anfrageId };
}

/**
 * Anteile zusammensetzen: nur einer Teilung, passend zum Plan, mindestens
 * die Schwelle. Gibt den Schluessel zurueck – nur geprueft (Pruefsumme).
 */
export function setzeNachfolgeZusammen(anteile: GehaltenerAnteil[], plan: SuccessionPlan): Uint8Array {
  const passend = anteile.filter((a) => a.besitzer === plan.ownerPubkey && a.secretHash === plan.secretHash);
  const jeTeilung = new Map<string, Map<number, GehaltenerAnteil>>();
  for (const a of passend) {
    const m = jeTeilung.get(a.teilung) ?? new Map<number, GehaltenerAnteil>();
    m.set(a.index, a);
    jeTeilung.set(a.teilung, m);
  }
  let bester = 0;
  for (const m of jeTeilung.values()) {
    const liste = [...m.values()];
    bester = Math.max(bester, liste.length);
    if (liste.length < plan.threshold || liste.length < liste[0]!.schwelle) continue;
    const geheimnis = combineShares(liste.map((a) => ({ index: a.index, data: ausHex(a.daten) })));
    if (verifyRecovered(geheimnis, plan)) return geheimnis;
    geheimnis.fill(0);
  }
  throw new Error(bester < plan.threshold
    ? `Erst ${bester} von ${plan.threshold} nötigen Anteilen`
    : "Die Anteile passen nicht zusammen oder nicht zum Plan");
}
