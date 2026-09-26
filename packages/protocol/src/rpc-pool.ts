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
 * STICHPROBE STATT DAUERVERGLEICH (Schritt 5.8)
 * Nicht jede Antwort wird gegen einen zweiten Anbieter geprüft – das wäre
 * teuer, und die Kette entscheidet ohnehin: Eine gefälschte Antwort führt beim
 * Senden zu einer abgelehnten Transaktion. Was ein falscher Anbieter aber
 * kann: ein falsches Guthaben anzeigen oder eine andere Kette vorspielen.
 * Dagegen fragt `stichprobe()` gelegentlich einen zweiten Anbieter (anderer
 * Betreiber) nach Netz, letztem Blockhash und einem Kontostand; widersprechen
 * sich die beiden, meldet sie das als Warnung. Sie fängt einen Anbieter, der
 * plump lügt – nicht einen, der nur bei der Stichprobe schweigt.
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
  /**
   * Anfragen auf die fremden Anbieter verteilen (Schritt 4.9) statt immer den
   * schnellsten zu nehmen: Sonst sieht ein einziger Anbieter jede Adresse, die
   * die App abfragt, samt IP-Adresse. Eigene Endpunkte bleiben vorn – sie sind
   * keine fremde Partei.
   */
  verteilen?: boolean;
  /** Zufall fuer die Verteilung – nur fuer Tests. */
  zufall?: () => number;
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
  /** Vom Nutzer eingetragen – kommt beim Verteilen vor den fremden Anbietern. */
  eigen?: boolean;
  /** Zeitpunkt, ab dem der Endpunkt wieder probiert wird. */
  skipUntil: number;
  failures: number;
  lastLatencyMs?: number;
  lastError?: string;
}

/** Ergebnis von `RpcPool.stichprobe()` (Schritt 5.8). */
export interface StichprobeErgebnis {
  /** Die beiden verglichenen Endpunkte (Anzeigenamen) – weniger, wenn keine zwei antworteten. */
  anbieter: string[];
  /** Was tatsächlich verglichen wurde. */
  verglichen: Array<"netz" | "blockhash" | "kontostand">;
  /** Widersprüche zwischen den beiden – nicht leer heißt: Warnung zeigen. */
  warnungen: string[];
  /** Was sich nicht vergleichen ließ – kein Befund, aber auch keine Entwarnung. */
  hinweise: string[];
}

/** JSON-RPC-Fehler „Minimum context slot has not been reached“: Der Endpunkt hinkt hinterher. */
const MIN_SLOT_NICHT_ERREICHT = -32016;

const istHash = (x: unknown): x is string => typeof x === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
const istSlot = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;

