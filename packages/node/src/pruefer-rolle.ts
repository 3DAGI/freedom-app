/**
 * Prüfer-Rolle des Knotens (Freedom-Prüfung P3a, E7, `docs/FREEDOM-PRUEFUNG.md` 3.2)
 * – der Kern ohne Netz: Zeitplan, Prüffrage bauen, Antwort auswerten, Buch, Bericht.
 *
 * Der Prüfer stellt Providern synthetische Prüffragen (`neuePruefFrage()`), nie
 * Fragen von Nutzern – wie jeder Kunde: versiegelt (`buildPrivateJobRequest()`),
 * von einem Wegwerf-Schlüssel je Frage, damit ein Provider sie nicht von echten
 * Anfragen unterscheiden kann. Die Antwort prüft Code (`pruefeAntwort()`), kein
 * Sprachmodell. Je Provider und Modell entsteht ein Messbericht (38081,
 * `baueMessbericht()`): Zahlen, keine Fragen, keine Antworten, nichts über Kunden.
 *
 * Ohne Budget: Ob und wie ein Prüfer Prüffragen bezahlt, entscheidet der MENSCH
 * (der Knoten zahlt seit 5.1.2 nichts aus). Bis dahin prüft er nur Angebote, die
 * gerade gratis sind (Probezeit oder freiwillig, `currentlyFree`), mit Gebot 0.
 */
import {
  type Messbericht, type NostrEvent, type PruefArt, type PruefFrage, type UnsignedEvent,
  KIND_DVM_FEEDBACK, LocalSigner, PRUEF_ARTEN, PRUEF_GRENZEN, buildJobRequest, buildPrivateJobRequest,
  generateKeypair, getTag, isDvmResult, parseJobResult, pruefeAntwort, stufeAus,
} from "@freedomstack/protocol";

export const PRUEFER_TAKT = Object.freeze({
  /** So viele Prüffragen in der ersten Stunde (Grundtest). */
  grundtest: 20,
  grundtestSek: 3_600,
  /** Danach etwa so oft je Provider und Modell … */
  laufendSek: 300,
  /** … mit so viel Zufall im Abstand (±). */
  zufallSek: 60,
  /** Der Bericht zählt die Prüffragen dieses Zeitraums. */
  fensterSek: 24 * 3_600,
  /** Höchstens so viele Punkte je Provider und Modell. */
  punkteMax: 500,
  /** Höchstens so viele Ziele (Provider × Modell). */
  zieleMax: 200,
});

export interface PruefZiel { provider: string; modell: string }

const HEX64 = /^[0-9a-f]{64}$/;
const MODELL = /^[\x21-\x7e]{1,100}$/;
const schluessel = (z: PruefZiel) => `${z.provider}:${z.modell}`;

/**
 * Wer wann gefragt wird. Neue Ziele (erstmals gratis gesehen) beginnen den
 * Grundtest sofort; was nicht mehr gratis angeboten wird, fällt weg.
 */
export class PrueferPlan {
  private ziele = new Map<string, PruefZiel & { seit: number; gefragt: number; naechste: number }>();

  aktualisiere(angebote: ReadonlyArray<{ pubkey: string; models: readonly string[]; currentlyFree: boolean }>, jetzt: number, eigenerPk?: string): void {
    const gesehen = new Set<string>();
    for (const a of angebote) {
      if (!a.currentlyFree || !HEX64.test(a.pubkey) || a.pubkey === eigenerPk) continue;
      for (const modell of a.models) {
        if (!MODELL.test(modell)) continue;
        const z = { provider: a.pubkey, modell };
        gesehen.add(schluessel(z));
        if (!this.ziele.has(schluessel(z)) && this.ziele.size < PRUEFER_TAKT.zieleMax) {
          this.ziele.set(schluessel(z), { ...z, seit: jetzt, gefragt: 0, naechste: jetzt });
        }
      }
    }
    for (const k of [...this.ziele.keys()]) if (!gesehen.has(k)) this.ziele.delete(k);
  }

  /** Fällige Ziele, die längst fälligen zuerst – höchstens `max` je Runde. */
  faellige(jetzt: number, max: number): PruefZiel[] {
    return [...this.ziele.values()].filter((z) => z.naechste <= jetzt).sort((a, b) => a.naechste - b.naechste)
      .slice(0, max).map(({ provider, modell }) => ({ provider, modell }));
  }

  /** Nach dem Senden: im Grundtest gleichmäßig über die erste Stunde, danach etwa alle fünf Minuten. */
  gefragt(ziel: PruefZiel, jetzt: number, zufall: () => number): void {
    const z = this.ziele.get(schluessel(ziel));
    if (!z) return;
    z.gefragt++;
    const imGrundtest = z.gefragt < PRUEFER_TAKT.grundtest && jetzt < z.seit + PRUEFER_TAKT.grundtestSek;
    z.naechste = jetzt + (imGrundtest
      ? Math.floor(PRUEFER_TAKT.grundtestSek / PRUEFER_TAKT.grundtest)
      : PRUEFER_TAKT.laufendSek + Math.round((zufall() * 2 - 1) * PRUEFER_TAKT.zufallSek));
  }

  get anzahl(): number { return this.ziele.size; }
}

