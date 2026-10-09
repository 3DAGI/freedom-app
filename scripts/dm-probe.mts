// Direktnachricht für Browser-Prüfungen (seit A-15a): ein Umschlag (NIP-17) von einem Wegwerf-Schlüssel an den
// eigenen Schlüssel, zurückdatiert wie jeder Chat-Umschlag – nur für smoke_test.py, nie für ein echtes Relay.
// Aufruf: npx tsx scripts/dm-probe.mts <eigener Schlüssel hex> <Text>
//   ->  {"absender": "<hex>", "events": [<Umschlag>]}
import { LocalSigner, buildPrivateDm, generateKeypair } from "../packages/protocol/src/index.ts";

const ich = process.argv[2] ?? "";
if (!/^[0-9a-f]{64}$/.test(ich)) throw new Error("eigener Schlüssel fehlt");
const absender = generateKeypair();
const dm = await buildPrivateDm({ signer: new LocalSigner(absender.sk), recipientPk: ich, content: process.argv[3] ?? "Hallo" });
console.log(JSON.stringify({ absender: absender.pk, events: [dm.toRecipient] }));
