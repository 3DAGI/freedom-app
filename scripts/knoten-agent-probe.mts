// Ein Agent auf einem Knoten für Browser-Prüfungen (11.3e4): seine Karte (38090, Betrieb Knoten, wer fragt, zahlt),
// signiert mit einem Wegwerfschlüssel – nur für smoke_test.py, nie für ein echtes Relay.
// Aufruf: npx tsx scripts/knoten-agent-probe.mts  ->  {"agent": "<hex>", "events": [...]}
import { baueAgentKarte, generateKeypair, signEvent } from "../packages/protocol/src/index.ts";

const jetzt = Math.floor(Date.now() / 1000);
const agent = generateKeypair();
const knoten = generateKeypair();
const events = [
  signEvent(baueAgentKarte(agent.pk, { name: "Rechner", betrieb: "knoten", bezahlung: "fragender", provider: knoten.pk }, jetzt - 60), agent.sk),
];
console.log(JSON.stringify({ agent: agent.pk, events }));
