/**
 * Zeitanker im echten Pfad der App (Schritt 5.10b, B-17b3a): vormerken, wo
 * ein Mandat veröffentlicht oder eine Quittung angelegt wird, und im Abruftakt
 * stempeln, nachreichen und den Beweis zum Mandat veröffentlichen
 * (`zeitankerTakt()`). Die Kalender (`OTS_KALENDER`) sehen IP und Zeitpunkt,
 * nie einen Wert; mit Tor nur den Ausgang. Ohne Einträge geht nichts hinaus.
 */
import {
  type GemerkteMandate, type NostrEvent, type Quittung, type RelayFilter, KIND_OTS_BEWEIS, pruefeVerankerung, reicheNach, stempele,
} from "@freedomstack/protocol";
import { ankerZeiten, streitigeMandate } from "../mandat-anker.js";
import { ZeitankerBuch, quittungsDigest, zeitankerTakt } from "../zeitanker.js";
import { alsGeraet, ensurePool, signiere, state } from "./state.js";
import { geheim } from "./tresor.js";

export const zeitanker = new ZeitankerBuch(geheim);
const jetzt = (): number => Math.floor(Date.now() / 1000);
const holen = (url: string, init: RequestInit) => fetch(url, init);
let laeuft = false;

/** Eigenes Mandat für den Schlüsselwechsel (K1 A) – nach dem Veröffentlichen. */
export async function ankereMandat(ev: NostrEvent): Promise<void> {
  await zeitanker.vormerken({ art: "mandat", digest: ev.id, kind: ev.kind }, jetzt()).catch(() => false);
}

/** Quittung (K1 A) – nur ihr Wert geht hinaus, der Beweis bleibt im Tresor. */
export async function ankereQuittung(q: Quittung): Promise<void> {
  await zeitanker.vormerken({ art: "quittung", digest: quittungsDigest(q) }, jetzt()).catch(() => false);
}

/** Ein Schlag im Abruftakt; ohne offene Anker kein Netz. Als Gerät veröffentlicht die App nichts für die Person. */
export async function zeitankerSchlag(): Promise<void> {
  if (laeuft || zeitanker.alle().every((a) => a.hoehe !== undefined && (a.art !== "mandat" || a.veroeffentlicht))) return;
  laeuft = true;
  try {
    const autor = state.keypair && !alsGeraet() ? state.keypair.pk : undefined;
    await zeitankerTakt(zeitanker, {
      stempele: (d) => stempele(d, { holen }),
      reicheNach: (z, h) => reicheNach(z, { holen: h }),
      holen,
      autor,
      veroeffentliche: autor ? async (ev) => { await (await ensurePool()).publish(await signiere(ev)); } : undefined,
      jetzt: jetzt(),
    });
  } finally {
    laeuft = false;
  }
}

/** Geprüfte Beweise dieser Sitzung (je Kind-1040-Kennung) – nur im Speicher. */
const geprueft = new Map<string, number | null>();

/**
 * Mandate von Kontakten bei Streit gegen Bitcoin prüfen (B-17b3b, K4 A): nur
 * wenn ein alter Schlüssel mehr als einen Nachfolger hat; dann die 1040 zu
 * diesen Mandaten holen und gegen beide Explorer prüfen. Sonst kein Netz.
 */
export async function ankerFuerStreit(
  pool: { query(f: RelayFilter): Promise<NostrEvent[]> }, mandate: readonly NostrEvent[], gemerkt: GemerkteMandate,
): Promise<Map<string, number>> {
  const streit = streitigeMandate(mandate, gemerkt);
  if (streit.length === 0) return new Map();
  const beweise = await pool.query({ kinds: [KIND_OTS_BEWEIS], "#e": streit.map((m) => m.id), limit: 50 });
  return ankerZeiten(streit, beweise, (z) => pruefeVerankerung(z, { holen }), geprueft);
}