/** Eine Prüffrage als versiegelte Anfrage – je Frage ein neuer Schlüssel, Gebot 0. */
export async function bauePruefAuftrag(p: { ziel: PruefZiel; frage: PruefFrage; powBits?: number; jetzt: number }): Promise<{ wrap: NostrEvent; requestId: string; sitzung: LocalSigner }> {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const request = buildJobRequest({
    customerPubkey: sitzung.publicKey(), input: p.frage.frage, bidMsat: 0,
    providerPubkey: p.ziel.provider, params: [["model", p.ziel.modell]],
  }, p.jetzt);
  const { wrap, requestId } = await buildPrivateJobRequest({ request, sessionSigner: sitzung, providerPk: p.ziel.provider, powBits: p.powBits, nowSecs: p.jetzt });
  return { wrap, requestId, sitzung };
}

export interface PruefPunkt { zeit: number; art: PruefArt; ok: boolean; richtig?: boolean; ms?: number; tokensJeSek?: number }

/**
 * Eine geöffnete Antwort (`openPrivateJobResponse()`) auswerten. Ein Ergebnis
 * zählt als Erfolg, die Antwort prüft `pruefeAntwort()`; eine Fehlermeldung (7000
 * „error“) oder keine Antwort bis zur Frist (`antwort` undefiniert) als Ausfall.
 * Zwischenstände („processing“) sind keine Antwort – `null`, weiter warten.
 */
export function werteAntwortAus(frage: PruefFrage, antwort: UnsignedEvent | undefined, gesendetMs: number, jetztMs: number): PruefPunkt | null {
  const zeit = Math.floor(jetztMs / 1000);
  if (!antwort) return { zeit, art: frage.art, ok: false };
  if (antwort.kind === KIND_DVM_FEEDBACK) {
    return getTag(antwort, "status") === "error" ? { zeit, art: frage.art, ok: false } : null;
  }
  if (!isDvmResult(antwort.kind)) return null;
  let r: ReturnType<typeof parseJobResult>;
  try { r = parseJobResult(antwort); } catch { return { zeit, art: frage.art, ok: false }; }
  const ms = Math.max(0, Math.round(jetztMs - gesendetMs));
  const tokens = r.usage?.completionTokens;
  return {
    zeit, art: frage.art, ok: true, richtig: pruefeAntwort(frage, r.output), ms,
    ...(tokens && ms > 0 ? { tokensJeSek: Math.round(tokens / (ms / 1000)) } : {}),
  };
}

const median = (zahlen: number[]): number | undefined => {
  const s = [...zahlen].sort((a, b) => a - b);
  return s.length > 0 ? s[Math.floor((s.length - 1) / 2)] : undefined;
};

/** Ergebnisse je Provider und Modell – nur im Speicher, nur Zahlen. */
export class PrueferBuch {
  private punkte = new Map<string, PruefPunkt[]>();
  private zuZiel = new Map<string, PruefZiel>();

  merke(ziel: PruefZiel, p: PruefPunkt): void {
    const k = schluessel(ziel);
    this.zuZiel.set(k, ziel);
    this.punkte.set(k, [...(this.punkte.get(k) ?? []), p].slice(-PRUEFER_TAKT.punkteMax));
  }

  /** Ziele mit Punkten im Fenster – für die Berichte. */
  ziele(jetzt: number): PruefZiel[] {
    return [...this.zuZiel.entries()].filter(([k]) => (this.punkte.get(k) ?? []).some((p) => p.zeit > jetzt - PRUEFER_TAKT.fensterSek)).map(([, z]) => z);
  }

  /**
   * Der Bericht für `baueMessbericht()` – null ohne Prüffrage im Fenster. Die Stufe kommt aus den Zahlen.
   * Der Zeitraum endet mit der letzten Prüffrage (P4): Fällt ein Ziel aus dem Plan (nicht mehr gratis),
   * geht der Bericht noch bis zum Ende des Fensters hinaus – mit dem Zeitraum, den er wirklich misst.
   */
  bericht(ziel: PruefZiel, jetzt: number): Omit<Messbericht, "pruefer" | "zeit"> | null {
    const punkte = (this.punkte.get(schluessel(ziel)) ?? []).filter((p) => p.zeit > jetzt - PRUEFER_TAKT.fensterSek && p.zeit <= jetzt);
    if (punkte.length === 0) return null;
    const erfolge = punkte.filter((p) => p.ok);
    const treffer: Messbericht["treffer"] = {};
    for (const art of PRUEF_ARTEN) {
      const geprueft = erfolge.filter((p) => p.art === art);
      if (geprueft.length > 0) treffer[art] = { richtig: geprueft.filter((p) => p.richtig).length, geprueft: geprueft.length };
    }
    const tokens = median(erfolge.flatMap((p) => (p.tokensJeSek === undefined ? [] : [p.tokensJeSek])));
    return {
      provider: ziel.provider, modell: ziel.modell,
      von: Math.min(...punkte.map((p) => p.zeit)), bis: Math.max(...punkte.map((p) => p.zeit)),
      anfragen: punkte.length, erfolge: erfolge.length,
      medianMs: median(erfolge.flatMap((p) => (p.ms === undefined ? [] : [p.ms]))) ?? 0,
      ...(tokens === undefined ? {} : { tokensJeSek: tokens }),
      treffer,
      stufe: stufeAus(punkte.length, erfolge.length, PRUEF_GRENZEN.minPruefer),
    };
  }
}
