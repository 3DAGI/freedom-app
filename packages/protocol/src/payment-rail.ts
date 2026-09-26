/**
 * Zahlschienen (Schritt 4.1): Sats und SOL hinter einer Schnittstelle.
 *
 * Bisher sprach jede Geldfunktion ihre Wallet selbst an – der Zap die
 * WebLN-Erweiterung oder Phantom, der Wallet-Tab NWC, das Deposit das
 * HTLC-Programm. Damit war SOL nur dort moeglich, wo es jemand eigens
 * eingebaut hatte. Jetzt beschreibt `PaymentRail`, was eine Schiene kann;
 * Lightning und Solana setzen sie um (in der App, weil dort die Wallets
 * leben), und jede Geldfunktion fragt nur noch die Schiene.
 */

export type RailId = "lightning" | "solana";

/** Betrag in der Einheit der Schiene: Millisatoshi oder Lamports. */
export type Betrag = { einheit: "msat"; wert: number } | { einheit: "lamports"; wert: number };

export type Zweck = "zap" | "job" | "sitzung" | "deposit" | "trinkgeld" | "gebuehr" | "swap";

export interface Zahlanfrage {
  /** bolt11-Rechnung oder Lightning-Adresse (name@host) bzw. Solana-Adresse. */
  ziel: string;
  betrag: Betrag;
  zweck: Zweck;
  notiz?: string;
}

/** Was eine Schiene nach dem Zahlen zurueckgibt – der Nachweis. */
export interface Beleg {
  rail: RailId;
  ziel: string;
  betrag: Betrag;
  /** Lightning: Preimage (hex); Solana: Transaktions-Signatur (base58). */
  ref: string;
  /** Lightning: die bezahlte Rechnung – auch, wenn das Ziel eine Lightning-Adresse war. */
  rechnung?: string;
  /** Unix-Sekunden. */
  zeit: number;
}

export interface Angebot {
  rail: RailId;
  betrag: Betrag;
  /** Geschaetzte Netzgebuehr in der Einheit der Schiene, falls bekannt. */
  gebuehr?: Betrag;
}

export interface PaymentRail {
  readonly id: RailId;
  /** Ist auf diesem Geraet etwas verbunden, das zahlen kann? */
  verfuegbar(): Promise<boolean>;
  /** Ist das Netz da, das die Schiene braucht (7.3)? Ohne die Methode: ja. */
  online?(): boolean;
  quote(anfrage: Zahlanfrage): Promise<Angebot>;
  pay(anfrage: Zahlanfrage): Promise<Beleg>;
  /** Prueft einen Beleg – so weit die Schiene es ohne Dritte kann. */
  verify(beleg: Beleg): Promise<boolean>;
  refund?(beleg: Beleg): Promise<Beleg>;
  balance?(): Promise<Betrag>;
}

/** Die Einheit jeder Schiene. */
export const RAIL_EINHEIT: Record<RailId, Betrag["einheit"]> = { lightning: "msat", solana: "lamports" };

