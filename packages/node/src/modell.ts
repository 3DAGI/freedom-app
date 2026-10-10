/**
 * Modell laden lassen (Schritt E9-3a): `npm run modell -- <name>` im Ordner
 * `packages/node`, mit derselben Umgebung wie der Knoten. Merkt nur den Wunsch
 * vor – der laufende Knoten sucht sein eigenes Manifest über seine Relays,
 * prüft, lädt über Ollama und bietet das Modell erst nach bestandener Prüfung
 * an. Mit `--aus-registry` hält er vorher fest, was die Registry jetzt nennt
 * (eigenes Manifest, signiert und veröffentlicht). Ohne Namen: der Stand.
 */
import { leseStand, leseWuensche, merkeWunsch, modellDatei, offeneWuensche, wunschDatei } from "./modell-laden.js";
import { modellFall, modellText } from "./modell-pruefung.js";

// Die Sätze je Kennung teilt sich die Kommandozeile mit der Selbstprüfung (E9-3b, `modell-pruefung.ts`)
const text = (fall: string, werte: Record<string, number | string> = {}) => modellText(modellFall(fall), werte);

const args = process.argv.slice(2);
const ausRegistry = args.includes("--aus-registry");
const name = args.find((a) => !a.startsWith("--"));
if (name) {
  const gemerkt = merkeWunsch(wunschDatei(), name, undefined, ausRegistry);
  if (!gemerkt) {
    console.error("Kein Modellname wie bei Ollama (name:tag oder namensraum/name:tag).");
    process.exit(1);
  }
  console.log(ausRegistry
    ? `Vorgemerkt: ${gemerkt}. Der laufende Knoten hält fest, was die Registry jetzt nennt (eigenes Manifest), lädt über Ollama und prüft;`
    : `Vorgemerkt: ${gemerkt}. Der laufende Knoten sucht sein Manifest, prüft und lädt über Ollama;`);
  console.log("im Angebot steht das Modell erst nach bestandener Prüfung. Stand: npm run modell");
} else {
  const stand = leseStand(modellDatei());
  for (const m of stand.modelle) console.log(`✓ ${m.name} – ${m.dateien} Dateien, ${(m.bytes / 1e9).toFixed(1)} GB, Manifest von ${m.herausgeber.slice(0, 12)}…`);
  if (stand.laeuft) {
    const l = stand.laeuft;
    const prozent = l.gesamt ? ` ${Math.floor(((l.geladen ?? 0) / l.gesamt) * 100)} %` : "";
    console.log(`… ${l.name}: ${l.schritt}${prozent}`);
  }
  for (const e of stand.ergebnisse.filter((x) => x.fall !== "ok")) console.log(`✗ ${e.name}: ${text(e.fall, e.werte)}`);
  for (const w of offeneWuensche(leseWuensche(wunschDatei()), stand)) if (w.name !== stand.laeuft?.name) console.log(`… ${w.name}: wartet auf den Knoten`);
  if (!stand.modelle.length && !stand.laeuft && !stand.ergebnisse.length) console.log("Noch kein Modell geprüft. Laden: npm run modell -- <name>");
}
