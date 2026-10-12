/**
 * Modelle in der Selbstprüfung (Schritt E9-3b, Entwurf `docs/E9-ENTWURF.md`,
 * V3 A): `pruefeModelle()` sagt je Modell, wie es steht – geprüft gegen ein
 * Manifest, ungeprüft angeboten (`PROVIDER_MODELS`), bei Ollama verändert oder
 * verschwunden, gewünscht und wartend, oder warum das Laden scheiterte.
 *
 * Wie die Befunde aus `einrichtung.ts` (B-11c) nur Kennung (`fall`), Zahlen,
 * Fehlernamen – dazu der Modellname. Sie gehen an `npm run pruefen`, an
 * `npm run modell` und in den Status an den Besitzer (5077, Feld
 * `modellPruefung`); die App hat je Kennung einen Text, ein Test vergleicht die
 * Listen. Nie Text aus Ollama oder der Registry.
 */
import type { Stufe } from "./einrichtung.js";
import type { AntriebArt } from "./ki-antrieb.js";
import { type GeprueftesModell, type ModellStand, type Wunsch, offeneWuensche } from "./modell-laden.js";

export interface ModellPruefBefund {
  name: string;
  stufe: Stufe;
  fall: string;
  werte?: Record<string, number | string>;
  /** Satz fürs Log und `npm run pruefen`. */
  text: string;
}

/** Was der Knoten aus der Umgebung anbietet (`PROVIDER_MODELS`, sonst `OLLAMA_MODEL`) – ohne Prüfung gegen ein Manifest. */
export const providerModelle = (env: { PROVIDER_MODELS?: string; OLLAMA_MODEL?: string }): string[] => [...new Set(
  (env.PROVIDER_MODELS ?? env.OLLAMA_MODEL ?? "nemotron-3.5-lightning:30b-a3b-nvfp4").split(",").map((m) => m.trim()).filter(Boolean),
)];

/** Kennung eines Ladeergebnisses (`manifest.keins` …) als Befund: `modell.manifestKeins`. */
export const modellFall = (fall: string): string => `modell.${fall.replace(/\.([a-z])/g, (_, c: string) => c.toUpperCase())}`;

const gb = (bytes: unknown): string => (Number(bytes) / 1e9).toLocaleString("de-DE", { maximumFractionDigits: 1 });

