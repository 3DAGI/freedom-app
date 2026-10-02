/**
 * Alles über meinen Knoten (Sammlung B-9c2, Entscheidung L5 A): Mit Haken gehen
 * KI-Anfragen und Halte-Aufträge an den eigenen Knoten nur über sein Relay –
 * über eine eigene Verbindung, an der sich der Sitzungsschlüssel der Anfrage
 * anmeldet (NIP-42). Das ist die einzige Stelle, an der ein Sitzungsschlüssel
 * sich anmeldet, und nur am Relay des gekoppelten Knotens (`knotenRelay()`).
 * Ohne bekanntes Relay geht nichts an ihn – nie still über den Pool.
 */
import { KIND_RELAY_LIST, WebSocketRelay, baueRelayAuth, type NostrEvent, type RelayFilter, type Signer } from "@freedomstack/protocol";
import { LS_NUR_KNOTEN, knotenRelayAus, nurUeberKnoten, ursprungAlsKnotenRelay } from "../knoten-weg.js";
import { ensurePool } from "./state.js";

/** Gefundene Adresse je Knoten – nur für diese Sitzung. */
let gemerkt: { knoten: string; url: string | null } | null = null;

/** Relay meines Knotens: der eigene Ursprung, wenn die App vom Knoten kommt (B-10), sonst seine NIP-65-Liste. */
export async function knotenRelay(knoten: string): Promise<string | null> {
  if (gemerkt?.knoten === knoten) return gemerkt.url;
  let url: string | null = null;
  if (location.protocol === "http:" || location.protocol === "https:") {
    try {
      const r = await fetch(`${location.protocol}//${location.host}/`, { headers: { Accept: "application/nostr+json" }, signal: AbortSignal.timeout(5000) });
      if (r.ok) url = ursprungAlsKnotenRelay(location, await r.json(), knoten);
    } catch { /* die App kommt nicht vom Knoten */ }
  }
  if (!url) {
    const pool = await ensurePool();
    url = knotenRelayAus(await pool.query({ kinds: [KIND_RELAY_LIST], authors: [knoten], limit: 5 }).catch(() => []), knoten);
  }
  gemerkt = { knoten, url };
  return url;
}

/** Eigene Verbindung zum Relay meines Knotens, angemeldet mit dem Sitzungsschlüssel der Anfrage. */
function knotenVerbindung(url: string, sitzung: Signer): WebSocketRelay {
  return new WebSocketRelay(url, {
    timeoutMs: 8000,
    autoReconnect: false,
    anmelden: async (u, challenge) => sitzung.signEvent(baueRelayAuth(sitzung.publicKey(), u, challenge)),
  });
}

export interface KnotenWeg {
  /** Sitzungsschlüssel des Auftrags – nur nach Umschlägen an ihn fragen: Das Relay des Knotens liefert nur an angemeldete Schlüssel. */
  sitzungPk: string;
  publish(ev: NostrEvent): Promise<unknown>;
  query(f: RelayFilter): Promise<NostrEvent[]>;
  schliesse(): void;
}

/**
 * Der Weg für einen Auftrag an meinen Knoten: mit Haken nur sein Relay – oder
 * null, dann geht nichts hinaus; ohne Haken der Pool wie bisher.
 */
export async function wegZumKnoten(knoten: string, sitzung: Signer): Promise<KnotenWeg | null> {
  if (!nurUeberKnoten(localStorage)) {
    const pool = await ensurePool();
    return { sitzungPk: sitzung.publicKey(), publish: (ev) => pool.publish(ev), query: (f) => pool.query(f), schliesse: () => {} };
  }
  const url = await knotenRelay(knoten);
  if (!url) return null;
  const v = knotenVerbindung(url, sitzung);
  return { sitzungPk: sitzung.publicKey(), publish: (ev) => v.publish(ev), query: (f) => v.query(f), schliesse: () => v.close() };
}

/** Haken in der Karte „Mein Knoten“ (einmal beim Start) – gemerkt als „1“/„0“. */
export function wireKnotenWeg(): void {
  const nur = document.getElementById("knoten-nur") as HTMLInputElement | null;
  if (!nur) return;
  nur.checked = nurUeberKnoten(localStorage);
  nur.addEventListener("change", () => {
    localStorage.setItem(LS_NUR_KNOTEN, nur.checked ? "1" : "0");
    gemerkt = null;
  });
}
