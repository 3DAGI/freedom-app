/**
 * RPC-Pool: die Kettenanbindung hängt nicht mehr an einem Anbieter.
 *
 * DAS PROBLEM
 * `https://api.mainnet-beta.solana.com` stand achtmal fest verdrahtet im Code.
 * Das ist der Endpunkt eines einzelnen Unternehmens, mit Ratenbegrenzung und
 * Sperrmöglichkeit. Fällt er aus oder blockiert er, funktionieren Deposits,
 * Swaps und die Deposit-Prüfung nicht mehr — und der Nutzer sieht nur, dass
 * „irgendetwas nicht geht".
 *
 * Das ist derselbe Fehler wie bei den Relays, nur eine Schicht tiefer: eine
 * Abhängigkeit von Fremden, die dem Projekt nichts schulden.
 *
 * WIE ES JETZT LÄUFT
 * Mehrere Endpunkte, der Reihe nach probiert, mit gemerkter Ausfallhistorie.
 * Ein Endpunkt, der gerade nicht antwortet, wird für eine Weile übersprungen
 * statt bei jeder Anfrage erneut auf ein Timeout zu laufen. Nutzer können
 * eigene Endpunkte hinterlegen — wer einen eigenen Knoten betreibt, sollte ihn
 * benutzen können.
 *
 * WAS BEWUSST NICHT PASSIERT
 * Kein Vergleich der Antworten mehrerer Endpunkte. Das klingt sicherer, ist
 * aber teuer und löst das eigentliche Problem nicht: Wer einen manipulierten
 * RPC benutzt, hat vor allem ein Verfügbarkeitsproblem, kein Konsensproblem —
 * die Kette selbst entscheidet, und eine gefälschte Antwort führt zu einer
 * abgelehnten Transaktion, nicht zu einem Verlust.
 */

export interface RpcEndpoint {
  url: string;
  /** Beschreibung für die Anzeige, z. B. "eigener Knoten". */
  label?: string;
}

export interface RpcPoolOptions {
  timeoutMs?: number;
  /** Wie lange ein ausgefallener Endpunkt übersprungen wird. */
  cooldownMs?: number;
  /** Eigene Endpunkte des Nutzers — kommen zuerst. */
  userEndpoints?: string[];
  fetchImpl?: typeof fetch;
}

/**
 * Voreinstellung für Mainnet.
 *
 * Bewusst mehrere Anbieter, nicht mehrere Adressen desselben: Redundanz gegen
 * Ausfall hilft nichts, wenn alle Endpunkte derselben Partei gehören und diese
 * Partei sperrt.
 */
export const DEFAULT_MAINNET_RPCS: RpcEndpoint[] = [
  { url: "https://api.mainnet-beta.solana.com", label: "Solana Labs" },
  { url: "https://solana-rpc.publicnode.com", label: "PublicNode" },
  { url: "https://solana.drpc.org", label: "dRPC" },
  { url: "https://rpc.ankr.com/solana", label: "Ankr" },
];

export const DEFAULT_DEVNET_RPCS: RpcEndpoint[] = [
  { url: "https://api.devnet.solana.com", label: "Solana Labs (devnet)" },
];

interface EndpointState {
  url: string;
  label?: string;
  /** Zeitpunkt, ab dem der Endpunkt wieder probiert wird. */
  skipUntil: number;
  failures: number;
  lastLatencyMs?: number;
  lastError?: string;
}

export interface PoolStatus {
  url: string;
  label?: string;
  available: boolean;
  failures: number;
  lastLatencyMs?: number;
  lastError?: string;
}