/** Satz je Kennung – auch für `npm run modell`. Die App übersetzt die Kennungen selbst (`MODELL_TEXT` dort). */
export const MODELL_TEXT: Record<string, (w: Record<string, number | string>) => string> = {
  "modell.geprueft": (w) => `geprüft gegen das Manifest (${w.dateien} Dateien, ${gb(w.bytes)} GB), im Angebot`,
  "modell.ungeprueft": () => "angeboten, aber nicht gegen ein Manifest geprüft (PROVIDER_MODELS) – prüfen: npm run modell -- <name> --aus-registry",
  "modell.ordnerVeraendert": () => "im Ordner des Modells hat sich etwas geändert – nicht im Angebot, bis es neu geprüft ist: npm run modell -- <org/repo>",
  "modell.veraendert": () => "Ollama hat unter diesem Namen inzwischen etwas anderes als das Geprüfte – nicht im Angebot",
  "modell.fehltBeiOllama": () => "Ollama kennt das Modell nicht – nicht im Angebot",
  "modell.fehltImAngebot": () => "Ollama kennt keins der angebotenen Modelle – es bleibt im Angebot, Aufträge dafür scheitern",
  "modell.ollamaStumm": () => "Ollama antwortete nicht – Stand ungewiss",
  "modell.fehltBeimAntrieb": () => "der KI-Antrieb (KI_URL) kennt das Modell nicht – nicht im Angebot",
  "modell.antriebKenntKeins": () => "der KI-Antrieb kennt keins der angebotenen Modelle – es bleibt im Angebot, Aufträge dafür scheitern",
  "modell.antriebStumm": () => "der KI-Antrieb antwortete nicht – Stand ungewiss",
  "modell.nurOllama": () => "geprüft über Ollama geladen – mit diesem KI-Antrieb nicht im Angebot",
  "modell.nurAntrieb": () => "von Hugging Face geladen – bedient nur ein OpenAI-kompatibler KI-Antrieb, mit Ollama nicht im Angebot",
  "modell.ungeprueftAntrieb": () => "angeboten, aber nicht gegen ein Manifest geprüft (PROVIDER_MODELS) – prüfen: npm run modell -- <org/repo> --aus-hf",
  "modell.ladenNurOllama": () => "gewünscht über Ollama – mit diesem KI-Antrieb lädt der Knoten nur von Hugging Face (npm run modell -- <org/repo>)",
  "modell.ladenNurAntrieb": () => "gewünscht von Hugging Face – das geht nur mit einem OpenAI-kompatiblen KI-Antrieb (KI_ANTRIEB=openai)",
  "modell.wartet": () => "gewünscht, wartet auf den Knoten",
  "modell.manifestKeins": () => "kein eigenes Manifest des Knotens – festhalten, was die Quelle jetzt nennt: npm run modell -- <name> --aus-registry bzw. --aus-hf",
  "modell.manifestUneinig": (w) => `${w.herausgeber} Herausgeber nennen verschiedene Dateien – keine Wahl`,
  "modell.manifestKeineQuelle": () => "das Manifest nennt keine passende Quelle zu diesem Namen (upstream ollama:<name> bzw. hf:<org/repo>@<commit>)",
  "modell.manifestNichtVeroeffentlicht": (w) => `eigenes Manifest nicht veröffentlicht (${w.fehler}) – nichts geladen`,
  "modell.registryNichtErreichbar": () => "die Registry war nicht zu befragen – nichts festgehalten, nichts geladen",
  "modell.passtNicht": (w) => `braucht etwa ${w.brauchtGb} GB, das Gerät hat ${w.hatGb} GB (MODELL_SPEICHER_GB)`,
  "modell.registryAnders": () => "die Registry nennt andere Dateien als das Manifest – nichts geladen",
  "modell.ollamaLaden": (w) => `Ollama hat nicht geladen (${w.fehler})`,
  "modell.ollamaFehlt": () => "nach dem Laden nicht in Ollama",
  "modell.schichtForm": () => "Ollama meldet Schichten ohne gültige Summe – nicht angeboten",
  "modell.schichtFremd": (w) => `${w.anzahl} geladene Schicht(en) stehen nicht im Manifest – nicht angeboten`,
  "modell.schichtGroesse": (w) => `${w.anzahl} Schicht(en) mit anderer Größe als im Manifest – nicht angeboten`,
  "modell.schichtFehlt": (w) => `${w.anzahl} Datei(en) des Manifests hat Ollama nicht geladen – nicht angeboten`,
  "modell.hfForm": () => "Hugging Face antwortete in unerwarteter Form – nichts festgehalten, nichts geladen",
  "modell.hfOhneGewichte": () => "das Repo hat keine safetensors oder keine config.json – der Knoten lädt kein Pickle und kein Python",
  "modell.hfAnders": (w) => `Hugging Face nennt ${w.anzahl} Datei(en) anders als das Manifest – nichts geladen`,
  "modell.hfZuGross": () => "eine kleine Datei ohne Summe von Hugging Face ist zu groß zum Prüfen – nichts festgehalten",
  "modell.hfNichtErreichbar": (w) => `Hugging Face war nicht zu befragen (${w.fehler}) – nichts festgehalten, nichts geladen`,
  "modell.hfLaden": (w) => `Laden von Hugging Face abgebrochen (${w.fehler}) – nicht angeboten`,
  "modell.dateiFremd": (w) => `${w.anzahl} Datei(en) im Ordner stehen nicht im Manifest – nicht angeboten`,
  "modell.dateiSumme": (w) => `${w.anzahl} Datei(en) mit anderer Summe als im Manifest – nicht angeboten`,
  "modell.dateiGroesse": (w) => `${w.anzahl} Datei(en) mit anderer Größe als im Manifest – nicht angeboten`,
  "modell.dateiFehlt": (w) => `${w.anzahl} Datei(en) des Manifests fehlen im Ordner – nicht angeboten`,
  "modell.fehler": (w) => `abgebrochen (${w.fehler})`,
};
export const modellText = (fall: string, werte: Record<string, number | string> = {}): string => MODELL_TEXT[fall]?.(werte) ?? fall;

/**
 * Modelle prüfen (E9-3b): geprüfte gegen den Fingerabdruck bei Ollama, die aus
 * `PROVIDER_MODELS` gegen die Namen bei Ollama (ohne Tag wie Ollama selbst
 * `:latest`), offene Wünsche und das letzte gescheiterte Laden je Name – ein
 * älteres Scheitern zählt nicht, wenn derselbe Name wieder gewünscht ist.
 * `ollama` ist null, wenn der Antrieb nicht antwortete.
 */
