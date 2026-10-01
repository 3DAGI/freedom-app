// Fremdtext für Browser-Prüfungen (seit C-6a): Events, deren Felder HTML tragen – ein Modell-Manifest, eine
// Einnahme und ein Abzeichen an den eigenen Schlüssel –, signiert mit Wegwerfschlüsseln; nur für smoke_test.py,
// nie für ein echtes Relay. Die App darf das HTML nur als Text zeigen.
// Aufruf: npx tsx scripts/fremdtext-probe.mts <eigener Schlüssel hex>  ->  {"knoten": "<hex>", "html": "...", "events": [...]}
import {
  buildBadgeAward, buildBadgeDefinition, buildModelManifest, buildPerformanceEvent, generateKeypair, signEvent,
} from "../packages/protocol/src/index.ts";

const ich = process.argv[2] ?? "";
if (!/^[0-9a-f]{64}$/.test(ich)) throw new Error("eigener Schlüssel fehlt");
const html = (wo: string) => `<img src=x onerror="window.__fremd='${wo}'">${wo}<b>!</b>`;
const jetzt = Math.floor(Date.now() / 1000);
const herausgeber = generateKeypair();
const knoten = generateKeypair();

const events = [
  signEvent(buildModelManifest({
    modelId: "probe-modell", name: html("modell"), quant: html("quant"), publisherPubkey: herausgeber.pk,
    files: [{ name: "probe.gguf", sha256: "a".repeat(64), sizeBytes: 1 }],
  }, jetzt - 30), herausgeber.sk),
  signEvent(buildPerformanceEvent({
    workerPubkey: knoten.pk, workType: html("arbeit") as never, units: 7, volumeMsat: 21_000, chain: "lightning",
    proofEventId: "f".repeat(64), seasonId: "probe",
  }, jetzt - 60), knoten.sk),
  signEvent(buildBadgeDefinition({ id: "probe", name: html("abzeichen"), description: "", issuerPubkey: herausgeber.pk }, jetzt - 90), herausgeber.sk),
  signEvent(buildBadgeAward("probe", herausgeber.pk, [ich], jetzt - 80), herausgeber.sk),
];
console.log(JSON.stringify({ knoten: knoten.pk, html: html("WO"), events }));
