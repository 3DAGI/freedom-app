/**
 * Modell laden lassen (Schritt E9-3a): `npm run modell -- <name>` im Ordner
 * `packages/node`, mit derselben Umgebung wie der Knoten. Merkt nur den Wunsch
 * vor – der laufende Knoten sucht sein eigenes Manifest über seine Relays,
 * prüft, lädt und bietet das Modell erst nach bestandener Prüfung an. Mit
 * `--aus-registry` hält er vorher fest, was die Registry jetzt nennt (eigenes
 * Manifest, signiert und veröffentlicht). Ohne Namen: der Stand.
 *
 * Seit B-29c1b mit einem OpenAI-kompatiblen Antrieb (`KI_ANTRIEB=openai`): der
 * Name ist eine Kennung bei Hugging Face (`org/repo`), `--aus-hf` hält fest,
 * was Hugging Face jetzt nennt; geladen wird in `MODELL_ORDNER`. Seit B-29c2c mit
 * `TORRENT=1` zuerst aus dem Schwarm; `--magnet <link>` nennt einen Magnet dazu
 * (etwa von Pirate Face) – geprüft wird auch dann gegen das Manifest.
 */
import { leseStand, leseWuensche, merkeWunsch, modellDatei, offeneWuensche, wunschDatei } from "./modell-laden.js";
import { modellFall, modellText } from "./modell-pruefung.js";

// Die Sätze je Kennung teilt sich die Kommandozeile mit der Selbstprüfung (E9-3b, `modell-pruefung.ts`)
const text = (fall: string, werte: Record<string, number | string> = {}) => modellText(modellFall(fall), werte);

const args = process.argv.slice(2);
const hf = process.env.KI_ANTRIEB?.trim() === "openai";
const ausQuelle = args.includes(hf ? "--aus-hf" : "--aus-registry");
const mi = args.indexOf("--magnet");
const magnet = mi >= 0 ? args[mi + 1] ?? "" : undefined;
const name = args.find((a, i) => !a.startsWith("--") && i !== mi + 1);
if (name) {
  const gemerkt = merkeWunsch(wunschDatei(), name, undefined, ausQuelle, hf ? "hf" : "ollama", magnet);
  if (!gemerkt) {
    console.error(magnet !== undefined
      ? "Kein gültiger Magnet (magnet:?xt=urn:btih:…) – oder kein Modell von Hugging Face (nur mit KI_ANTRIEB=openai)."
      : hf ? "Keine Kennung wie bei Hugging Face (org/repo)."
        : "Kein Modellname wie bei Ollama (name:tag oder namensraum/name:tag).");
    process.exit(1);
  }
  const quelle = hf ? "Hugging Face" : "die Registry";
  console.log(ausQuelle
    ? `Vorgemerkt: ${gemerkt}. Der laufende Knoten hält fest, was ${quelle} jetzt nennt (eigenes Manifest), lädt und prüft;`
    : `Vorgemerkt: ${gemerkt}. Der laufende Knoten sucht sein Manifest, prüft und lädt;`);
  console.log("im Angebot steht das Modell erst nach bestandener Prüfung. Stand: npm run modell");
} else {
  const stand = leseStand(modellDatei());
  for (const m of stand.modelle) {
    const wo = m.quelle === "hf" ? `, im Ordner ${m.ordner}` : "";
    console.log(`✓ ${m.name} – ${m.dateien} Dateien, ${(m.bytes / 1e9).toFixed(1)} GB, Manifest von ${m.herausgeber.slice(0, 12)}…${wo}`);
    // Die Id für einen Modellkatalog (E9-4): Knoten, die ihm folgen, laden dann genau diese Dateien
    console.log(`  Manifest-Id: ${m.manifest}`);
  }
  if (stand.laeuft) {
    const l = stand.laeuft;
    const prozent = l.gesamt ? ` ${Math.floor(((l.geladen ?? 0) / l.gesamt) * 100)} %` : "";
    console.log(`… ${l.name}: ${l.schritt}${prozent}`);
  }
  for (const e of stand.ergebnisse.filter((x) => x.fall !== "ok")) console.log(`✗ ${e.name}: ${text(e.fall, e.werte)}`);
  for (const w of offeneWuensche(leseWuensche(wunschDatei()), stand)) if (w.name !== stand.laeuft?.name) console.log(`… ${w.name}: wartet auf den Knoten`);
  if (!stand.modelle.length && !stand.laeuft && !stand.ergebnisse.length) {
    console.log(`Noch kein Modell geprüft. Laden: npm run modell -- ${hf ? "<org/repo> --aus-hf" : "<name>"}`);
  }
}
