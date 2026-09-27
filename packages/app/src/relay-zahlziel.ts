/**
 * Zahladressen der Relays (Schritt 5.1.3b, Modell A+), ohne DOM.
 *
 * 1,5 % jeder KI-Zahlung gehen an die Relays, über die der Auftrag lief –
 * an höchstens drei, deren Betreiber eine Zahladresse nennt: sein Schlüssel
 * aus der Selbstauskunft (NIP-11 `pubkey`), die Lightning-Adresse aus seinem
 * Profil. Gelernt wird im Hintergrund und gemerkt (einen Tag, nach einem
 * Fehlschlag eine Stunde); beim Senden zählt nur, was schon bekannt ist – so
 * hält nichts einen Auftrag auf. Relays sehen die App ohnehin; neu ist nur
 * der Abruf ihrer Selbstauskunft über HTTPS.
 */
import { adresseFuer, normalizeRelayUrl, verifyEvent, type NostrEvent, type Zahlziel } from "@freedomstack/protocol";

export const LS_RELAY_ZAHLZIELE = "freedom.relays.zahlziele";
export const FRISCH_MS = 24 * 3600_000;
export const FEHLER_MS = 3600_000;
const MAX_EINTRAEGE = 100;
const MAX_INFO_BYTES = 100_000;

interface Eintrag { at: number; ok: boolean; lud16?: string }

/** Adresse der Selbstauskunft – nur für wss (ws und .onion erreicht der Browser so nicht). */
export function infoUrl(relay: string): string | undefined {
  try {
    const u = new URL(relay);
    if (u.protocol !== "wss:" || u.hostname.endsWith(".onion")) return undefined;
    u.protocol = "https:";
    return u.toString();
  } catch {
    return undefined;
  }
}

export class RelayZahlziele {
  private laeuft = false;

  constructor(private readonly p: {
    /** Profile (Kind 0) dieser Schlüssel. */
    profile: (autoren: string[]) => Promise<NostrEvent[]>;
    holen?: typeof fetch;
    speicher?: Pick<Storage, "getItem" | "setItem">;
    jetzt?: () => number;
    wartezeitMs?: number;
  }) {}

  /** Die bekannten Zahlziele dieser Relays, in ihrer Reihenfolge. */
  bekannte(relays: readonly string[]): Zahlziel[] {
    const m = this.lies();
    return relays.map((u) => m[normalizeRelayUrl(u)]?.lud16).filter((x): x is string => !!x).map((lud16) => ({ lud16 }));
  }

  /** Selbstauskunft und Betreiber-Profile holen, wo nichts Frisches gemerkt ist. */
  async lerne(relays: readonly string[]): Promise<void> {
    if (this.laeuft) return;
    this.laeuft = true;
    try {
      const jetzt = this.jetzt();
      const m = this.lies();
      const fehlen = [...new Set(relays.map(normalizeRelayUrl))]
        .filter((u) => { const e = m[u]; return !e || jetzt - e.at >= (e.ok ? FRISCH_MS : FEHLER_MS); })
        .slice(0, 8);
      if (fehlen.length === 0) return;
      const infos = await Promise.all(fehlen.map((u) => this.betreiber(u)));
      const pks = [...new Set(infos.map((i) => i.pk).filter((x): x is string => !!x))];
      const profile = pks.length > 0 ? await this.p.profile(pks).catch(() => null) : [];
      fehlen.forEach((u, i) => {
        const { ok, pk } = infos[i]!;
        if (!pk) { m[u] = { at: jetzt, ok }; return; }
        if (profile === null) { m[u] = { at: jetzt, ok: false }; return; }
        const neuestes = profile.filter((ev) => ev.kind === 0 && ev.pubkey === pk && verifyEvent(ev))
          .sort((a, b) => b.created_at - a.created_at)[0];
        let lud16: string | undefined;
        try { lud16 = adresseFuer({ lud16: (JSON.parse(neuestes?.content ?? "{}") as { lud16?: string }).lud16 }, "lightning"); } catch { /* kein Profil */ }
        m[u] = { at: jetzt, ok: true, ...(lud16 ? { lud16 } : {}) };
      });
      this.schreibe(m);
    } finally {
      this.laeuft = false;
    }
  }

  /** Schlüssel des Betreibers aus der Selbstauskunft; ok=false, wenn sie nicht erreichbar war. */
  private async betreiber(relay: string): Promise<{ ok: boolean; pk?: string }> {
    const url = infoUrl(relay);
    if (!url) return { ok: true };
    const holen = this.p.holen ?? ((i, o) => fetch(i, o));
    const abbruch = new AbortController();
    const uhr = setTimeout(() => abbruch.abort(), this.p.wartezeitMs ?? 5000);
    try {
      const r = await holen(url, { headers: { Accept: "application/nostr+json" }, signal: abbruch.signal });
      if (!r.ok) return { ok: false };
      const text = await r.text();
      if (text.length > MAX_INFO_BYTES) return { ok: true };
      const pk = (JSON.parse(text) as { pubkey?: unknown }).pubkey;
      return typeof pk === "string" && /^[0-9a-f]{64}$/.test(pk) ? { ok: true, pk } : { ok: true };
    } catch {
      return { ok: false };
    } finally {
      clearTimeout(uhr);
    }
  }

  private lies(): Record<string, Eintrag> {
    try {
      const roh = JSON.parse(this.p.speicher?.getItem(LS_RELAY_ZAHLZIELE) ?? "{}") as Record<string, Eintrag>;
      const m: Record<string, Eintrag> = {};
      for (const [u, e] of Object.entries(roh ?? {})) {
        if (!Number.isSafeInteger(e?.at) || typeof e.ok !== "boolean") continue;
        const lud16 = adresseFuer({ lud16: e.lud16 }, "lightning");
        m[u] = { at: e.at, ok: e.ok, ...(lud16 ? { lud16 } : {}) };
      }
      return m;
    } catch {
      return {};
    }
  }

  private schreibe(m: Record<string, Eintrag>): void {
    const neueste = Object.entries(m).sort(([, a], [, b]) => b.at - a.at).slice(0, MAX_EINTRAEGE);
    try { this.p.speicher?.setItem(LS_RELAY_ZAHLZIELE, JSON.stringify(Object.fromEntries(neueste))); } catch { /* voll – beim nächsten Mal */ }
  }

  private jetzt(): number {
    return this.p.jetzt?.() ?? Date.now();
  }
}