const BOLT11 = /^ln(bc|tb|bcrt|tbs)[0-9a-z]{20,}$/i;
const LUD16 = /^[a-z0-9._+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/i;
const SOL_ADRESSE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Welche Schiene kann dieses Ziel bedienen? null = keine. */
export function railFuerZiel(ziel: string): RailId | null {
  const z = ziel.trim();
  if (BOLT11.test(z) || LUD16.test(z)) return "lightning";
  if (SOL_ADRESSE.test(z)) return "solana";
  return null;
}

/** Anfrage vor dem Zahlen pruefen: Ziel zur Schiene, Betrag ganzzahlig und positiv. */
export function pruefeAnfrage(rail: RailId, a: Zahlanfrage): void {
  if (railFuerZiel(a.ziel) !== rail) throw new Error(`Ziel passt nicht zur Schiene ${rail}`);
  if (a.betrag.einheit !== RAIL_EINHEIT[rail]) throw new Error(`Betrag in ${a.betrag.einheit}, ${rail} rechnet in ${RAIL_EINHEIT[rail]}`);
  if (!Number.isSafeInteger(a.betrag.wert) || a.betrag.wert <= 0) throw new Error("Betrag muss eine positive ganze Zahl sein");
}

/**
 * Ohne Netz (Schritt 7.3): Lightning braucht mehrere Runden Austausch mit
 * Knoten, SOL einen RPC. Die App sagt das klar, statt an einem Netzfehler zu
 * scheitern – und nennt, was offline geht. Ecash (Cashu) waere offline
 * uebergebbar, haengt aber an verwahrenden Mints: nur nach MENSCH-Entscheidung.
 */
export const OFFLINE_HINWEIS =
  "Offline: Nachrichten gehen verschlüsselt über Funk oder per Datei (Settings → Mesh). Sats und SOL, sobald wieder Netz da ist.";

export function offlineZahlText(rail: RailId): string {
  return rail === "lightning"
    ? "Offline: Sats gehen erst wieder, wenn Netz da ist – Lightning braucht mehrere Runden Austausch. Nachrichten gehen über Funk oder per Datei."
    : "Offline: SOL geht erst wieder, wenn Netz da ist – offline signieren kommt mit 7.2. Nachrichten gehen über Funk oder per Datei.";
}

/**
 * Schiene waehlen: die bevorzugte, wenn sie das Ziel bedienen kann und
 * verbunden ist; sonst keine – eine stille Umleitung auf die andere Schiene
 * waere eine Zahlung in einer Waehrung, die der Nutzer nicht gewaehlt hat.
 */
export async function waehleRail(rails: readonly PaymentRail[], anfrage: Zahlanfrage): Promise<PaymentRail> {
  const noetig = railFuerZiel(anfrage.ziel);
  if (!noetig) throw new Error("Unbekanntes Zahlungsziel");
  const rail = rails.find((r) => r.id === noetig);
  if (!rail) throw new Error(`Keine Schiene für ${noetig}`);
  // Vor der Wallet-Frage: offline haengt NWC sonst, bis die Zeit ablaeuft.
  if (rail.online && !rail.online()) throw new Error(offlineZahlText(noetig));
  if (!(await rail.verfuegbar())) {
    throw new Error(noetig === "lightning"
      ? "Keine Lightning-Wallet verbunden – im Wallet-Tab per NWC verbinden."
      : "Keine Solana-Wallet verbunden – im Wallet-Tab verbinden.");
  }
  return rail;
}

/** Zahlen ueber die passende Schiene – die eine Stelle, an der Geldfunktionen zahlen. */
export async function zahle(rails: readonly PaymentRail[], anfrage: Zahlanfrage): Promise<Beleg> {
  const rail = await waehleRail(rails, anfrage);
  pruefeAnfrage(rail.id, anfrage);
  return rail.pay(anfrage);
}

/**
 * Betrag in beiden Einheiten (Schritt 4.1, Punkt 4): Anzeige immer in Sats
 * und SOL. `lamportsProMsat` kommt aus dem Kurs (4.4); ohne Kurs nur die
 * eigene Einheit.
 */
export function inBeidenEinheiten(b: Betrag, lamportsProMsat?: number): { msat?: number; lamports?: number } {
  const kurs = lamportsProMsat !== undefined && Number.isFinite(lamportsProMsat) && lamportsProMsat > 0 ? lamportsProMsat : undefined;
  if (b.einheit === "msat") return { msat: b.wert, ...(kurs ? { lamports: Math.round(b.wert * kurs) } : {}) };
  return { lamports: b.wert, ...(kurs ? { msat: Math.round(b.wert / kurs) } : {}) };
}

/** Lesbar: "21 sats" bzw. "0,000005 SOL". */
export function betragText(b: Betrag): string {
  if (b.einheit === "msat") return b.wert % 1000 === 0 ? `${b.wert / 1000} sats` : `${b.wert} msat`;
  return `${(b.wert / 1e9).toLocaleString("de-DE", { maximumFractionDigits: 9 })} SOL`;
}
