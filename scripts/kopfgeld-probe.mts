// Kopfgelder für Browser-Prüfungen (E10b): ein öffentliches Repo, ein Issue mit Kommentar und ein fremdes
// Kopfgeld daran – signiert mit Wegwerfschlüsseln; nur für smoke_test.py, nie für ein echtes Relay.
// Aufruf: npx tsx scripts/kopfgeld-probe.mts
//   ->  {"repo": "30617:<hex>:werkbank", "issue": "<id>", "autorin": "<hex>", "geldgeber": "<hex>", "events": [...]}
import {
  baueIssue, baueKommentar, baueKopfgeld, baueRepoAnkuendigung, generateKeypair, leseRepoAnkuendigung, signEvent,
} from "../packages/protocol/src/index.ts";

const jetzt = Math.floor(Date.now() / 1000);
const eigentuemer = generateKeypair();
const autorin = generateKeypair();
const kommentator = generateKeypair();
const geldgeber = generateKeypair();
const ankuendigung = signEvent(baueRepoAnkuendigung({ id: "werkbank", name: "Werkbank", klon: ["https://example.org/werkbank.git"] }, eigentuemer.pk), eigentuemer.sk);
const repo = leseRepoAnkuendigung(ankuendigung);
const issue = signEvent({ ...baueIssue({ repo, betreff: "Säge stumpf", text: "Bitte schärfen." }, autorin.pk), created_at: jetzt - 300 }, autorin.sk);
const kommentar = signEvent({ ...baueKommentar({ wurzel: { id: issue.id, autor: autorin.pk, kind: 1621 }, text: "Ich kann das." }, kommentator.pk), created_at: jetzt - 200 }, kommentator.sk);
const fremd = signEvent(baueKopfgeld({
  kennung: "probe", titel: "Säge schärfen", beschreibung: "", msat: 21_000, geldgeber: geldgeber.pk, stand: "offen", issue: issue.id, repo: repo.adresse,
}, jetzt - 100), geldgeber.sk);
console.log(JSON.stringify({ repo: repo.adresse, issue: issue.id, autorin: autorin.pk, kommentator: kommentator.pk, geldgeber: geldgeber.pk, events: [ankuendigung, issue, kommentar, fremd] }));
