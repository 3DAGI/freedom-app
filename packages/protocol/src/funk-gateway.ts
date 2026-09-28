/**
 * KI über ein Funk-Gateway (Schritt 7.4).
 *
 * Wer kein Internet hat, schickt seinen versiegelten KI-Auftrag über Funk an
 * ein Gateway mit Netz. Das Gateway sieht nur Umschläge (NIP-59): Es reicht den
 * Auftrag an die Relays weiter und die Antwort über Funk zurück. Ende-zu-Ende
 * bleibt – Inhalt, Identität und Bezahlung (Zahlkanal-Gutschrift im
 * versiegelten Kern, 4.3) sieht es nicht.
 *
 * Damit das Gateway weiß, welche Antwort zurück muss, bekommt es einen eigenen
 * versiegelten Weiterleitungsauftrag, signiert vom Sitzungsschlüssel – mehr
 * erfährt es nicht. Die Signatur zeigt, dass der Auftraggeber den Schlüssel
 * hält: Niemand lässt fremde Post über „sein“ Gateway funken.
 *
 * Über Funk ist die Sendezeit knapp (1 % je Stunde, 7.1): Der Auftrag verlangt
 * deshalb eine kurze Antwort ohne Zwischenstände (`max_zeichen`, höchstens
 * 500 Zeichen) – der Provider kürzt, das Gateway funkt höchstens wenige
 * Umschläge je Sitzung zurück.
 */
import { computeEventId, getTag, type NostrEvent, type UnsignedEvent } from "./event.js";
import { KIND_GIFT_WRAP, giftUnwrapMitSigner, giftWrapMitSigner } from "./gift-wrap.js";
import type { Signer } from "./signer.js";

/** Versiegelter Weiterleitungsauftrag an ein Gateway (Kern, Autor = Sitzungsschlüssel). */
export const KIND_FUNK_WEITERLEITUNG = 25030;
/** Höchstens so viele Zeichen verlangt ein Auftrag über Funk. */
export const FUNK_MAX_ZEICHEN = 500;
/** Parameter im versiegelten Auftrag: `["param", "max_zeichen", "<n>"]`. */
export const FUNK_PARAM = "max_zeichen";
/** Länger als eine Stunde wartet ein Gateway nicht auf eine Antwort. */
export const WEITERLEITUNG_MAX_SECS = 3600;
/** So viele Umschläge funkt ein Gateway je Sitzung höchstens zurück (Ergebnis, Ablehnung, Reserve). */
export const WEITERLEITUNG_MAX_ANTWORTEN = 3;
/** So viele Sitzungen hält ein Gateway höchstens gleichzeitig. */
export const WEITERLEITUNG_MAX_OFFEN = 50;
/** Uhren von Handy, Gateway und Provider dürfen so weit auseinanderliegen (Sekunden). */
export const WEITERLEITUNG_UHR_TOLERANZ = 600;

const HEX64 = /^[0-9a-f]{64}$/;

/** Parameter für `buildJobRequest({ params })`: kurze Antwort ohne Zwischenstände. */
export function kurzParam(maxZeichen = FUNK_MAX_ZEICHEN): [string, string] {
  if (!Number.isSafeInteger(maxZeichen) || maxZeichen < 1) throw new Error("max_zeichen muss eine positive ganze Zahl sein");
  return [FUNK_PARAM, String(Math.min(maxZeichen, FUNK_MAX_ZEICHEN))];
}

/**
 * Wunsch des Kunden aus dem (geöffneten) Auftrag: höchstens so viele Zeichen,
 * gedeckelt auf 500; null, wenn der Auftrag keinen oder einen unbrauchbaren
 * Wert nennt – dann antwortet der Provider wie immer.
 */
export function leseKurzWunsch(request: { tags: string[][] }): number | null {
  const roh = request.tags.find((t) => t[0] === "param" && t[1] === FUNK_PARAM)?.[2];
  if (roh === undefined || !/^\d{1,6}$/.test(roh)) return null;
  const n = Number(roh);
  return n >= 1 ? Math.min(n, FUNK_MAX_ZEICHEN) : null;
}

/** Kürzt auf höchstens `max` Zeichen (Codepunkte, kein zerteiltes Emoji); gekürzt endet mit „…“. */
export function kuerzeAntwort(text: string, max: number): string {
  const zeichen = [...text];
  if (zeichen.length <= max) return text;
  return zeichen.slice(0, Math.max(0, max - 1)).join("").trimEnd() + "…";
}

export interface Weiterleitung {
  /** Sitzungsschlüssel: Umschläge an ihn funkt das Gateway zurück. */
  sitzung: string;
  /** Bis dahin (Unix-Sekunden) – danach nichts mehr. */
  bis: number;
  /**
   * Erstellt um (Unix-Sekunden, 7.4b2): Ältere Post an die Sitzung – etwa
   * Antworten aus der Zeit mit Netz – funkt das Gateway nicht zurück.
   */
  ab: number;
  auftragId: string;
}

/**
 * Weiterleitungsauftrag bauen: versiegelt an das Gateway, signiert vom
 * Sitzungsschlüssel, mit Ablauf (auch am Umschlag, NIP-40).
 */