export function pruefeModelle(e: {
  angeboten: readonly string[];
  stand: ModellStand;
  wuensche: readonly Wunsch[];
  /** Was der Antrieb kennt (Ollama `/api/tags`, OpenAI-kompatibel `/v1/models`); null ohne Antwort. */
  ollama: ReadonlyArray<{ name: string; digest: string }> | null;
  /** Seit B-29a: Ollama lädt über Ollama, ein OpenAI-kompatibler Antrieb seit B-29c1b von Hugging Face. */
  antrieb?: AntriebArt;
  /** Seit B-29c1b: ist der Ordner eines Modells von Hugging Face unverändert (`ordnerAbdruck()`)? */
  ordnerUnveraendert?: (m: GeprueftesModell) => boolean;
}): ModellPruefBefund[] {
  const b = (name: string, stufe: Stufe, fall: string, werte?: Record<string, number | string>): ModellPruefBefund =>
    ({ name, stufe, fall, ...(werte ? { werte } : {}), text: modellText(fall, werte) });
  const aus: ModellPruefBefund[] = [];
  const openai = e.antrieb === "openai";
  const fehlt = openai ? "modell.fehltBeimAntrieb" : "modell.fehltBeiOllama";
  const stumm = openai ? "modell.antriebStumm" : "modell.ollamaStumm";
  // Geprüft heißt: über die Quelle dieses Antriebs – Ollama in Ollama, sonst Hugging Face im Ordner
  const passt = (m: GeprueftesModell) => (m.quelle === "hf") === openai;
  const geprueft = new Set(e.stand.modelle.filter(passt).map((m) => m.name));
  for (const m of e.stand.modelle) {
    if (!passt(m)) {
      aus.push(b(m.name, "hinweis", openai ? "modell.nurOllama" : "modell.nurAntrieb"));
      continue;
    }
    if (openai) {
      aus.push(!e.ollama ? b(m.name, "hinweis", "modell.antriebStumm")
        : !e.ollama.some((x) => x.name === m.name) ? b(m.name, "fehler", "modell.fehltBeimAntrieb")
          : !(e.ordnerUnveraendert?.(m) ?? true) ? b(m.name, "fehler", "modell.ordnerVeraendert")
            : b(m.name, "ok", "modell.geprueft", { dateien: m.dateien, bytes: m.bytes }));
      continue;
    }
    const t = e.ollama?.find((x) => x.name === m.name);
    aus.push(!e.ollama ? b(m.name, "hinweis", "modell.ollamaStumm")
      : !t ? b(m.name, "fehler", "modell.fehltBeiOllama")
        : t.digest !== m.ollama ? b(m.name, "fehler", "modell.veraendert")
          : b(m.name, "ok", "modell.geprueft", { dateien: m.dateien, bytes: m.bytes }));
  }
  const hat = (n: string) => e.ollama?.some((x) => x.name === n || (!n.includes(":") && x.name === `${n}:latest`));
  // Kennt Ollama gar keins, bleibt die Liste im Angebot (`nurBeiOllama()`, B-41) – dann scheitern die Aufträge
  const keins = !aus.some((x) => x.fall === "modell.geprueft") && ![...e.angeboten].some(hat);
  for (const n of new Set(e.angeboten)) {
    if (geprueft.has(n)) continue;
    aus.push(!e.ollama ? b(n, "hinweis", stumm) : hat(n) ? b(n, "hinweis", openai ? "modell.ungeprueftAntrieb" : "modell.ungeprueft")
      : b(n, "fehler", keins ? (openai ? "modell.antriebKenntKeins" : "modell.fehltImAngebot") : fehlt));
  }
  const offen = offeneWuensche(e.wuensche, e.stand);
  for (const w of offen) {
    if (w.name === e.stand.laeuft?.name) continue;
    const hf = w.quelle === "hf";
    aus.push(b(w.name, "hinweis", hf === openai ? "modell.wartet" : openai ? "modell.ladenNurOllama" : "modell.ladenNurAntrieb"));
  }
  for (const r of e.stand.ergebnisse) {
    if (r.fall !== "ok" && !offen.some((w) => w.name === r.name)) aus.push(b(r.name, "fehler", modellFall(r.fall), r.werte));
  }
  return aus;
}

const ZEICHEN: Record<Stufe, string> = { ok: "✓", hinweis: "!", fehler: "✗" };

export function modellBefundeText(befunde: readonly ModellPruefBefund[]): string {
  return befunde.map((x) => `${ZEICHEN[x.stufe]} Modell ${x.name}: ${x.text}`).join("\n");
}
