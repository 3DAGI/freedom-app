/**
 * Modell laden lassen (Schritt E9-3a): `npm run modell -- <name>` im Ordner
 * `packages/node`, mit derselben Umgebung wie der Knoten. Merkt nur den Wunsch
 * vor – der laufende Knoten sucht sein eigenes Manifest über seine Relays,
 * prüft, lädt über Ollama und bietet das Modell erst nach bestandener Prüfung
 * an. Mit `--aus-registry` hält er vorher fest, was die Registry jetzt nennt
 * (eigenes Manifest, signiert und veröffentlicht). Ohne Namen: der Stand.
 */
import { leseStand, leseWuensche, merkeWunsch, modellDatei, offeneWuensche, wunschDatei } from "./modell-laden.js";

const FALL: Record<string, (w: Record<string, number | string>) => string> = {
  "ok": () => "geprüft, im Angebot",
  "manifest.keins": () => "kein eigenes Manifest des Knotens – festhalten, was die Registry jetzt nennt: npm run modell -- <name> --aus-registry",
  "manifest.uneinig": (w) => `${w.herausgeber} Herausgeber nennen verschiedene Dateien – keine Wahl`,
  "manifest.nichtVeroeffentlicht": (w) => `eigenes Manifest nicht veröffentlicht (${w.fehler}) – nichts geladen`,
  "registry.nichtErreichbar": () => "die Registry war nicht zu befragen – nichts festgehalten, nichts geladen",
  "manifest.keineQuelle": () => "das Manifest nennt keine Ollama-Quelle zu diesem Namen (upstream ollama:<name>)",
  "passt.nicht": (w) => `braucht etwa ${w.brauchtGb} GB, das Gerät hat ${w.hatGb} GB (MODELL_SPEICHER_GB)`,
  "registry.anders": () => "die Registry nennt andere Dateien als das Manifest – nichts geladen",
  "ollama.laden": (w) => `Ollama hat nicht geladen (${w.fehler})`,
  "ollama.fehlt": () => "nach dem Laden nicht in Ollama",
  "schicht.form": () => "Ollama meldet Schichten ohne gültige Summe – nicht angeboten",
  "schicht.fremd": (w) => `${w.anzahl} geladene Schicht(en) stehen nicht im Manifest – nicht angeboten`,
  "schicht.groesse": (w) => `${w.anzahl} Schicht(en) mit anderer Größe als im Manifest – nicht angeboten`,
  "schicht.fehlt": (w) => `${w.anzahl} Datei(en) des Manifests hat Ollama nicht geladen – nicht angeboten`,
  "fehler": (w) => `abgebrochen (${w.fehler})`,
};
const text = (fall: string, werte: Record<string, number | string> = {}) => FALL[fall]?.(werte) ?? fall;

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
