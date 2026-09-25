/**
 * Zentrale Kind-Registry.
 *
 * Spiegelt Buzz' Erweiterungsmuster (`buzz-core/src/kind.rs`): Eine neue
 * Funktion wird als neue Event-Kind definiert, nicht als neuer HTTP-Endpunkt.
 * Bestehende Clients ignorieren unbekannte Kinds und brechen nicht.
 *
 * Bereiche (NIP-01):
 *   0-999        regulaer (0 = Profil-Metadaten)
 *   1000-9999    regulaer
 *   10000-19999  ersetzbar
 *   20000-29999  ephemer
 *   30000-39999  adressierbar/ersetzbar (parametrisiert)
 */

// --- Nostr-Standard ---
export const KIND_PROFILE = 0;              // NIP-01 Metadaten (enthaelt lud16)
export const KIND_TEXT_NOTE = 1;            // NIP-01
export const KIND_ZAP_REQUEST = 9734;       // NIP-57
export const KIND_ZAP_RECEIPT = 9735;       // NIP-57
export const KIND_SOL_TRINKGELD = 9736;     // SOL-Trinkgeld-Beleg (Entwurf docs/NIP-SOL-TIP.md, 4.7)
export const KIND_DM = 4;                   // NIP-44 (verschluesselte DM)
export const KIND_BLOB_MANIFEST = 38040;    // Freedom Blob: "Torrent-Datei"
export const KIND_BLOB_CHUNK = 38041;       // Freedom Blob: ein Erasure-Shard
export const KIND_GIT_REPO_REF = 38042;     // Freedom Git: repo -> blob-manifest
export const KIND_REWARD_CLAIM = 38013;     // Provider fordert Season-Belohnung an

// --- NIP-90 Data Vending Machines (bezahlte KI-Jobs) ---
export const KIND_DVM_REQUEST_MIN = 5000;
export const KIND_DVM_REQUEST_MAX = 5999;
export const KIND_DVM_RESULT_MIN = 6000;
export const KIND_DVM_RESULT_MAX = 6999;
export const KIND_DVM_FEEDBACK = 7000;

/** Konkrete DVM-Jobtypen, die wir nutzen. */
export const KIND_DVM_TEXT_GENERATION = 5050;   // Request
export const KIND_DVM_TEXT_RESULT = 6050;       // Result

/** Protokoll-eigene Kinds (adressierbarer Bereich). */
export const KIND_LP_OFFER = 38001;         // LP-Liquiditaetsangebot (Swap)
export const KIND_SWAP_ATTESTATION = 38002; // Swap-Abschluss -> Reputation
export const KIND_PERFORMANCE = 38010;      // Leistungs-Event (Nachricht/KI-Job/Liquiditaet)
export const KIND_REWARD_PAYOUT = 38011;    // Reward-Ausschuettungsnachweis
export const KIND_SEASON_DEF = 38012;       // Season-Definition (Start/Ende/Pool-Regeln)
export const KIND_SESSION_OPEN = 38021;     // Streaming-Sats Session-Eroeffnung
export const KIND_SESSION_PAYMENT = 38022;  // Streaming-Sats Zahlungs-Beleg
export const KIND_SOL_DEPOSIT_OPEN = 38023; // Solana-Deposit-Session (Escrow)
export const KIND_SOL_DEPOSIT_SETTLE = 38024; // Solana-Deposit Abrechnung
export const KIND_PROVIDER_CAPABILITIES = 38027; // Provider-Faehigkeiten (Tier/Modelle/Tools/Preise) — v2, invalidiert alte 38025-Events
export const KIND_PRICE_TICKER = 38026;        // Dezentraler Kurs-Ticker (SOL/sats)
export const KIND_MESH_PACKET = 38030;         // Mesh-Paket (Store-and-Forward)
export const KIND_DELIVERY_RECEIPT = 38031;    // Kurier-Zustell-Beleg (oeffnet Belohnung)

// --- DVM-Tool-Jobtypen (NIP-90, Request 5xxx / Result 6xxx = +1000) ---
export const KIND_DVM_WEB_SEARCH = 5060;    // Web-Suche
export const KIND_DVM_FILE_IO = 5061;       // Datei lesen/schreiben
export const KIND_DVM_BROWSER = 5062;       // Browser-Automation
export const KIND_DVM_IMAGE_GEN = 5070;     // Bild-Generierung
export const KIND_DVM_VIDEO_GEN = 5071;     // Video-Generierung (Minimax H3)
export const KIND_DVM_BLOB_FETCH = 5075;    // Storage: Chunk-Fetch (Micro-Reward pro Shard)

export function isDvmRequest(kind: number): boolean {
  return kind >= KIND_DVM_REQUEST_MIN && kind <= KIND_DVM_REQUEST_MAX;
}

export function isDvmResult(kind: number): boolean {
  return kind >= KIND_DVM_RESULT_MIN && kind <= KIND_DVM_RESULT_MAX;
}

/** Result-Kind zu einem Request-Kind (NIP-90: +1000). */
export function resultKindFor(requestKind: number): number {
  if (!isDvmRequest(requestKind)) throw new Error(`kein DVM-Request-Kind: ${requestKind}`);
  return requestKind + 1000;
}

// --- Transparenz-Kinds (Treasury + Fee-Beweis) ---
export const KIND_TREASURY_ANNOUNCE = 38050; // woechentliche Treasury-Empfangsadresse
// KIND_FEE_PROOF = 38051 wird in fee-proof.ts definiert (dort liegt die Logik).