/** Betreiber eines Endpunkts, grob: die letzten zwei Namensteile (`api.mainnet-beta.solana.com` → `solana.com`). */
function betreiber(url: string): string {
  const host = new URL(url).hostname;
  return /^[\d.]+$|^\[|^localhost$/.test(host) ? host : host.split(".").slice(-2).join(".");
}

/** Bekannte Genesis-Hashes – nur für die Anzeige; verglichen wird der Hash selbst. */
const NETZE: Record<string, string> = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "Mainnet",
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: "Devnet",
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY": "Testnet",
};
const netzName = (genesis: string) => NETZE[genesis] ?? "unbekanntes Netz";

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
  private readonly verteilen: boolean;
  private readonly zufall: () => number;

  constructor(endpoints: RpcEndpoint[] = DEFAULT_MAINNET_RPCS, opts: RpcPoolOptions = {}) {
    // Eigene Endpunkte zuerst: Wer einen eigenen Knoten betreibt, soll ihn
    // auch benutzen — nicht als letzten Ausweg.
    const eigene = (opts.userEndpoints ?? [])
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//.test(u))
      .map((url) => ({ url, label: "eigener Knoten", eigen: true }));

    const alle = [...eigene, ...endpoints];
    const gesehen = new Set<string>();
    this.states = alle
      .filter((e) => (gesehen.has(e.url) ? false : (gesehen.add(e.url), true)))
      .map((e) => ({ url: e.url, label: e.label, eigen: "eigen" in e && e.eigen === true, skipUntil: 0, failures: 0 }));

    if (this.states.length === 0) throw new Error("RpcPool braucht mindestens einen Endpunkt");
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.cooldownMs = opts.cooldownMs ?? 60_000;
    // Nicht `fetch` selbst speichern: Als Methode dieses Objekts aufgerufen,
    // wirft es im Browser „Illegal invocation“ (Node merkt das nicht).
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.verteilen = opts.verteilen ?? false;
    this.zufall = opts.zufall ?? Math.random;
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
    if (this.verteilen) {
      // Eigene vorn, dann die fremden in zufaelliger Reihenfolge (weniger Fehler zuerst).
      const los = new Map(liste.map((s) => [s, this.zufall()]));
      return liste.sort((a, b) => Number(!!b.eigen) - Number(!!a.eigen) || a.failures - b.failures || los.get(a)! - los.get(b)!);
    }
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
        const result = await this.anfrage<T>(s, method, params);
        s.failures = 0;
        s.lastLatencyMs = Date.now() - start;
        s.lastError = undefined;
        return result;
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

  /** Ein JSON-RPC-Aufruf an genau einen Endpunkt – ohne Ausweichen. */
  private async anfrage<T>(s: EndpointState, method: string, params: unknown[]): Promise<T> {
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
        code: json.error.code,
      });
    }
    return json.result as T;
  }

  /**
   * Stichprobe (Schritt 5.8): Zwei Endpunkte verschiedener Betreiber – der
   * erste in der üblichen Reihenfolge (eigener Knoten zuerst) und ein zweiter
   * Anbieter – nach Netz (Genesis-Hash), letztem Blockhash (je in beide
   * Richtungen) und, wenn `konto` angegeben ist, dessen Kontostand fragen.
   *
   * `warnungen` sind Widersprüche: Einer der beiden liefert Falsches oder hängt
   * an einer anderen Kette. `hinweise` nennen, was sich nicht vergleichen ließ
   * (kein zweiter Anbieter, einer antwortet nicht oder hinkt hinterher) – das
   * ist keine Entwarnung, aber auch kein Befund.
   *
   * Ohne `konto` verrät die Stichprobe nichts über den Nutzer. Mit `konto`
   * sieht auch der zweite Anbieter diese eine Adresse – wie jede verteilte
   * Abfrage (4.9) es ohnehin tut, nie mehrere Adressen zusammen.
   */
  async stichprobe(opts: { konto?: string; now?: number } = {}): Promise<StichprobeErgebnis> {
    const erg: StichprobeErgebnis = { anbieter: [], verglichen: [], warnungen: [], hinweise: [] };
    const name = (s: EndpointState) => s.label ?? new URL(s.url).hostname;
    const grund = (e: unknown) =>
      (e as { code?: number }).code === MIN_SLOT_NICHT_ERREICHT ? "hinkt hinterher" : (e as Error).message;

    // Zwei antwortende Endpunkte verschiedener Betreiber, gleiches Netz.
    const paar: Array<{ s: EndpointState; genesis: string }> = [];
    for (const s of this.candidates(opts.now ?? Date.now())) {
      if (paar.length === 2) break;
      if (paar.some((p) => betreiber(p.s.url) === betreiber(s.url))) continue;
      try {
        const genesis = await this.anfrage<unknown>(s, "getGenesisHash", []);
        if (!istHash(genesis)) throw new Error("unerwartete Antwort");
        paar.push({ s, genesis });
      } catch (e) {
        erg.hinweise.push(`${name(s)}: ${grund(e)}`);
      }
    }
    erg.anbieter = paar.map((p) => name(p.s));
    if (paar.length < 2) {
      erg.hinweise.push("Kein zweiter Anbieter erreichbar – keine Stichprobe möglich.");
      return erg;
    }
    const [a, b] = paar as [(typeof paar)[0], (typeof paar)[0]];
    erg.verglichen.push("netz");
    if (a.genesis !== b.genesis) {
      erg.warnungen.push(
        `${name(a.s)} (${netzName(a.genesis)}) und ${name(b.s)} (${netzName(b.genesis)}) hängen an verschiedenen Ketten – prüfe die eingetragenen Endpunkte.`,
      );
      return erg;
    }

    // Letzter Blockhash: Kennt der andere ihn? In beide Richtungen, damit
    // jeder der beiden einmal geprüft wird.
    let blockhashVerglichen = false;
    for (const [von, bei] of [[a, b], [b, a]] as const) {
      try {
        const lb = await this.anfrage<{ context?: { slot?: unknown }; value?: { blockhash?: unknown } }>(von.s, "getLatestBlockhash", [{ commitment: "finalized" }]);
        const slot = lb?.context?.slot;
        const hash = lb?.value?.blockhash;
        if (!istSlot(slot) || !istHash(hash)) throw new Error("unerwartete Antwort");
        const g = await this.anfrage<{ value?: unknown }>(bei.s, "isBlockhashValid", [hash, { commitment: "confirmed", minContextSlot: slot }]);
        if (typeof g?.value !== "boolean") throw new Error("unerwartete Antwort");
        blockhashVerglichen = true;
        if (!g.value) {
          erg.warnungen.push(`${name(bei.s)} kennt den letzten Blockhash von ${name(von.s)} nicht – einer der beiden liefert eine falsche Kette.`);
        }
      } catch (e) {
        erg.hinweise.push(`Blockhash ${name(von.s)} → ${name(bei.s)}: ${grund(e)}`);
      }
    }
    if (blockhashVerglichen) erg.verglichen.push("blockhash");

    if (opts.konto !== undefined) {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(opts.konto)) {
        erg.hinweise.push("Kontostand: keine gültige Solana-Adresse.");
        return erg;
      }
      try {
        const k = await this.vergleicheKontostand(a.s, b.s, opts.konto);
        erg.verglichen.push("kontostand");
        if (k) erg.warnungen.push(`Kontostand weicht ab: ${name(a.s)} meldet ${k[0]} Lamports, ${name(b.s)} ${k[1]}.`);
      } catch (e) {
        erg.hinweise.push(`Kontostand: ${grund(e)}`);
      }
    }
    return erg;
  }

  /**
   * Kontostand bei beiden abfragen; weichen die Werte ab, bis zu zweimal ab
   * dem höheren Stand (`minContextSlot`) wiederholen – dazwischen darf sich
   * das Konto geändert haben. Liefert die Werte nur, wenn sie bis zuletzt
   * abweichen.
   */
  private async vergleicheKontostand(a: EndpointState, b: EndpointState, konto: string): Promise<[number, number] | null> {
    let ab: number | undefined;
    let werte: [number, number] = [0, 0];
    for (let runde = 0; runde < 3; runde++) {
      const opt = { commitment: "finalized", ...(ab !== undefined ? { minContextSlot: ab } : {}) };
      const [x, y] = await Promise.all([a, b].map(async (s) => {
        const r = await this.anfrage<{ context?: { slot?: unknown }; value?: unknown }>(s, "getBalance", [konto, opt]);
        if (!istSlot(r?.context?.slot) || !Number.isSafeInteger(r?.value) || (r.value as number) < 0) throw new Error("unerwartete Antwort");
        return { slot: r.context!.slot as number, wert: r.value as number };
      })) as [{ slot: number; wert: number }, { slot: number; wert: number }];
      if (x.wert === y.wert) return null;
      werte = [x.wert, y.wert];
      ab = Math.max(x.slot, y.slot);
    }
    return werte;
  }

  /**
   * Transaktion mit aufgeschluesselten Anweisungen (Schritt 4.7) – fuer die
   * Pruefung von Belegen; null, solange die Kette sie nicht kennt.
   */
  async getTransaction(signatur: string): Promise<unknown> {
    return this.call("getTransaction", [signatur, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
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