export class RpcPool {
  private states: EndpointState[];
  private readonly timeoutMs: number;
  private readonly cooldownMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(endpoints: RpcEndpoint[] = DEFAULT_MAINNET_RPCS, opts: RpcPoolOptions = {}) {
    // Eigene Endpunkte zuerst: Wer einen eigenen Knoten betreibt, soll ihn
    // auch benutzen — nicht als letzten Ausweg.
    const eigene = (opts.userEndpoints ?? [])
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//.test(u))
      .map((url) => ({ url, label: "eigener Knoten" }));

    const alle = [...eigene, ...endpoints];
    const gesehen = new Set<string>();
    this.states = alle
      .filter((e) => (gesehen.has(e.url) ? false : (gesehen.add(e.url), true)))
      .map((e) => ({ url: e.url, label: e.label, skipUntil: 0, failures: 0 }));

    if (this.states.length === 0) throw new Error("RpcPool braucht mindestens einen Endpunkt");
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.cooldownMs = opts.cooldownMs ?? 60_000;
    // Nicht `fetch` selbst speichern: Als Methode dieses Objekts aufgerufen,
    // wirft es im Browser „Illegal invocation“ (Node merkt das nicht).
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  get urls(): string[] {
    return this.states.map((s) => s.url);
  }

  status(now = Date.now()): PoolStatus[] {
    return this.states.map((s) => ({
      url: s.url,
      label: s.label,
      available: s.skipUntil <= now,
      failures: s.failures,
      lastLatencyMs: s.lastLatencyMs,
      lastError: s.lastError,
    }));
  }

  /** Endpunkte in der Reihenfolge, in der sie probiert werden. */
  private candidates(now: number): EndpointState[] {
    const frei = this.states.filter((s) => s.skipUntil <= now);
    // Sind alle in der Sperrfrist, wird trotzdem probiert — lieber ein
    // wahrscheinlicher Fehlschlag als gar kein Versuch.
    const liste = frei.length > 0 ? frei : [...this.states];
    return liste.sort((a, b) => a.failures - b.failures || (a.lastLatencyMs ?? 0) - (b.lastLatencyMs ?? 0));
  }

  /**
   * Führt einen JSON-RPC-Aufruf aus und weicht bei Ausfall aus.
   *
   * Wirft erst, wenn ALLE Endpunkte gescheitert sind — und nennt dann alle
   * Gründe. Eine Fehlermeldung „konnte nicht verbinden" ohne Angabe, was
   * womit schiefging, kostet bei der Fehlersuche Stunden.
   */
  async call<T>(method: string, params: unknown[] = [], now = Date.now()): Promise<T> {
    const fehler: string[] = [];

    for (const s of this.candidates(now)) {
      const start = Date.now();
      try {
        const res = await this.fetchImpl(s.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = (await res.json()) as { result?: T; error?: { message?: string; code?: number } };
        if (json.error) {
          // Ein fachlicher Fehler der Kette ist KEIN Endpunktproblem — ihn an
          // den nächsten Endpunkt weiterzureichen würde nur Zeit kosten und
          // dort dieselbe Antwort ergeben.
          throw Object.assign(new Error(json.error.message ?? `RPC-Fehler ${json.error.code}`), {
            rpcLevel: true,
          });
        }

        s.failures = 0;
        s.lastLatencyMs = Date.now() - start;
        s.lastError = undefined;
        return json.result as T;
      } catch (e) {
        const err = e as Error & { rpcLevel?: boolean };
        if (err.rpcLevel) throw err;

        s.failures += 1;
        s.lastError = err.message;
        s.lastLatencyMs = Date.now() - start;
        // Wiederholt ausgefallene Endpunkte länger überspringen, damit ein
        // dauerhaft toter Anbieter nicht jede Anfrage verzögert.
        s.skipUntil = now + this.cooldownMs * Math.min(s.failures, 5);
        fehler.push(`${s.label ?? s.url}: ${err.message}`);
      }
    }

    throw new Error(
      `Kein Solana-Endpunkt erreichbar (${this.states.length} versucht). ` + fehler.join(" | "),
    );
  }

  async getBalance(pubkey: string): Promise<number> {
    const r = await this.call<{ value?: number }>("getBalance", [pubkey]);
    return r?.value ?? 0;
  }

  async getSlot(): Promise<number> {
    return this.call<number>("getSlot");
  }

  /** Prüft alle Endpunkte und meldet, welche antworten. */
  async healthCheck(): Promise<PoolStatus[]> {
    await Promise.all(
      this.states.map(async (s) => {
        const start = Date.now();
        try {
          const res = await this.fetchImpl(s.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [] }),
            signal: AbortSignal.timeout(this.timeoutMs),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await res.json();
          s.failures = 0;
          s.skipUntil = 0;
          s.lastLatencyMs = Date.now() - start;
          s.lastError = undefined;
        } catch (e) {
          s.failures += 1;
          s.lastError = (e as Error).message;
          s.skipUntil = Date.now() + this.cooldownMs;
        }
      }),
    );
    return this.status();
  }

  /**
   * Der aktuell beste Endpunkt als URL.
   *
   * Für Bibliotheken, die eine feste URL erwarten (`@solana/web3.js`). Der
   * Ausweichmechanismus greift dort nicht — deshalb ist es besser, vorher
   * einmal zu prüfen, als eine tote Adresse zu übergeben.
   */
  bestUrl(now = Date.now()): string {
    return this.candidates(now)[0].url;
  }
}

/** Liest zusätzliche Endpunkte aus einer Nutzereingabe (kommagetrennt). */
export function parseUserEndpoints(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\/.+/.test(s))
    .slice(0, 5);
}