export async function baueWeiterleitung(p: {
  sitzung: Signer; gatewayPk: string; dauerSecs?: number; nowSecs?: number;
}): Promise<{ wrap: NostrEvent; weiterleitung: Weiterleitung }> {
  if (!HEX64.test(p.gatewayPk)) throw new Error("Gateway-Pubkey ungültig");
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const dauer = p.dauerSecs ?? 1800;
  if (!Number.isSafeInteger(dauer) || dauer < 60 || dauer > WEITERLEITUNG_MAX_SECS) throw new Error("Dauer außerhalb 60 s – 1 h");
  const bis = now + dauer;
  const kern: UnsignedEvent = {
    pubkey: p.sitzung.publicKey(), kind: KIND_FUNK_WEITERLEITUNG, created_at: now,
    tags: [["p", p.gatewayPk], ["expiration", String(bis)]], content: "",
  };
  const wrap = await giftWrapMitSigner(kern, p.sitzung, p.gatewayPk, { fixedJitter: 0, nowSecs: now, ablaufBis: bis });
  return { wrap, weiterleitung: { sitzung: kern.pubkey, bis, ab: now, auftragId: computeEventId(kern) } };
}

/** Als Gateway öffnen; null, wenn es kein gültiger, noch laufender Weiterleitungsauftrag ist. */
export async function oeffneWeiterleitung(wrap: NostrEvent, gateway: Signer, nowSecs = Math.floor(Date.now() / 1000)): Promise<Weiterleitung | null> {
  if (wrap.kind !== KIND_GIFT_WRAP || getTag(wrap, "p") !== gateway.publicKey()) return null;
  const r = await giftUnwrapMitSigner(wrap, gateway);
  if (!r.ok || !r.inner || r.inner.kind !== KIND_FUNK_WEITERLEITUNG || r.inner.pubkey !== r.senderPubkey) return null;
  const k = r.inner;
  if (!HEX64.test(k.pubkey) || getTag(k as NostrEvent, "p") !== gateway.publicKey()) return null;
  const bis = Number(getTag(k as NostrEvent, "expiration"));
  if (!Number.isSafeInteger(bis) || bis <= nowSecs || bis - k.created_at > WEITERLEITUNG_MAX_SECS) return null;
  return { sitzung: k.pubkey, bis, ab: k.created_at, auftragId: computeEventId(k) };
}

/**
 * Was ein Gateway zurückfunkt – eine Stelle für die Regeln: nur Umschläge an
 * eine gemerkte, noch laufende Sitzung, die nicht älter als ihr Auftrag sind
 * (7.4b2), höchstens drei je Auftrag, keiner doppelt, höchstens 50 Sitzungen
 * zugleich. Alles andere bleibt im Netz.
 */
export class GatewayBuch {
  private sitzungen = new Map<string, { bis: number; ab: number; auftragId: string; zaehler: number; gesendet: Set<string> }>();

  /**
   * Weiterleitung merken; false, wenn das Buch voll ist (dann nichts
   * zurückfunken). Ein neuerer Auftrag derselben Sitzung ersetzt den alten –
   * mit neuer Frist und neuen drei Umschlägen (schon Gefunktes bleibt
   * gefunkt); ein älterer (wiederholt gefunkter) ändert nichts.
   */
  merke(w: Weiterleitung, nowSecs = Math.floor(Date.now() / 1000)): boolean {
    this.raeumeAuf(nowSecs);
    const alt = this.sitzungen.get(w.sitzung);
    if (alt) {
      if (w.ab > alt.ab && w.auftragId !== alt.auftragId) Object.assign(alt, { bis: w.bis, ab: w.ab, auftragId: w.auftragId, zaehler: 0 });
      return true;
    }
    if (this.sitzungen.size >= WEITERLEITUNG_MAX_OFFEN) return false;
    this.sitzungen.set(w.sitzung, { bis: w.bis, ab: w.ab, auftragId: w.auftragId, zaehler: 0, gesendet: new Set() });
    return true;
  }

  /** Sitzungen, auf deren Post das Gateway gerade achtet (für das Abo `#p`). */
  offene(nowSecs = Math.floor(Date.now() / 1000)): string[] {
    this.raeumeAuf(nowSecs);
    return [...this.sitzungen.keys()];
  }

  /** Soll dieser Umschlag über Funk zurück? Zählt ihn, wenn ja. */
  zurueck(wrap: NostrEvent, nowSecs = Math.floor(Date.now() / 1000)): boolean {
    if (wrap.kind !== KIND_GIFT_WRAP) return false;
    const s = this.sitzungen.get(getTag(wrap, "p") ?? "");
    if (!s || s.bis <= nowSecs || s.gesendet.has(wrap.id)) return false;
    // Antworten tragen ihre echte Zeit (ohne Streuung) – was vor dem Auftrag entstand, ist alte Post
    if (!(wrap.created_at >= s.ab - WEITERLEITUNG_UHR_TOLERANZ)) return false;
    if (s.zaehler >= WEITERLEITUNG_MAX_ANTWORTEN) return false;
    s.zaehler++;
    s.gesendet.add(wrap.id);
    return true;
  }

  private raeumeAuf(nowSecs: number): void {
    for (const [k, s] of this.sitzungen) if (s.bis <= nowSecs) this.sitzungen.delete(k);
  }
}
