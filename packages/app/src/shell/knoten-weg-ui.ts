/**
 * Alles über meinen Knoten (Sammlung B-9c2, Entscheidung L5 A): Mit Haken gehen
 * KI-Anfragen und Halte-Aufträge an den eigenen Knoten nur über sein Relay –
 * über eine eigene Verbindung, an der sich der Sitzungsschlüssel der Anfrage
 * anmeldet (NIP-42). Das ist die einzige Stelle, an der ein Sitzungsschlüssel
 * sich anmeldet, und nur am Relay des gekoppelten Knotens (`knotenRelay()`).
 * Ohne bekanntes Relay geht nichts an ihn – nie still über den Pool.
 */
import { KIND_RELAY_LIST, WebSocketRelay, baueRelayAuth, type NostrEvent, type RelayFilter, type Signer } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { LS_NUR_KNOTEN, knotenRelayAus, nurUeberKnoten, satzMitKnotenRelay, ursprungAlsKnotenRelay } from "../knoten-weg.js";
import { fehlerText } from "../protokoll-texte.js";
import { ladeEigeneRelays, setzeEigeneRelays } from "../relay-satz.js";
import { bestaetige } from "./dialog.js";
import { meineKopplung } from "./mein-knoten.js";
import { alsGeraet, ensurePool, nimmInPool, signiere, state, veroeffentlicheWeit } from "./state.js";
import { el } from "./ui.js";

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

const SATZ_FALL = { "kein-satz": "set.keinSatz", schon: "set.knotenRelaySchon", untauglich: "set.knotenRelayUntauglich" } as const;

/**
 * „Relay meines Knotens übernehmen“ (Sammlung B-9c3, Entscheidung L7 A): sein
 * Relay in den eigenen Satz, als Schreib-Relay und Posteingang – nur über
 * `setzeEigeneRelays()` (beide Listen veröffentlicht, erst dann gemerkt), nach
 * Rückfrage. Als Gerät nicht: Der Satz gehört der Person (8.6c).
 */
export async function uebernimmKnotenRelay(): Promise<void> {
  const k = meineKopplung();
  const ziel = document.getElementById("knoten-status-anzeige");
  const knopf = document.getElementById("knoten-relay-uebernehmen") as HTMLButtonElement | null;
  if (!k || !ziel || !knopf) return;
  const zeige = (text: string) => ziel.replaceChildren(el("div", text));
  if (alsGeraet()) return zeige(t("set.geraetSatz"));
  const pk = state.keypair?.pk;
  if (!pk) return zeige(t("set.keineIdentitaet"));
  knopf.disabled = true;
  try {
    const eigene = ladeEigeneRelays(localStorage);
    let url = await knotenRelay(k.knoten);
    let r = url ? satzMitKnotenRelay(eigene, url) : null;
    if (!r || ("fall" in r && r.fall === "untauglich")) {
      // App vom Knoten im Heimnetz (B-10): der Ursprung ist ws:// – Kontakte brauchen seine Adresse aus NIP-65
      const pool = await ensurePool();
      const ausListe = knotenRelayAus(await pool.query({ kinds: [KIND_RELAY_LIST], authors: [k.knoten], limit: 5 }).catch(() => []), k.knoten);
      if (ausListe && ausListe !== url) { url = ausListe; r = satzMitKnotenRelay(eigene, ausListe); }
    }
    if (!url || !r) return zeige(t("set.knotenRelayKeins"));
    if ("fall" in r) return zeige(t(SATZ_FALL[r.fall], { url }));
    if ("fehler" in r) return zeige(r.fehler);
    const relays = r.relays;
    if (!await bestaetige({ titel: t("set.knotenRelayUebernehmen"), text: t("set.knotenRelayFrage", { url }), ok: t("set.knotenRelayUebernehmen") })) return;
    zeige(t("set.veroeffentliche"));
    if (!await setzeEigeneRelays({ relays, pk, signiere, weit: veroeffentlicheWeit, speicher: localStorage })) return zeige(t("set.nichtVeroeffentlichtKeiner"));
    await nimmInPool(relays);
    const feld = document.getElementById("eigene-relays") as HTMLTextAreaElement | null;
    if (feld) feld.value = relays.join("\n");
    zeige(t("set.knotenRelayDrin", { url, n: relays.length }));
  } catch (e) {
    zeige(t("set.nichtVeroeffentlicht", { fehler: fehlerText(e) }));
  } finally {
    knopf.disabled = false;
  }
}

/** Haken und Knopf in der Karte „Mein Knoten“ (einmal beim Start) – der Haken gemerkt als „1“/„0“. */
export function wireKnotenWeg(): void {
  document.getElementById("knoten-relay-uebernehmen")?.addEventListener("click", () => void uebernimmKnotenRelay());
  const nur = document.getElementById("knoten-nur") as HTMLInputElement | null;
  if (!nur) return;
  nur.checked = nurUeberKnoten(localStorage);
  nur.addEventListener("change", () => {
    localStorage.setItem(LS_NUR_KNOTEN, nur.checked ? "1" : "0");
    gemerkt = null;
  });
}
